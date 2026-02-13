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

    const [logs, setLogs] = useState<string[]>([]);
    const [results, setResults] = useState<TranscribeResponse | null>(null);
    const [highlightedSegment, setHighlightedSegment] = useState<Segment | null>(null);

    // Audio Player & File Selection State
    const [folderPath, setFolderPath] = useState("");

    const [selectedFile, setSelectedFile] = useState("");
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);

    // Ref to track current time for event handlers without re-binding
    const currentTimeRef = useRef(0);
    useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    // Batch Processing State
    const [batchFolder, setBatchFolder] = useState("");
    const [batchFiles, setBatchFiles] = useState<string[]>([]);
    const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
    const [batchProgress, setBatchProgress] = useState<{ [key: string]: 'pending' | 'processing' | 'done' | 'error' }>({});
    const [isBatchRunning, setIsBatchRunning] = useState(false);

    // Load transcription result if exists
    async function getJsonPath(fullPath: string) {
        // fullPath: .../02_split/filename.mp3
        // target: .../silence_reg/filename.mp3.json
        // We need to construct this carefully.

        // Assumption: folderPath is .../02_split or similar deep path inside project
        // But user said "same level as 01_convert". 
        // If we are in "CurrentProject/02_split", we want "CurrentProject/silence_reg".

        // Let's try to find project root from folderPath if possible, or use the checked out project root.
        // We can get current project root from backend.

        try {
            const currentProject = await invoke<string | null>("get_current_project_cmd");
            if (currentProject && fullPath.startsWith(currentProject)) {
                const fileName = fullPath.split(/[\\/]/).pop();
                return `${currentProject}/.silence_reg/${fileName}.json`.replace(/\\/g, "/");
            }
        } catch (e) { console.error(e); }

        // Fallback or if not in project (shouldn't happen with current flow)
        return fullPath + ".json";
    }

    async function tryLoadTranscript(fullPath: string) {
        try {
            const jsonPath = await getJsonPath(fullPath);
            const exists = await invoke<boolean>("check_file_exists", { path: jsonPath });
            if (exists) {
                const content = await invoke<string>("read_text_file", { path: jsonPath });
                const data = JSON.parse(content);
                setResults(data);
                addToLog(`${t.loaded}: Transcript found.`);
            } else {
                setResults(null);
                // addToLog("No transcript found for this file.");
            }
        } catch (e) {
            console.error(e);
            setResults(null);
        }
    }


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

            // Show success notification
            alert(`${t.success || "Success"}: Silenced ${segmentsToSilence.length} segments.`);

            // Optionally reload to reflect changes? (Not requested but good practice if file changed)
            // handleLoadTrack(folderPath, selectedFile); 
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
            // Only handle if audio is loaded and not typing in an input
            if (!isLoaded) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const SKIP_SECONDS = 5;

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    // Use ref to get fresh time
                    const newTimeBack = Math.max(0, currentTimeRef.current - SKIP_SECONDS);
                    setCurrentTime(newTimeBack); // Optimistic update
                    try {
                        await invoke("seek", { seconds: newTimeBack });
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case "ArrowRight":
                    e.preventDefault();
                    // Use ref to get fresh time
                    const newTimeForward = Math.min(duration, currentTimeRef.current + SKIP_SECONDS);
                    setCurrentTime(newTimeForward); // Optimistic update
                    try {
                        await invoke("seek", { seconds: newTimeForward });
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case " ": // Space bar
                    e.preventDefault();
                    await handlePlayPause();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLoaded, duration]); // Removed isPlaying to avoid re-bind, added duration

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
    // handleSelectFolder and loadFileList removed as they are replaced by batch logic


    // Correct implementation of helper
    async function selectBatchFolderAction() {
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
                setBatchFolder(selected);
                setFolderPath(selected); // Keep this for player compatibility? Or separate? 
                // User wants player dropdown to only show selected files.
                // So player's "fileList" should be derived from "batchSelected".

                const files = await invoke<string[]>("list_audio_files", { dirPath: selected });
                setBatchFiles(files);
                setBatchSelected(new Set(files)); // Default select all
                setBatchProgress({});
            }
        } catch (err) {
            addToLog(`${t.error}: ${err}`);
        }
    }

    async function startBatchTranscription() {
        if (!isConnected) {
            alert(t.serverOffline);
            return;
        }
        if (batchSelected.size === 0) return;

        setIsBatchRunning(true);
        const filesToProcess = Array.from(batchSelected);

        // Initialize progress
        const initialProgress = { ...batchProgress };
        filesToProcess.forEach(f => initialProgress[f] = 'pending');
        setBatchProgress(initialProgress);

        for (const filename of filesToProcess) {
            // Check if cancelled? (Optional)

            setBatchProgress(prev => ({ ...prev, [filename]: 'processing' }));
            const fullPath = `${batchFolder}/${filename}`.replace(/\\/g, "/");

            try {
                // Scroll into view logic could go here
                addToLog(`Transcribing ${filename}...`);

                const res: TranscribeResponse = await invoke('transcribe_audio', {
                    ip: ip,
                    filePath: fullPath
                });

                // Save JSON
                const jsonPath = await getJsonPath(fullPath);

                // Ensure directory exists
                const jsonDir = jsonPath.substring(0, jsonPath.lastIndexOf("/"));
                await invoke("ensure_dir_exists", { path: jsonDir });

                await invoke('save_text_file', {
                    path: jsonPath,
                    content: JSON.stringify(res, null, 2)
                });

                setBatchProgress(prev => ({ ...prev, [filename]: 'done' }));
                addToLog(`Saved transcript for ${filename}`);

            } catch (e) {
                console.error(e);
                setBatchProgress(prev => ({ ...prev, [filename]: 'error' }));
                addToLog(`Error ${filename}: ${e}`);
            }
        }
        setIsBatchRunning(false);

        // Auto-load the first file's result into the player if not playing
        if (filesToProcess.length > 0 && !isPlaying && !selectedFile) {
            handleFileChange(filesToProcess[0]);
        }
    }

    // loadFileList removed


    async function handleFileChange(filename: string) {
        if (filename === selectedFile) return;
        setSelectedFile(filename);

        // Load audio
        handleLoadTrack(batchFolder || folderPath, filename);

        // Clear selection state
        setSelectedIndices(new Set());
        setHighlightedSegment(null);

        // Try load transcript
        const fullPath = `${batchFolder || folderPath}/${filename}`.replace(/\\/g, "/");
        tryLoadTranscript(fullPath);
    }

    // Track last loaded file to prevent duplicate logs/loads
    const lastLoadedRef = useRef<{ file: string; time: number } | null>(null);

    async function handleLoadTrack(folder: string, filename: string) {
        if (!folder || !filename) return;

        // Prevent duplicate load if same file loaded within 2 seconds
        const now = Date.now();
        if (
            lastLoadedRef.current &&
            lastLoadedRef.current.file === filename &&
            now - lastLoadedRef.current.time < 2000
        ) {
            return;
        }
        lastLoadedRef.current = { file: filename, time: now };

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

    // handleTranscribe removed


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
            {/* Main Action Area */}
            {isConnected && (
                <div style={{ marginTop: '20px' }}>

                    {/* Batch Selection Section */}
                    <div className="batch-section" style={{
                        background: 'var(--bg-secondary)',
                        padding: '16px',
                        borderRadius: '8px',
                        marginBottom: '20px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0 }}>📂 {t.batchTranscription || "Batch Transcription"}</h3>
                            <button className="btn btn-secondary" onClick={selectBatchFolderAction} disabled={isBatchRunning}>
                                {batchFolder ? t.changeFolder : t.selectAudioFolder || "Select Folder"}
                            </button>
                        </div>

                        {batchFolder && (
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px',
                                    padding: '8px'
                                }}>
                                    {/* Select All Header */}
                                    <div style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={batchSelected.size === batchFiles.length && batchFiles.length > 0}
                                                onChange={(e) => {
                                                    if (e.target.checked) setBatchSelected(new Set(batchFiles));
                                                    else setBatchSelected(new Set());
                                                }}
                                                disabled={isBatchRunning}
                                                style={{ marginRight: '8px' }}
                                            />
                                            <strong>{t.selectAll} ({batchSelected.size}/{batchFiles.length})</strong>
                                        </label>
                                    </div>

                                    {/* File List */}
                                    {batchFiles.map(f => (
                                        <div key={f} style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={batchSelected.has(f)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(batchSelected);
                                                        if (e.target.checked) newSet.add(f);
                                                        else newSet.delete(f);
                                                        setBatchSelected(newSet);
                                                    }}
                                                    disabled={isBatchRunning}
                                                    style={{ marginRight: '8px' }}
                                                />
                                                <span style={{ flex: 1 }}>{f}</span>
                                            </label>

                                            {/* Status Badge */}
                                            {batchProgress[f] && (
                                                <span style={{
                                                    fontSize: '0.8em',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: batchProgress[f] === 'done' ? '#4caf50' :
                                                        batchProgress[f] === 'error' ? '#f44336' :
                                                            batchProgress[f] === 'processing' ? '#ff9800' : '#888',
                                                    color: '#fff'
                                                }}>
                                                    {batchProgress[f]}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <button
                                    className="btn btn-accent"
                                    style={{ marginTop: '12px', width: '100%' }}
                                    onClick={startBatchTranscription}
                                    disabled={isBatchRunning || batchSelected.size === 0}
                                >
                                    {isBatchRunning ? (
                                        <><span className="loading-spinner"></span> {t.processing}...</>
                                    ) : (
                                        <>🚀 {t.startBatch || "Start Batch Transcription"}</>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="audio-player-wrapper">
                        <div className="audio-controls-container">
                            <h3 style={{ margin: '0 0 16px 0' }}>🎵 {t.audioPlayer || "Audio Player"}</h3>

                            {/* Dropdown - Only show selected items */}
                            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                                {batchSelected.size > 0 && (
                                    <select
                                        className="custom-file-select"
                                        style={{ flex: 1 }}
                                        value={selectedFile}
                                        onChange={(e) => handleFileChange(e.target.value)}
                                    >
                                        <option value="" disabled>Select a file to review</option>
                                        {Array.from(batchSelected).map((f) => (
                                            <option key={f} value={f}>{f} {batchProgress[f] === 'done' ? '✅' : ''}</option>
                                        ))}
                                    </select>
                                )}
                                {batchSelected.size === 0 && <div style={{ color: '#888' }}>Please select files in the section above first.</div>}
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

                        </div>


                        {/* Remove old Transcribe Button from here */}
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
