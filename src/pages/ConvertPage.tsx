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

    return (
        <div>
            <h2 className="page-title">{t.convertTitle}</h2>
            <p className="page-description">{t.convertDescription}</p>

            <div className="btn-group">
                <button className="btn btn-secondary" onClick={selectFiles} disabled={loading}>
                    {t.selectFiles}
                </button>
                <button className="btn btn-primary" onClick={runConvert} disabled={loading || selectedFiles.length === 0}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.converting : t.startConvert}
                </button>
                <button className="btn btn-secondary" onClick={clearFiles} disabled={loading}>
                    {t.clear}
                </button>
            </div>

            {selectedFiles.length > 0 && (
                <div className="file-list-card">
                    <div className="file-list-header">{t.selectedFiles} ({selectedFiles.length})</div>
                    <ul className="file-list">
                        {selectedFiles.map((file, index) => (
                            <li key={index} className="file-list-item">
                                {getFileName(file)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {output && (
                <div className={`output-box ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
