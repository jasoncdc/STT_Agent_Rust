import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function ConvertPage() {
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function selectFiles() {
        try {
            const files = await open({
                multiple: true,
                filters: [
                    {
                        name: "影音檔案",
                        extensions: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"],
                    },
                    {
                        name: "所有檔案",
                        extensions: ["*"],
                    },
                ],
            });

            if (files) {
                const fileList = Array.isArray(files) ? files : [files];
                setSelectedFiles(fileList);
                setOutput(`已選擇 ${fileList.length} 個檔案`);
            }
        } catch (err) {
            setOutput(`選擇檔案錯誤: ${err}`);
        }
    }

    async function runConvert() {
        if (selectedFiles.length === 0) {
            setOutput("請先選擇檔案！");
            return;
        }

        setLoading(true);
        setOutput("轉檔中，請稍候...");

        try {
            const result = await invoke("convert_files_to_mp3", {
                filePaths: selectedFiles,
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
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
            <h2 className="page-title">轉檔模組</h2>
            <p className="page-description">將影音檔案轉換為 MP3 格式</p>

            <div className="btn-group">
                <button className="btn btn-secondary" onClick={selectFiles} disabled={loading}>
                    選擇檔案
                </button>
                <button className="btn btn-primary" onClick={runConvert} disabled={loading || selectedFiles.length === 0}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "轉檔中..." : "開始轉檔"}
                </button>
                <button className="btn btn-secondary" onClick={clearFiles} disabled={loading}>
                    清除
                </button>
            </div>

            {selectedFiles.length > 0 && (
                <div className="file-list-card">
                    <div className="file-list-header">已選擇的檔案 ({selectedFiles.length})</div>
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
                <div className={`output-box ${output.includes("錯誤") ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
