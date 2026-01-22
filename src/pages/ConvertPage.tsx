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

    return (
        <div>
            <h2>轉檔模組 (Convert)</h2>
            <p>將影音檔案轉換為 MP3 格式，儲存至 ~/Downloads</p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
                <button onClick={selectFiles} disabled={loading}>
                    選擇檔案
                </button>
                <button onClick={runConvert} disabled={loading || selectedFiles.length === 0}>
                    {loading ? "轉檔中..." : "開始轉檔"}
                </button>
                <button onClick={clearFiles} disabled={loading}>
                    清除
                </button>
            </div>

            {selectedFiles.length > 0 && (
                <div style={{ marginBottom: "15px", padding: "10px", background: "#333", borderRadius: "5px", maxHeight: "150px", overflow: "auto" }}>
                    <strong>已選擇的檔案 ({selectedFiles.length})：</strong>
                    <ul style={{ margin: "5px 0", paddingLeft: "20px" }}>
                        {selectedFiles.map((file, index) => (
                            <li key={index} style={{ fontSize: "12px", wordBreak: "break-all" }}>
                                {file}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {output && (
                <div style={{ marginTop: "10px", padding: "10px", background: "#222", borderRadius: "5px", whiteSpace: "pre-wrap" }}>
                    {output}
                </div>
            )}
        </div>
    );
}
