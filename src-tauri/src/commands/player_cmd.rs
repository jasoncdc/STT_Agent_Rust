// src-tauri/src/commands/player_cmd.rs
//
// Tauri commands for audio player control

use crate::services::audio_player::AudioPlayer;
use std::sync::Mutex;
use tauri::{command, State};

/// State type for the audio player
pub type AudioPlayerState = Mutex<Option<AudioPlayer>>;

/// Load an audio track
#[command]
pub fn load_track(
    path: String,
    player_state: State<'_, AudioPlayerState>,
) -> Result<String, String> {
    let mut player_guard = player_state
        .lock()
        .map_err(|_| "無法取得播放器鎖定".to_string())?;

    // Stop existing player if any
    if let Some(ref mut existing) = *player_guard {
        existing.stop();
    }

    // Load new track
    let player = AudioPlayer::load(&path)?;
    let duration = player.get_duration();
    *player_guard = Some(player);

    Ok(format!("{:.2}", duration))
}

/// Start playback
#[command]
pub fn play(player_state: State<'_, AudioPlayerState>) -> Result<(), String> {
    let mut player_guard = player_state
        .lock()
        .map_err(|_| "無法取得播放器鎖定".to_string())?;

    if let Some(ref mut player) = *player_guard {
        // Check if playback pipeline is started
        if !player.is_playing() && player.get_position() == 0.0 {
            // First time playing - start the pipeline
            player.start_playback()?;
        } else {
            player.play();
        }
        Ok(())
    } else {
        Err("尚未載入音訊檔案".to_string())
    }
}

/// Pause playback
#[command]
pub fn pause(player_state: State<'_, AudioPlayerState>) -> Result<(), String> {
    let player_guard = player_state
        .lock()
        .map_err(|_| "無法取得播放器鎖定".to_string())?;

    if let Some(ref player) = *player_guard {
        player.pause();
        Ok(())
    } else {
        Err("尚未載入音訊檔案".to_string())
    }
}

/// Seek to a specific position in seconds
/// This immediately clears the ringbuf and notifies the decoder to seek
#[command]
pub fn seek(seconds: f64, player_state: State<'_, AudioPlayerState>) -> Result<(), String> {
    let player_guard = player_state
        .lock()
        .map_err(|_| "無法取得播放器鎖定".to_string())?;

    if let Some(ref player) = *player_guard {
        player.seek(seconds);
        Ok(())
    } else {
        Err("尚未載入音訊檔案".to_string())
    }
}

/// Get current playback state (position, duration, is_playing)
#[command]
pub fn get_playback_state(
    player_state: State<'_, AudioPlayerState>,
) -> Result<PlaybackState, String> {
    let player_guard = player_state
        .lock()
        .map_err(|_| "無法取得播放器鎖定".to_string())?;

    if let Some(ref player) = *player_guard {
        Ok(PlaybackState {
            position: player.get_position(),
            duration: player.get_duration(),
            is_playing: player.is_playing(),
        })
    } else {
        Ok(PlaybackState {
            position: 0.0,
            duration: 0.0,
            is_playing: false,
        })
    }
}

/// Playback state returned to the frontend
#[derive(serde::Serialize)]
pub struct PlaybackState {
    pub position: f64,
    pub duration: f64,
    pub is_playing: bool,
}
