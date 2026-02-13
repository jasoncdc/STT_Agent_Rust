import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface PlaybackState {
    position: number;
    duration: number;
    is_playing: boolean;
}

interface Segment {
    id: number;
    note: string;
    startTime: string;
    endTime: string;
}

// 格式化時間輸入：允許毫秒 (HH:MM:SS.mmm)
function formatTimeString(input: string): string {
    // 允許數字和一個小數點
    let cleaned = input.replace(/[^0-9.]/g, "");

    // 處理多個小數點，只保留第一個
    const firstDotIndex = cleaned.indexOf('.');
    if (firstDotIndex !== -1) {
        cleaned = cleaned.slice(0, firstDotIndex + 1) + cleaned.slice(firstDotIndex + 1).replace(/\./g, "");
    }

    const parts = cleaned.split('.');
    let integers = parts[0];
    let decimals = parts.length > 1 ? parts[1] : null;

    // 限制整數部分長度 (HHMMSS -> 6位)
    if (integers.length > 6) {
        integers = integers.slice(0, 6);
    }

    let formattedInt = "";
    if (integers.length <= 2) {
        formattedInt = integers;
    } else if (integers.length <= 4) {
        const secs = integers.slice(-2);
        const mins = integers.slice(0, -2);
        formattedInt = `${mins}:${secs}`;
    } else {
        const secs = integers.slice(-2);
        const mins = integers.slice(-4, -2);
        const hours = integers.slice(0, -4);
        formattedInt = `${hours}:${mins}:${secs}`;
    }

    if (decimals !== null) {
        // 限制毫秒位數 (最多2位)
        return `${formattedInt}.${decimals.slice(0, 2)}`;
    }

    // 如果使用者剛剛按下 "." (input 結尾是 .)，且 formattedInt 尚未包含 .
    if (input.endsWith('.') && !formattedInt.includes('.')) {
        return `${formattedInt}.`;
    }

    return formattedInt;
}

export function SilencePage() {
    const { t } = useI18n();
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    // Folder and File Selection State
    const [folderPath, setFolderPath] = useState("");
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState("");

    // Audio Player State
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);

    // Segment List State
    const [segments, setSegments] = useState<Segment[]>([
        { id: 1, note: "", startTime: "", endTime: "" }
    ]);
    const [nextId, setNextId] = useState(2);

    const positionIntervalRef = useRef<number | null>(null);

    // Sync playback state
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
            }, 100);
        }

        return () => {
            if (positionIntervalRef.current) {
                clearInterval(positionIntervalRef.current);
                positionIntervalRef.current = null;
            }
        };
    }, [isPlaying, isSeeking]);

    // Keyboard controls
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
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
                    } catch (err) { }
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    const newTimeForward = Math.min(duration, currentTime + SKIP_SECONDS);
                    try {
                        await invoke("seek", { seconds: newTimeForward });
                        setCurrentTime(newTimeForward);
                    } catch (err) { }
                    break;
                case " ":
                    e.preventDefault();
                    handlePlayPause();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLoaded, currentTime, duration, isPlaying]);

    async function handleSelectFolder() {
        try {
            let defaultPath = "02_split";
            const currentProject = await invoke<string | null>("get_current_project_cmd");
            if (currentProject) {
                // Ensure proper path separator handling
                const separator = currentProject.includes("\\") ? "\\" : "/";
                defaultPath = `${currentProject}${separator}02_split`;
            }

            const selected = await open({
                directory: true,
                multiple: false,
                defaultPath,
            });

            if (selected && typeof selected === "string") {
                setFolderPath(selected);
                loadFileList(selected);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        }
    }

    async function loadFileList(path: string) {
        setLoading(true);
        try {
            const files = await invoke<string[]>("list_audio_files", { dirPath: path });
            setFileList(files);
            if (files.length > 0) {
                setSelectedFile(files[0]);
                handleLoadTrack(path, files[0]);
            } else {
                setSelectedFile("");
                setIsLoaded(false);
                setOutput(`${t.loaded}: ${path} (No audio files found)`);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    async function handleFileChange(filename: string) {
        setSelectedFile(filename);
        handleLoadTrack(folderPath, filename);
    }

    async function handleLoadTrack(folder: string, filename: string) {
        if (!folder || !filename) return;
        const fullPath = `${folder}/${filename}`.replace(/\\/g, "/");

        setLoading(true);
        try {
            const durationStr = await invoke<string>("load_track", { path: fullPath });
            const dur = parseFloat(durationStr);
            setDuration(dur);
            setCurrentTime(0);
            setIsLoaded(true);
            setIsPlaying(false);
            setOutput(`${t.loaded}: ${filename}`);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

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

    async function handleSeek(seconds: number) {
        try {
            await invoke("seek", { seconds });
            setCurrentTime(seconds);
        } catch (err) { }
    }

    function formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
    }

    // Segment operations
    function addSegment() {
        setSegments([...segments, { id: nextId, note: "", startTime: "", endTime: "" }]);
        setNextId(nextId + 1);
    }

    function deleteSegment(id: number) {
        if (segments.length > 1) {
            setSegments(segments.filter(s => s.id !== id));
        }
    }

    function updateSegment(id: number, field: keyof Segment, value: string) {
        let formattedValue = value;
        if (field === "startTime" || field === "endTime") {
            formattedValue = formatTimeString(value);
        }

        setSegments(segments.map(s =>
            s.id === id ? { ...s, [field]: formattedValue } : s
        ));
    }

    async function runSilence() {
        setLoading(true);
        setOutput(t.detecting);

        // Eagerly update report folder to 03_silence
        if (folderPath) {
            try {
                const separator = folderPath.includes("\\") ? "\\" : "/";
                let projectRoot = folderPath;
                if (folderPath.endsWith("02_split") || folderPath.endsWith("02_split/")) {
                    const cleanPath = folderPath.replace(/[/\\]$/, "");
                    projectRoot = cleanPath.substring(0, cleanPath.lastIndexOf(separator));
                }

                const silencePath = `${projectRoot}${separator}03_silence`;
                localStorage.setItem("latest_report_folder", silencePath);
            } catch (e) {
                console.error("Failed to set early report path", e);
            }
        }

        try {
            // Checks if we have segments to process manually
            const validSegments = segments.filter(s => s.startTime && s.endTime);

            if (validSegments.length > 0 && selectedFile && folderPath) {
                const fullPath = `${folderPath}/${selectedFile}`.replace(/\\/g, "/");
                const result = await invoke("apply_silence_command", {
                    audioPath: fullPath,
                    segments: validSegments.map(s => ({
                        note: s.note.trim() || null,
                        startTime: s.startTime,
                        endTime: s.endTime
                    }))
                });
                setOutput(result as string);
            } else {
                // If no valid manual segments, maybe fall back to old behavior? 
                // But prompt implies manual mode is the new focus.
                // Or if no segments, show error.
                if (!selectedFile) {
                    throw new Error(t.errorLoadAudio || "No audio loaded");
                }
                if (validSegments.length === 0) {
                    // Try running old auto-detection if the user didn't enter any manual segments?
                    // Or better, assume if they are on this page they might want manual.
                    // Let's call the old command only if the table is "empty-ish" (default state).
                    // But user said "根據目前...填好要消音的片段...按下執行". So manual is primary.
                    throw new Error(t.errorSetSegment || "Please set segments");
                }
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    // 當消音成功後，更新 Report 頁面預設路徑為 03_silence
    useEffect(() => {
        if (output && output.includes("消音處理完成")) {
            const match = output.match(/輸出檔案: (.+)/);
            if (match) {
                const filePath = match[1].trim();
                // 取得資料夾路徑 (移除檔名)
                const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
                if (lastSep > 0) {
                    const dirPath = filePath.substring(0, lastSep);
                    localStorage.setItem("latest_report_folder", dirPath);
                }
            }
        }
    }, [output]);

    return (
        <div>
            <h2 className="page-title">{t.silenceTitle}</h2>
            <p className="page-description">{t.silenceDescription}</p>

            {/* Audio Player Section */}
            <div className="audio-player-wrapper">
                <div className="audio-controls-container">
                    {/* Header: Title + Button + Dropdown */}
                    <div style={{ marginBottom: '16px' }}>
                        <h3 style={{ margin: '0 0 12px 0' }}>🎵 {t.silenceAudioPlayer}</h3>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button className="btn btn-secondary" onClick={handleSelectFolder}>
                                📂 {folderPath ? t.changeFolder : t.selectAudioFolder}
                            </button>
                            {folderPath && (
                                <select
                                    className="custom-file-select"
                                    style={{ flex: 1 }}
                                    value={selectedFile}
                                    onChange={(e) => handleFileChange(e.target.value)}
                                >
                                    {fileList.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    {/* Inner Player Box */}
                    {isLoaded && (
                        <div className="player-inner-box">
                            <div className="player-top-row">
                                <div className="track-info">
                                    <span className="icon">🎵</span>
                                    <span className="track-name">{selectedFile}</span>
                                </div>
                            </div>

                            <div className="player-main-row">
                                <button className="play-btn" onClick={handlePlayPause}>
                                    {isPlaying ? (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
                                        </svg>
                                    ) : (
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                            <path d="M8 5v14l11-7z"></path>
                                        </svg>
                                    )}
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
                    )}
                </div>
            </div>

            {/* Segment Table Section */}
            <div className="segment-table-section" style={{ marginTop: "24px", marginBottom: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <h3 style={{ margin: 0 }}>📋 {t.segmentList}</h3>
                    <button
                        onClick={addSegment}
                        className="btn btn-secondary"
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px" }}
                    >
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
                                <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--border, #444)", width: "200px" }}>{t.segmentNote}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.startTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.endTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "80px" }}>{t.action}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {segments.map((segment) => (
                                <tr key={segment.id} style={{ borderBottom: "1px solid var(--border, #333)" }}>
                                    <td style={{ padding: "8px 4px 8px 12px", width: "200px" }}>
                                        <input
                                            type="text"
                                            value={segment.note}
                                            onChange={(e) => updateSegment(segment.id, "note", e.target.value)}
                                            placeholder={t.segmentNote}
                                            style={{
                                                width: "100%",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.note ? "var(--text-primary, #fff)" : "#888"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "140px" }}>
                                        <input
                                            type="text"
                                            value={segment.startTime}
                                            onChange={(e) => updateSegment(segment.id, "startTime", e.target.value)}
                                            placeholder="00:00:00.000"
                                            style={{
                                                width: "130px",
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
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "140px" }}>
                                        <input
                                            type="text"
                                            value={segment.endTime}
                                            onChange={(e) => updateSegment(segment.id, "endTime", e.target.value)}
                                            placeholder="00:00:00.000"
                                            style={{
                                                width: "130px",
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
                                    <td style={{ padding: "8px 12px", textAlign: "center" }}>
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
                                                transition: "all 0.2s ease"
                                            }}
                                            title={segments.length <= 1 ? t.needAtLeastOneSegment : t.deleteSegment}
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="btn-group">
                <button className="btn btn-primary" onClick={runSilence} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.detecting : t.runDetection}
                </button>
            </div>

            {output && (
                <div className={`output-box ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
