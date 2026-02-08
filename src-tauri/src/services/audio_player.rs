// src-tauri/src/services/audio_player.rs
//
// Low-Latency Audio Player using Producer-Consumer model
// - Decoder Thread: symphonia decodes audio, writes to ringbuf
// - Audio Thread: cpal reads from ringbuf and plays audio
//
// Note: cpal::Stream is NOT Send+Sync, so we spawn it in a dedicated thread
// and communicate with it via atomic flags.

use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{
    traits::{Consumer, Observer, Producer, Split},
    HeapRb,
};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

/// Buffer size in samples (per channel). ~50ms at 48kHz = 2400 samples
const RING_BUFFER_SIZE: usize = 4096;

/// Shared state for communication between threads
/// All fields are atomic, making this struct Send + Sync
pub struct SharedState {
    /// Flag to signal pause state
    pub is_paused: AtomicBool,
    /// Flag to signal stop/shutdown
    pub should_stop: AtomicBool,
    /// Seek position in milliseconds (u64::MAX means no seek pending)
    pub seek_position_ms: AtomicU64,
    /// Current playback position in milliseconds
    pub current_position_ms: AtomicU64,
    /// Total duration in milliseconds
    pub duration_ms: AtomicU64,
}

impl Default for SharedState {
    fn default() -> Self {
        Self::new()
    }
}

impl SharedState {
    pub fn new() -> Self {
        Self {
            is_paused: AtomicBool::new(true),
            should_stop: AtomicBool::new(false),
            seek_position_ms: AtomicU64::new(u64::MAX),
            current_position_ms: AtomicU64::new(0),
            duration_ms: AtomicU64::new(0),
        }
    }
}

/// Audio Player Handle - only contains Send + Sync types
/// The actual cpal::Stream lives in a separate thread
pub struct AudioPlayer {
    /// Path to the loaded audio file
    file_path: PathBuf,
    /// Shared state for thread communication (Arc<T> where T is Send+Sync)
    shared_state: Arc<SharedState>,
    /// Handle to the decoder thread
    decoder_handle: Option<JoinHandle<()>>,
    /// Handle to the audio output thread
    audio_handle: Option<JoinHandle<()>>,
    /// Flag to track if playback has been started
    playback_started: bool,
}

// Explicitly mark as Send + Sync since we only use atomic types
unsafe impl Send for AudioPlayer {}
unsafe impl Sync for AudioPlayer {}

impl AudioPlayer {
    /// Load an audio file and prepare for playback
    pub fn load(path: &str) -> Result<Self, String> {
        let file_path = PathBuf::from(path);
        let file = File::open(&file_path).map_err(|e| format!("無法開啟檔案: {}", e))?;

        // Create media source stream
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        // Probe the format
        let mut hint = Hint::new();
        if let Some(ext) = file_path.extension() {
            hint.with_extension(ext.to_str().unwrap_or(""));
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| format!("無法解析音訊格式: {}", e))?;

        let format = probed.format;

        // Find the first audio track
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("找不到音訊軌道")?;

        let codec_params = &track.codec_params;
        let sample_rate = codec_params.sample_rate.unwrap_or(44100);

        // Calculate duration
        let duration_secs = if let Some(n_frames) = codec_params.n_frames {
            n_frames as f64 / sample_rate as f64
        } else {
            0.0
        };

        let shared_state = Arc::new(SharedState::new());
        shared_state.duration_ms.store((duration_secs * 1000.0) as u64, Ordering::Relaxed);

        Ok(Self {
            file_path,
            shared_state,
            decoder_handle: None,
            audio_handle: None,
            playback_started: false,
        })
    }

    /// Start the audio playback pipeline
    pub fn start_playback(&mut self) -> Result<(), String> {
        if self.playback_started {
            return Ok(()); // Already started
        }

        // Re-probe file to get format info
        let file = File::open(&self.file_path).map_err(|e| format!("無法開啟檔案: {}", e))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = self.file_path.extension() {
            hint.with_extension(ext.to_str().unwrap_or(""));
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| format!("無法解析音訊格式: {}", e))?;

        let format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("找不到音訊軌道")?;

        let codec_params = &track.codec_params;
        let sample_rate = codec_params.sample_rate.unwrap_or(44100);
        let channels = codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);

        // Create ring buffer
        let ring = HeapRb::<f32>::new(RING_BUFFER_SIZE * channels as usize);
        let (producer, consumer) = ring.split();

        // Wrap in Arc<Mutex> for sharing between threads
        let producer = Arc::new(std::sync::Mutex::new(producer));
        let consumer = Arc::new(std::sync::Mutex::new(consumer));

        // Start audio output thread (cpal::Stream lives here, not in AudioPlayer)
        let shared_state_audio = Arc::clone(&self.shared_state);
        let consumer_clone = Arc::clone(&consumer);
        let audio_handle = thread::spawn(move || {
            if let Err(e) = run_audio_output_loop(sample_rate, channels, shared_state_audio, consumer_clone) {
                eprintln!("Audio output error: {}", e);
            }
        });

        // Start decoder thread
        let file_path = self.file_path.clone();
        let shared_state_decoder = Arc::clone(&self.shared_state);
        let producer_clone = Arc::clone(&producer);
        let decoder_handle = thread::spawn(move || {
            if let Err(e) = run_decoder_loop(file_path, sample_rate, channels, shared_state_decoder, producer_clone) {
                eprintln!("Decoder error: {}", e);
            }
        });

        self.audio_handle = Some(audio_handle);
        self.decoder_handle = Some(decoder_handle);
        self.shared_state.is_paused.store(false, Ordering::Relaxed);
        self.playback_started = true;

        Ok(())
    }

    /// Resume playback
    pub fn play(&self) {
        self.shared_state.is_paused.store(false, Ordering::Relaxed);
    }

    /// Pause playback
    pub fn pause(&self) {
        self.shared_state.is_paused.store(true, Ordering::Relaxed);
    }

    /// Seek to a specific position in seconds
    /// This clears the ring buffer and signals the decoder to seek
    pub fn seek(&self, seconds: f64) {
        let ms = (seconds * 1000.0) as u64;
        // Signal decoder to seek (it will clear the buffer)
        self.shared_state
            .seek_position_ms
            .store(ms, Ordering::SeqCst);
    }

    /// Get current playback position in seconds
    pub fn get_position(&self) -> f64 {
        let ms = self.shared_state.current_position_ms.load(Ordering::Relaxed);
        ms as f64 / 1000.0
    }

    /// Get total duration in seconds
    pub fn get_duration(&self) -> f64 {
        let ms = self.shared_state.duration_ms.load(Ordering::Relaxed);
        ms as f64 / 1000.0
    }

    /// Check if currently playing
    pub fn is_playing(&self) -> bool {
        !self.shared_state.is_paused.load(Ordering::Relaxed)
    }

    /// Stop and cleanup
    pub fn stop(&mut self) {
        self.shared_state.should_stop.store(true, Ordering::SeqCst);
        self.shared_state.is_paused.store(true, Ordering::Relaxed);

        if let Some(handle) = self.decoder_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.audio_handle.take() {
            let _ = handle.join();
        }
        self.playback_started = false;
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Audio output loop running in a separate thread
/// This is where cpal::Stream lives, keeping it off the main thread
fn run_audio_output_loop(
    sample_rate: u32,
    channels: u16,
    shared_state: Arc<SharedState>,
    consumer: Arc<std::sync::Mutex<ringbuf::HeapCons<f32>>>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("找不到音訊輸出裝置")?;

    // Find a config that supports the file's sample rate
    let supported_configs: Vec<_> = device
        .supported_output_configs()
        .map_err(|e| format!("無法取得支援的音訊設定: {}", e))?
        .collect();
    
    // Try to find a config with EXACT channel match first
    let matching_config = supported_configs
        .iter()
        .find(|c| {
            c.min_sample_rate().0 <= sample_rate 
            && c.max_sample_rate().0 >= sample_rate
            && c.channels() == channels  // Exact match
        })
        .or_else(|| {
            // Fallback: find any config that supports the sample rate
            supported_configs.iter().find(|c| {
                c.min_sample_rate().0 <= sample_rate 
                && c.max_sample_rate().0 >= sample_rate
            })
        });
    
    let (config, output_channels) = if let Some(cfg) = matching_config {
        let output_channels = cfg.channels();
        let built_config = cfg.clone().with_sample_rate(cpal::SampleRate(sample_rate)).config();
        eprintln!(
            "Audio: file={}Hz/{}ch -> device={}Hz/{}ch",
            sample_rate, channels, sample_rate, output_channels
        );
        (built_config, output_channels)
    } else {
        // Fallback: use device default
        let default_cfg = device
            .default_output_config()
            .map_err(|e| format!("無法取得預設音訊設定: {}", e))?;
        let output_channels = default_cfg.channels();
        eprintln!(
            "Warning: No matching config for {}Hz/{}ch. Using device default {}Hz/{}ch",
            sample_rate, channels, default_cfg.sample_rate().0, output_channels
        );
        (default_cfg.config(), output_channels)
    };

    let shared_state_clone = Arc::clone(&shared_state);
    let consumer_clone = Arc::clone(&consumer);
    let file_channels = channels;

    let stream = device
        .build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let is_paused = shared_state_clone.is_paused.load(Ordering::Relaxed);
                if is_paused {
                    // Fill with silence when paused
                    data.fill(0.0);
                    return;
                }

                let mut cons = consumer_clone.lock().unwrap();
                let file_ch = file_channels as usize;
                let out_ch = output_channels as usize;
                
                // Process frame by frame to handle channel conversion
                let num_frames = data.len() / out_ch;
                
                for frame_idx in 0..num_frames {
                    // Read one frame of samples from the file (file_channels samples)
                    let mut file_samples = [0.0f32; 8]; // Support up to 8 channels
                    for ch in 0..file_ch.min(8) {
                        file_samples[ch] = cons.try_pop().unwrap_or(0.0);
                    }
                    
                    // Write to output channels
                    for out_ch_idx in 0..out_ch {
                        let sample = if out_ch_idx < file_ch {
                            // Direct mapping
                            file_samples[out_ch_idx]
                        } else if file_ch >= 2 {
                            // For extra channels, use average of left and right
                            (file_samples[0] + file_samples[1]) / 2.0
                        } else {
                            // Mono source - duplicate to all channels
                            file_samples[0]
                        };
                        data[frame_idx * out_ch + out_ch_idx] = sample;
                    }
                }
            },
            |err| eprintln!("Audio stream error: {}", err),
            None,
        )
        .map_err(|e| format!("無法建立音訊串流: {}", e))?;

    stream.play().map_err(|e| format!("無法開始播放: {}", e))?;

    // Keep the stream alive until should_stop is signaled
    while !shared_state.should_stop.load(Ordering::Relaxed) {
        thread::sleep(std::time::Duration::from_millis(50));
    }

    // Stream will be dropped here, stopping playback
    Ok(())
}

/// Decoder loop running in a separate thread
fn run_decoder_loop(
    file_path: PathBuf,
    _sample_rate: u32,
    _channels: u16,
    shared_state: Arc<SharedState>,
    producer: Arc<std::sync::Mutex<ringbuf::HeapProd<f32>>>,
) -> Result<(), String> {
    // Open file and create decoder
    let file = File::open(&file_path).map_err(|e| format!("無法開啟檔案: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = file_path.extension() {
        hint.with_extension(ext.to_str().unwrap_or(""));
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("無法解析音訊格式: {}", e))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("找不到音訊軌道")?;

    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("無法建立解碼器: {}", e))?;

    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        // Check if we should stop
        if shared_state.should_stop.load(Ordering::Relaxed) {
            break;
        }

        // Check for seek request
        let seek_ms = shared_state.seek_position_ms.swap(u64::MAX, Ordering::SeqCst);
        if seek_ms != u64::MAX {
            // Clear the ring buffer by draining the producer side
            // (Consumer will read zeros or old data briefly)
            
            // Seek the format reader
            let seek_time = Time::new(seek_ms / 1000, (seek_ms % 1000) as f64 / 1000.0);
            if let Err(e) = format.seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: seek_time,
                    track_id: Some(track_id),
                },
            ) {
                eprintln!("Seek error: {}", e);
            }

            // Reset decoder
            decoder.reset();

            // Update current position
            shared_state.current_position_ms.store(seek_ms, Ordering::Relaxed);
        }

        // Check if paused
        if shared_state.is_paused.load(Ordering::Relaxed) {
            thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }

        // Read and decode next packet
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                // End of stream - Do NOT break, otherwise we can't seek backwards
                // Just sleep and wait for a seek or stop signal
                if !shared_state.is_paused.load(Ordering::Relaxed) {
                     shared_state.is_paused.store(true, Ordering::Relaxed);
                }
                thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            Err(e) => {
                eprintln!("Packet read error: {}", e);
                continue;
            }
        };

        // Skip packets from other tracks
        if packet.track_id() != track_id {
            continue;
        }

        // Update current position based on packet timestamp
        let time_base = format
            .tracks()
            .iter()
            .find(|t| t.id == track_id)
            .and_then(|t| t.codec_params.time_base);
        
        if let Some(tb) = time_base {
            let position_ms = (packet.ts() as f64 * tb.numer as f64 / tb.denom as f64 * 1000.0) as u64;
            shared_state.current_position_ms.store(position_ms, Ordering::Relaxed);
        }

        // Decode the packet
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(e) => {
                eprintln!("Decode error: {}", e);
                continue;
            }
        };

        // Convert to f32 samples
        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;

        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::new(duration, spec));
        }

        let buf = sample_buf.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);

        // Write samples to ring buffer
        let samples = buf.samples();
        let mut prod = producer.lock().unwrap();

        for &sample in samples {
            // Wait for space in buffer if full
            while prod.is_full() {
                if shared_state.should_stop.load(Ordering::Relaxed) {
                    return Ok(());
                }
                drop(prod);
                thread::sleep(std::time::Duration::from_micros(100));
                prod = producer.lock().unwrap();
            }
            let _ = prod.try_push(sample);
        }
    }

    Ok(())
}
