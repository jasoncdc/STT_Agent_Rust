import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useI18n } from '../i18n';

interface Segment {
    start: number;
    end: number;
    text: string;
    name: string;
    start_idx?: number;
    end_idx?: number;
}

interface PlaybackState {
    position: number;
    duration: number;
    is_playing: boolean;
}

interface TranscribeResponse {
    filename: string;
    duration: number;
    segments: Segment[];
    full_text: string;
}

export function SilenceAutoPage() {
    const { t } = useI18n();
    const [ip, setIp] = useState("http://127.0.0.1:8000");
    const [history, setHistory] = useState<string[]>([]);
    const [isConnected, setIsConnected] = useState<boolean | null>(null); // null=unknown, true=connected, false=disconnected
    const [isConnecting, setIsConnecting] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [results, setResults] = useState<TranscribeResponse | null>(null);
    const [highlightedSegment, setHighlightedSegment] = useState<Segment | null>(null);

    // Audio Player & File Selection State
    const [folderPath, setFolderPath] = useState("");
    const [fileList, setFileList] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    async function handleSilenceSelected() {
        if (selectedIndices.size === 0 || !results || !folderPath || !selectedFile) return;

        const fullPath = `${folderPath}/${selectedFile}`.replace(/\\/g, "/");

        // Filter and map segments to the format expected by apply_silence_command
        const segmentsToSilence = results.segments
            .filter((_, idx) => selectedIndices.has(idx))
            .map(s => ({
                note: s.name || "",
                startTime: formatTime(s.start),
                endTime: formatTime(s.end)
            }));

        try {
            addToLog(`Silencing ${segmentsToSilence.length} segments...`);
            const result = await invoke("apply_silence_command", {
                audioPath: fullPath,
                segments: segmentsToSilence
            });
            addToLog(`${t.success || "Success"}: ${result}`);
        } catch (err) {
            addToLog(`${t.error}: ${err}`);
        }
    }



    // Sync playback state with optimized polling
    useEffect(() => {
        let timerId: number | null = null;
        let isCancelled = false;

        const pollState = async () => {
            if (isCancelled) return;
            try {
                if (isPlaying && !isSeeking) {
                    const state = await invoke<PlaybackState>("get_playback_state");
                    if (!isCancelled) {
                        setCurrentTime(state.position);
                        setIsPlaying(state.is_playing);
                    }
                }
            } catch (err) {
                console.error("Failed to get playback state:", err);
            }

            // Schedule next poll only if still playing and not seeking
            if (!isCancelled && isPlaying && !isSeeking) {
                timerId = window.setTimeout(pollState, 100);
            }
        };

        // Delay the first poll slightly to avoid race condition with handlePlayPause optimistic state
        if (isPlaying && !isSeeking) {
            timerId = window.setTimeout(pollState, 100);
        }

        return () => {
            isCancelled = true;
            if (timerId) clearTimeout(timerId);
        };
    }, [isPlaying, isSeeking]);

    // Keyboard controls
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (!isLoaded) return;
            // Ignore if typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.code === "Space") {
                e.preventDefault();
                await handlePlayPause();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLoaded, isPlaying]);

    // Custom dropdown state
    const [showHistory, setShowHistory] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Load history from localStorage
    useEffect(() => {
        const saved = localStorage.getItem("server-ip-history");
        if (saved) {
            try {
                setHistory(JSON.parse(saved));
            } catch (e) { console.error("Failed to parse history", e); }
        }

        // Auto-connect on mount
        checkConnection(ip);

        // Click outside to close dropdown
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowHistory(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Helper functions for Audio Player
    async function handleSelectFolder() {
        try {
            let defaultPath = "02_split";
            const currentProject = await invoke<string | null>("get_current_project_cmd");
            if (currentProject) {
                defaultPath = currentProject + "/02_split";
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
            addToLog(`${t.error}: ${err}`);
        }
    }

    async function loadFileList(path: string) {
        try {
            const files = await invoke<string[]>("list_audio_files", { dirPath: path });
            setFileList(files);
            if (files.length > 0) {
                setSelectedFile(files[0]);
                handleLoadTrack(path, files[0]);
            } else {
                setSelectedFile("");
                setIsLoaded(false);
                addToLog(`${path} (No audio files found)`);
            }
        } catch (err) {
            addToLog(`${t.error}: ${err}`);
        }
    }

    async function handleFileChange(filename: string) {
        setSelectedFile(filename);
        handleLoadTrack(folderPath, filename);
    }

    async function handleLoadTrack(folder: string, filename: string) {
        if (!folder || !filename) return;
        const fullPath = `${folder}/${filename}`.replace(/\\/g, "/");

        try {
            const durationStr = await invoke<string>("load_track", { path: fullPath });
            const dur = parseFloat(durationStr);
            setDuration(dur);
            setCurrentTime(0);
            setIsLoaded(true);
            setIsPlaying(false);
            addToLog(`${t.loaded}: ${filename}`);
        } catch (err) {
            addToLog(`${t.error}: ${err}`);
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
            addToLog(`${t.error}: ${err}`);
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

    const addToLog = (msg: string) => {
        setLogs(prev => {
            const newLogs = [...prev, `${new Date().toLocaleTimeString()} - ${msg}`];
            return newLogs.slice(-50); // Keep only the last 50 logs
        });
    };

    const saveHistory = (newIp: string) => {
        let newHistory = [...history];
        if (!newHistory.includes(newIp)) {
            newHistory = [newIp, ...newHistory].slice(0, 5); // Keep last 5
            setHistory(newHistory);
            localStorage.setItem("server-ip-history", JSON.stringify(newHistory));
        }
    };

    const removeHistory = (targetIp: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent item selection when clicking delete
        const newHistory = history.filter(h => h !== targetIp);
        setHistory(newHistory);
        localStorage.setItem("server-ip-history", JSON.stringify(newHistory));
    };

    const checkConnection = async (targetIp: string) => {
        setIsConnecting(true);
        addToLog(`${t.connecting} ${targetIp}...`);
        try {
            const alive: boolean = await invoke('connect_server', { ip: targetIp });
            setIsConnected(alive);
            if (alive) {
                addToLog(`${t.serverOnline} 🟢`);
                saveHistory(targetIp);
            } else {
                addToLog(`${t.serverOffline} 🔴`);
            }
            setShowHistory(false); // Close dropdown on connect attempt
        } catch (e) {
            setIsConnected(false);
            addToLog(`${t.error}: ${e}`);
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = () => {
        setIsConnected(null); // Reset to unknown/base state
        addToLog("Disconnected manually.");
    };

    const handleTranscribe = async () => {
        if (!isConnected) {
            alert(t.serverOffline);
            return;
        }

        if (!folderPath || !selectedFile) {
            alert(t.errorLoadAudio || "Please select an audio file first.");
            return;
        }

        const fullPath = `${folderPath}/${selectedFile}`.replace(/\\/g, "/");

        try {
            setTranscribing(true);
            addToLog(`${t.processingAudio} ${selectedFile}...`);

            const res: TranscribeResponse = await invoke('transcribe_audio', {
                ip: ip,
                filePath: fullPath
            });

            setResults(res);
            addToLog(`${t.results}: Found ${res.segments.length} segments.`);
        } catch (e) {
            addToLog(`${t.error}: ${e}`);
            alert(`${t.error}: ${e}`);
        } finally {
            setTranscribing(false);
        }
    };

    return (
        <div className="container" style={{ padding: '20px', color: 'var(--text-primary)' }}>
            <h2>{t.silenceAutoTitle}</h2>

            {/* Connection Area */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px', padding: '15px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>

                {/* Custom Input Group */}
                <div style={{ position: 'relative', width: '300px' }} ref={dropdownRef}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '12px',
                        overflow: 'hidden'
                    }}>
                        <input
                            type="text"
                            value={ip}
                            onChange={(e) => setIp(e.target.value)}
                            onFocus={() => setShowHistory(true)}
                            placeholder={t.serverIp as string}
                            style={{
                                flex: 1,
                                padding: '10px 15px',
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                fontSize: '1rem'
                            }}
                        />
                        <button
                            className="btn-icon"
                            onClick={() => setShowHistory(!showHistory)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                padding: '0 15px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            ▼
                        </button>
                    </div>

                    {/* Custom Dropdown List */}
                    {showHistory && history.length > 0 && (
                        <div style={{
                            position: 'absolute',
                            top: '100%', left: 0, right: 0,
                            zIndex: 100,
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                            marginTop: '4px'
                        }}>
                            {history.map((h, i) => (
                                <div
                                    key={i}
                                    onClick={() => { setIp(h); setShowHistory(false); }}
                                    style={{
                                        padding: '8px 12px',
                                        borderBottom: i < history.length - 1 ? '1px solid var(--border-color)' : 'none',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ flex: 1 }}>{h}</span>
                                    <span
                                        onClick={(e) => removeHistory(h, e)}
                                        style={{
                                            color: '#ff6b6b',
                                            fontWeight: 'bold',
                                            padding: '2px 8px',
                                            borderRadius: '4px',
                                            marginLeft: '10px',
                                            cursor: 'pointer'
                                        }}
                                        title={t.deleteFromHistory as string}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#ff6b6b22'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        ✕
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {isConnected ? (
                    <button
                        className="btn"
                        onClick={handleDisconnect}
                        style={{ backgroundColor: '#f44336', color: 'white', border: 'none' }}
                    >
                        {t.disconnect as string}
                    </button>
                ) : (
                    <button
                        className="btn btn-primary"
                        onClick={() => checkConnection(ip)}
                        disabled={isConnecting}
                    >
                        {isConnecting ? t.connecting : t.connect}
                    </button>
                )}

                {/* Status Light */}
                <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: isConnected === true ? '#4caf50' : isConnected === false ? '#f44336' : '#9e9e9e',
                    boxShadow: isConnected === true ? '0 0 10px #4caf50' : 'none',
                    transition: 'all 0.3s'
                }} title={isConnected === true ? (t.serverOnline as string) : (t.serverOffline as string)}></div>
            </div>

            {/* Main Action Area */}
            {/* Main Action Area */}
            {isConnected && (
                <div style={{ marginTop: '20px' }} className="audio-player-wrapper">
                    <div className="audio-controls-container">
                        <h3 style={{ margin: '0 0 16px 0' }}>🎵 {t.audioPlayer || "Audio Player"}</h3>

                        {/* Folder & File Selection */}
                        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                            <button className="btn btn-secondary" onClick={handleSelectFolder}>
                                📂 {folderPath ? t.changeFolder : t.selectAudioFolder || "Select Folder"}
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

                        {/* Audio Player Controls */}
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

                        {/* Transcribe Button */}
                        <div style={{ marginTop: '20px', textAlign: 'center' }}>
                            <button
                                className="btn btn-accent"
                                style={{
                                    padding: '12px 30px',
                                    fontSize: '1.1em',
                                    width: '100%',
                                    maxWidth: '300px',
                                    opacity: (!selectedFile || transcribing) ? 0.6 : 1,
                                    cursor: (!selectedFile || transcribing) ? 'not-allowed' : 'pointer'
                                }}
                                onClick={handleTranscribe}
                                disabled={!selectedFile || transcribing}
                            >
                                {transcribing ? (
                                    <>
                                        <span className="loading-spinner" style={{ marginRight: '8px' }}></span>
                                        {t.processingAudio}
                                    </>
                                ) : (
                                    <>🚀 {t.startTranscribe || "Start Transcribing"}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Results Area */}
            {results && (
                <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <h3>{t.results} ({results.segments.length})</h3>

                        {/* Silence Controls */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                className="btn btn-secondary"
                                style={{ padding: '5px 10px', fontSize: '0.9em' }}
                                onClick={() => {
                                    if (selectedIndices.size === results.segments.length) {
                                        setSelectedIndices(new Set());
                                    } else {
                                        setSelectedIndices(new Set(results.segments.map((_, i) => i)));
                                    }
                                }}
                            >
                                {selectedIndices.size === results.segments.length ? (t.deselectAll || "Deselect All") : (t.selectAll || "Select All")}
                            </button>

                            <button
                                className="btn btn-accent"
                                style={{
                                    padding: '5px 15px',
                                    fontSize: '0.9em',
                                    backgroundColor: selectedIndices.size > 0 ? '#ff9800' : 'var(--bg-tertiary)',
                                    cursor: selectedIndices.size > 0 ? 'pointer' : 'not-allowed',
                                    opacity: selectedIndices.size > 0 ? 1 : 0.6
                                }}
                                onClick={handleSilenceSelected}
                                disabled={selectedIndices.size === 0}
                            >
                                🔇 {t.silenceSelected || "Silence Selected"} ({selectedIndices.size})
                            </button>
                        </div>
                    </div>

                    <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--bg-secondary)', padding: '10px', borderRadius: '8px' }}>
                        {results.segments.length === 0 ? <p>No names found.</p> : (
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {results.segments.map((seg, idx) => (
                                    <li
                                        key={idx}
                                        style={{
                                            padding: '8px',
                                            borderBottom: '1px solid var(--border-color)',
                                            backgroundColor: highlightedSegment === seg ? 'var(--highlight-item-bg)' : 'transparent',
                                            borderRadius: '4px',
                                            marginBottom: '2px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (highlightedSegment !== seg) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (highlightedSegment !== seg) e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedIndices.has(idx)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                const newSet = new Set(selectedIndices);
                                                if (e.target.checked) newSet.add(idx);
                                                else newSet.delete(idx);
                                                setSelectedIndices(newSet);
                                            }}
                                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                        />

                                        <div
                                            style={{ flex: 1, cursor: 'pointer' }}
                                            onClick={() => setHighlightedSegment(seg)}
                                        >
                                            <strong>{seg.text}</strong> : {seg.name} ({(seg.end - seg.start).toFixed(2)}s)
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div style={{ marginTop: '10px' }}>
                        <h4>{t.fullTranscript}</h4>
                        <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                            {/* Render logic inline or call helper */}
                            {(() => {
                                if (!highlightedSegment || highlightedSegment.start_idx === undefined || highlightedSegment.end_idx === undefined) {
                                    return results.full_text;
                                }
                                const start = highlightedSegment.start_idx;
                                const end = highlightedSegment.end_idx;
                                if (start < 0 || end > results.full_text.length || start >= end) return results.full_text;

                                const before = results.full_text.substring(0, start);
                                const match = results.full_text.substring(start, end);
                                const after = results.full_text.substring(end);
                                return (
                                    <>
                                        {before}
                                        <span style={{
                                            backgroundColor: 'var(--highlight-match-bg)',
                                            color: 'var(--highlight-match-text)',
                                            padding: '0 2px',
                                            borderRadius: '2px',
                                            border: '1px solid var(--highlight-match-border)',
                                            fontWeight: 'bold',
                                            boxShadow: '0 0 5px rgba(255, 215, 0, 0.5)'
                                        }}>{match}</span>
                                        {after}
                                    </>
                                );
                            })()}
                        </p>
                    </div>
                </div>
            )}

            {/* Logs */}
            <div style={{ marginTop: '30px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                <h4>{t.logs}</h4>
                <div style={{ maxHeight: '100px', overflowY: 'auto', background: '#00000033', padding: '5px' }}>
                    {logs.map((log, i) => <div key={i}>{log}</div>)}
                </div>
            </div>
        </div>
    );
}
