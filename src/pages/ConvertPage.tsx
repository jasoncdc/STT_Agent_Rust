import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

export function ConvertPage() {
    const { t, language } = useI18n();
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function selectFiles() {
        try {
            const files = await open({
                multiple: true,
                filters: [
                    {
                        name: language === "zh" ? "影音檔案" : "Audio/Video Files",
                        extensions: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"],
                    },
                    {
                        name: language === "zh" ? "所有檔案" : "All Files",
                        extensions: ["*"],
                    },
                ],
            });

            if (files) {
                const fileList = Array.isArray(files) ? files : [files];
                setSelectedFiles(fileList);
                setOutput(t.filesSelected.replace("{count}", fileList.length.toString()));
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    async function runConvert() {
        if (selectedFiles.length === 0) {
            setOutput(t.pleaseSelectFile);
            return;
        }

        setLoading(true);
        setOutput(t.converting);

        try {
            const result = await invoke("convert_files_to_mp3", {
                filePaths: selectedFiles,
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    function clearFiles() {
        setSelectedFiles([]);
        setOutput("");
    }

    // Extract filename from path
    const getFileName = (path: string) => {
        return path.split(/[/\\]/).pop() || path;
    };

    // Icons
    const HeroIcon = () => (
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{opacity: 0.8}}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
        </svg>
    );

    return (
        <div className="page-container">
            <header className="page-header">
                <h2 className="page-title">{t.convertTitle}</h2>
                <p className="page-description">{t.convertDescription}</p>
            </header>

            {selectedFiles.length === 0 ? (
                // Hero / Empty State
                <div className="empty-state">
                    <div className="hero-icon-wrapper">
                        <HeroIcon />
                    </div>
                    <h3 className="empty-state-title">
                        {language === 'zh' ? "準備好開始了嗎？" : "Ready to convert?"}
                    </h3>
                    <p className="empty-state-text">
                        {language === 'zh' ? "選擇您的影音檔案以轉換為 MP3" : "Select your audio/video files to convert to MP3"}
                    </p>
                    <button className="btn btn-primary btn-large" onClick={selectFiles} disabled={loading}>
                        <span className="icon">📂</span> {t.selectFiles}
                    </button>
                </div>
            ) : (
                // Active State
                <div className="active-view fade-in-up">
                    <div className="action-bar display-flex gap-2 mb-4">
                        <button className="btn btn-secondary" onClick={selectFiles} disabled={loading}>
                            <span className="icon">📂</span> {t.selectFiles}
                        </button>
                        <button className="btn btn-secondary" onClick={clearFiles} disabled={loading}>
                            <span className="icon">🗑</span> {t.clear}
                        </button>
                    </div>

                    <div className="file-list-card">
                        <div className="file-list-header">
                            {t.selectedFiles} 
                            <span className="badge">{selectedFiles.length}</span>
                        </div>
                        <ul className="file-list">
                            {selectedFiles.map((file, index) => (
                                <li key={index} className="file-list-item">
                                    <span className="file-icon">🎵</span>
                                    <span className="file-name">{getFileName(file)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="action-footer mt-4">
                        <button 
                            className="btn btn-primary" 
                            onClick={runConvert} 
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="loading-spinner"></span>
                                    {t.converting}
                                </>
                            ) : (
                                t.startConvert
                            )}
                        </button>
                    </div>
                </div>
            )}

            {output && (
                <div className={`output-box mt-4 fade-in-up ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
