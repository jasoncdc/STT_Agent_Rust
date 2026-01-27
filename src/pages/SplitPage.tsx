import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface PlaybackState {
    position: number;
    duration: number;
    is_playing: boolean;
}

export function SplitPage() {
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);
    
    // Audio player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    
    const positionIntervalRef = useRef<number | null>(null);

    // Sync with backend state on mount (in case audio is already loaded)
    useEffect(() => {
        async function syncWithBackend() {
            try {
                const state = await invoke<PlaybackState>("get_playback_state");
                if (state.duration > 0) {
                    setDuration(state.duration);
                    setCurrentTime(state.position);
                    setIsPlaying(state.is_playing);
                    setIsLoaded(true);
                }
            } catch (err) {
                // No audio loaded yet, that's fine
                console.log("No audio loaded yet");
            }
        }
        syncWithBackend();
    }, []);

    // Poll playback position while playing
    useEffect(() => {
        if (isPlaying && !isSeeking) {
            positionIntervalRef.current = window.setInterval(async () => {
                try {
                    const state = await invoke<PlaybackState>("get_playback_state");
                    setCurrentTime(state.position);
                    setIsPlaying(state.is_playing);
                } catch (err) {
                    console.error("Failed to get playback state:", err);
                }
            }, 100); // Update every 100ms
        }
        
        return () => {
            if (positionIntervalRef.current) {
                clearInterval(positionIntervalRef.current);
                positionIntervalRef.current = null;
            }
        };
    }, [isPlaying, isSeeking]);

    // Keyboard controls for audio playback
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            // Only handle if audio is loaded and not typing in an input
            if (!isLoaded) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const SKIP_SECONDS = 5;

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    const newTimeBack = Math.max(0, currentTime - SKIP_SECONDS);
                    try {
                        await invoke("seek", { seconds: newTimeBack });
                        setCurrentTime(newTimeBack);
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case "ArrowRight":
                    e.preventDefault();
                    const newTimeForward = Math.min(duration, currentTime + SKIP_SECONDS);
                    try {
                        await invoke("seek", { seconds: newTimeForward });
                        setCurrentTime(newTimeForward);
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case " ": // Space bar
                    e.preventDefault();
                    handlePlayPause();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLoaded, currentTime, duration, isPlaying]);

    // Load audio file
    async function handleLoadTrack() {
        try {
            const selected = await open({
                multiple: false,
                filters: [
                    {
                        name: "Audio Files",
                        extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg"],
                    },
                ],
            });

            if (selected && typeof selected === "string") {
                setLoading(true);
                setOutput("載入中...");
                
                const durationStr = await invoke<string>("load_track", { path: selected });
                const dur = parseFloat(durationStr);
                
                setDuration(dur);
                setCurrentTime(0);
                setIsLoaded(true);
                setIsPlaying(false);
                setOutput(`已載入: ${selected.split("\\").pop()}`);
            }
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    // Play/Pause toggle
    async function handlePlayPause() {
        try {
            if (isPlaying) {
                await invoke("pause");
                setIsPlaying(false);
            } else {
                await invoke("play");
                setIsPlaying(true);
            }
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        }
    }

    // Seek when slider released
    async function handleSeek(seconds: number) {
        try {
            await invoke("seek", { seconds });
            setCurrentTime(seconds);
        } catch (err) {
            setOutput(`Seek 錯誤: ${err}`);
        }
    }

    // Format time as HH:MM:SS
    function formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }

    // Run split command
    async function runSplit() {
        setLoading(true);
        setOutput("執行中...");
        try {
            const result = await invoke("run_split_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">切割模組</h2>
            <p className="page-description">將長錄音切分成小片段，方便後續處理。</p>

            {/* Audio Player Section */}
            <div className="audio-player-section">
                <h3>🎵 音訊播放器</h3>

                {/* Load Button */}
                <div style={{ marginBottom: "16px" }}>
                    <button 
                        className="btn btn-secondary" 
                        onClick={handleLoadTrack}
                        disabled={loading}
                        style={{ marginRight: "10px" }}
                    >
                        📂 載入音訊
                    </button>
                    
                    {isLoaded && (
                        <button 
                            className="btn btn-primary" 
                            onClick={handlePlayPause}
                            disabled={loading}
                        >
                            {isPlaying ? "⏸️ 暫停" : "▶️ 播放"}
                        </button>
                    )}
                </div>

                {/* Seek Slider */}
                {isLoaded && (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ 
                            fontSize: "0.9rem", 
                            fontFamily: "monospace",
                            minWidth: "70px",
                            color: "var(--text-primary)"
                        }}>
                            {formatTime(currentTime)}
                        </span>
                        
                        <input
                            type="range"
                            min={0}
                            max={duration || 100}
                            step={0.1}
                            value={currentTime}
                            onChange={(e) => {
                                setIsSeeking(true);
                                setCurrentTime(parseFloat(e.target.value));
                            }}
                            onMouseUp={(e) => {
                                const target = e.target as HTMLInputElement;
                                handleSeek(parseFloat(target.value));
                                setIsSeeking(false);
                                target.blur(); // Restore keyboard controls
                            }}
                            onTouchEnd={(e) => {
                                const target = e.target as HTMLInputElement;
                                handleSeek(parseFloat(target.value));
                                setIsSeeking(false);
                                target.blur(); // Restore keyboard controls
                            }}
                            style={{
                                flex: 1,
                                height: "8px",
                                cursor: "pointer",
                                accentColor: "var(--accent)"
                            }}
                        />
                        
                        <span style={{ 
                            fontSize: "0.9rem", 
                            fontFamily: "monospace",
                            minWidth: "70px",
                            textAlign: "right",
                            color: "var(--text-secondary)"
                        }}>
                            {formatTime(duration)}
                        </span>
                    </div>
                )}
            </div>

            {/* Split Controls */}
            <div className="btn-group">
                <button className="btn btn-primary" onClick={runSplit} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "執行中..." : "執行切割"}
                </button>
            </div>

            {output && (
                <div className={`output-box ${output.includes("錯誤") ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
