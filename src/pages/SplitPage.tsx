import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface PlaybackState {
    position: number;
    duration: number;
    is_playing: boolean;
}

// 段落資料結構
interface Segment {
    id: number;
    name: string;
    startTime: string; // HH:MM:SS 格式
    endTime: string;   // HH:MM:SS 格式
}

// 自動格式化時間輸入：01 -> 01, 0112 -> 01:12, 011223 -> 01:12:23
function formatTimeString(input: string): string {
    // 移除所有非數字字元
    const digits = input.replace(/\D/g, "");

    // 最多 6 位數字 (HHMMSS)
    const limited = digits.slice(0, 6);

    if (limited.length <= 2) {
        // 1-2 位: 秒數
        return limited;
    } else if (limited.length <= 4) {
        // 3-4 位: MM:SS
        const secs = limited.slice(-2);
        const mins = limited.slice(0, -2);
        return `${mins}:${secs}`;
    } else {
        // 5-6 位: HH:MM:SS
        const secs = limited.slice(-2);
        const mins = limited.slice(-4, -2);
        const hours = limited.slice(0, -4);
        return `${hours}:${mins}:${secs}`;
    }
}

export function SplitPage() {
    const { t } = useI18n();
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    // Audio player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [audioFilePath, setAudioFilePath] = useState(""); // 音檔路徑

    // 段落列表狀態
    const [segments, setSegments] = useState<Segment[]>([
        { id: 1, name: "", startTime: "", endTime: "" }
    ]);
    const [nextId, setNextId] = useState(2);

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
                setOutput(t.loading);

                const durationStr = await invoke<string>("load_track", { path: selected });
                const dur = parseFloat(durationStr);

                setDuration(dur);
                setCurrentTime(0);
                setIsLoaded(true);
                setIsPlaying(false);
                setAudioFilePath(selected); // 儲存音檔路徑
                setOutput(`${t.loaded}: ${selected.split(/[/\\]/).pop()}`);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
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
            setOutput(`${t.error}: ${err}`);
        }
    }

    // Seek when slider released
    async function handleSeek(seconds: number) {
        try {
            await invoke("seek", { seconds });
            setCurrentTime(seconds);
        } catch (err) {
            setOutput(`Seek ${t.error}: ${err}`);
        }
    }

    // Format time as HH:MM:SS
    function formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }

    // 新增段落
    function addSegment() {
        const newSegment: Segment = {
            id: nextId,
            name: "",
            startTime: "",
            endTime: ""
        };
        setSegments([...segments, newSegment]);
        setNextId(nextId + 1);
    }

    // 刪除段落
    function deleteSegment(id: number) {
        if (segments.length > 1) {
            setSegments(segments.filter(s => s.id !== id));
        }
    }

    // 更新段落欄位
    function updateSegment(id: number, field: keyof Segment, value: string) {
        // 如果是時間欄位，進行自動格式化
        let formattedValue = value;
        if (field === "startTime" || field === "endTime") {
            formattedValue = formatTimeString(value);
        }

        setSegments(segments.map(s =>
            s.id === id ? { ...s, [field]: formattedValue } : s
        ));
    }

    // Run split command
    async function runSplit() {
        // Eagerly update report folder to 02_split
        if (audioFilePath) {
            try {
                const separator = audioFilePath.includes("\\") ? "\\" : "/";
                let possibleRoot = audioFilePath.substring(0, audioFilePath.lastIndexOf(separator));
                if (possibleRoot.endsWith("01_converted")) {
                    possibleRoot = possibleRoot.substring(0, possibleRoot.lastIndexOf(separator));
                }
                const splitPath = `${possibleRoot}${separator}02_split`;
                localStorage.setItem("latest_report_folder", splitPath);
            } catch (e) {
                console.error("Failed to set early report path", e);
            }
        }

        // 驗證是否已載入音檔
        if (!audioFilePath) {
            setOutput(`${t.error}: ${t.errorLoadAudio}`);
            return;
        }

        // 驗證段落資料
        const validSegments = segments.filter(
            (s) => s.name.trim() && s.startTime && s.endTime
        );
        if (validSegments.length === 0) {
            setOutput(`${t.error}: ${t.errorSetSegment}`);
            return;
        }

        setLoading(true);
        setOutput(t.processing);

        try {
            // 傳送段落資料到後端
            const result = await invoke("split_audio_segments", {
                audioPath: audioFilePath,
                segments: validSegments.map((s) => ({
                    name: s.name.trim(),
                    startTime: s.startTime,
                    endTime: s.endTime,
                })),
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    // 當分割成功後，儲存 Report 頁面應該預設的路徑 (02_split)
    useEffect(() => {
        if (output && (output.includes("切割完成") || output.includes("Split 完成"))) {
            // 從 output 中嘗試解析路徑
            const match = output.match(/輸出目錄: (.+)/);
            if (match) {
                const path = match[1].trim();
                localStorage.setItem("latest_report_folder", path);
            }
        }
    }, [output]);

    // Icons
    const AudioIcon = () => (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.8}}>
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
        </svg>
    );
    const PlayIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M8 5v14l11-7z"></path>
        </svg>
    );

    const PauseIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
        </svg>
    );

    return (
        <div className="page-container">
            <header className="page-header">
                <h2 className="page-title">{t.splitTitle}</h2>
                <p className="page-description">{t.splitDescription}</p>
            </header>

            {/* Audio Player Section */}
            {/* Audio Player Header Section */}
            {/* Audio Player Section */}
            
            {/* Audio Player Wrapper */}
            <div className={`audio-player-wrapper ${isLoaded ? 'active' : 'empty'}`}>
                {!isLoaded ? (
                    // Empty State
                    <div className="audio-empty-state">
                        <h3 style={{ marginBottom: '16px' }}>🎵 {t.audioPlayer}</h3>
                        <div className="audio-icon-circle">
                            <AudioIcon />
                        </div>
                        <p className="subtext">{t.errorLoadAudio}</p>
                        <button className="btn btn-primary mt-3" onClick={handleLoadTrack} disabled={loading}>
                             📂 {t.loadAudio}
                        </button>
                    </div>
                ) : (
                    // Active Player
                    <div className="audio-controls-container">
                        {/* Header: Title + Button */}
                        <div style={{ marginBottom: '16px' }}>
                             <h3 style={{ margin: '0 0 12px 0' }}>🎵 {t.audioPlayer}</h3>
                             <button className="btn btn-secondary" onClick={handleLoadTrack}>
                                📂 {t.changeFolder || t.loadAudio}
                            </button>
                        </div>

                        {/* Inner Player Box */}
                        <div className="player-inner-box">
                            <div className="player-top-row">
                                <div className="track-info">
                                    <span className="icon">🎵</span>
                                    <span className="track-name">{getFileName(audioFilePath)}</span>
                                </div>
                            </div>

                            <div className="player-main-row">
                                <button className="play-btn" onClick={handlePlayPause}>
                                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                                </button>
                                
                                <div className="seek-container">
                                    <span className="time-display">{formatTime(currentTime)}</span>
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
                                            target.blur();
                                        }}
                                        onTouchEnd={(e) => {
                                            const target = e.target as HTMLInputElement;
                                            handleSeek(parseFloat(target.value));
                                            setIsSeeking(false);
                                            target.blur();
                                        }}
                                        className="custom-range"
                                        style={{
                                            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(currentTime / (duration || 1)) * 100}%, var(--border-strong) ${(currentTime / (duration || 1)) * 100}%, var(--border-strong) 100%)`
                                        }}
                                    />
                                    <span className="time-display total">{formatTime(duration)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>


            {/* Segment Table Section */}
            <div className="segment-section mt-4 fade-in-up">
                <div className="section-header display-flex justify-between align-center mb-3">
                    <h3>📋 {t.segmentList}</h3>
                    <button onClick={addSegment} className="btn btn-secondary btn-sm">
                        ➕ {t.addSegment}
                    </button>
                </div>

                <div className="table-container" style={{ marginTop: '12px' }}>
                    <table style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        backgroundColor: "var(--bg-secondary, #1e1e1e)",
                        borderRadius: "8px",
                        overflow: "hidden"
                    }}>
                        <thead>
                            <tr style={{ backgroundColor: "var(--bg-tertiary, #2d2d2d)" }}>
                                <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--border, #444)", width: "300px" }}>{t.segmentName}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.startTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.endTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "80px" }}>{t.action}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {segments.map((segment) => (
                                <tr key={segment.id} style={{ borderBottom: "1px solid var(--border, #333)" }}>
                                    <td style={{ padding: "8px 4px 8px 12px", width: "300px" }}>
                                        <input
                                            type="text"
                                            value={segment.name}
                                            onChange={(e) => updateSegment(segment.id, "name", e.target.value)}
                                            placeholder={t.exampleName}
                                            style={{
                                                width: "100%",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.name ? "var(--text-primary, #fff)" : "#888"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "160px" }}>
                                        <input
                                            type="text"
                                            value={segment.startTime}
                                            onChange={(e) => updateSegment(segment.id, "startTime", e.target.value)}
                                            placeholder="00:00:00"
                                            style={{
                                                width: "140px",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.startTime ? "var(--text-primary, #fff)" : "#888",
                                                textAlign: "center",
                                                fontFamily: "monospace"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "160px" }}>
                                        <input
                                            type="text"
                                            value={segment.endTime}
                                            onChange={(e) => updateSegment(segment.id, "endTime", e.target.value)}
                                            placeholder="00:00:00"
                                            style={{
                                                width: "140px",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.endTime ? "var(--text-primary, #fff)" : "#888",
                                                textAlign: "center",
                                                fontFamily: "monospace"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 12px", textAlign: "center", width: "80px" }}>
                                        <button
                                            onClick={() => deleteSegment(segment.id)}
                                            disabled={segments.length <= 1}
                                            style={{
                                                padding: "8px 16px",
                                                border: "none",
                                                borderRadius: "8px",
                                                backgroundColor: segments.length <= 1 ? "#555" : "#e74c3c",
                                                color: "#fff",
                                                cursor: segments.length <= 1 ? "not-allowed" : "pointer",
                                                fontWeight: "bold",
                                                fontSize: "14px",
                                                transition: "all 0.2s ease",
                                                margin: '0 auto',
                                                display: 'block'
                                            }}
                                            title={t.deleteSegment}
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Split Controls */}
                <div className="action-footer mt-4">
                    <button 
                        className="btn btn-primary btn-large" 
                        onClick={runSplit} 
                        disabled={loading}
                    >
                        {loading ? (
                            <span className="loading-spinner"></span>
                        ) : null}
                        <span>
                            {loading ? t.splitting : t.runSplit}
                        </span>
                    </button>
                </div>
            </div>

            {output && (
                <div className={`output-box mt-4 fade-in-up ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}

// Extract filename helper if not already present in scope or ensure it's used correctly
const getFileName = (path: string) => path.split(/[/\\]/).pop() || path;
