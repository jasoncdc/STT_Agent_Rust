import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function ReportPage() {
    const [apiKey, setApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [folderPath, setFolderPath] = useState("");
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);
    const [converting, setConverting] = useState(false);
    const [reportPath, setReportPath] = useState("");
    const [customPromptPath, setCustomPromptPath] = useState("");

    // 選擇資料夾
    async function handleSelectFolder() {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "選擇音檔資料夾",
            });

            if (selected && typeof selected === "string") {
                setFolderPath(selected);
            }
        } catch (err) {
            setOutput(`選擇資料夾錯誤: ${err}`);
        }
    }

    // 選擇 Prompt 檔案
    async function handleSelectPromptFile() {
        try {
            const selected = await open({
                multiple: false,
                title: "選擇自定義 Prompt (.txt)",
                filters: [{ name: "Text", extensions: ["txt"] }],
            });

            if (selected && typeof selected === "string") {
                setCustomPromptPath(selected);
            }
        } catch (err) {
            setOutput(`選擇 Prompt 檔案錯誤: ${err}`);
        }
    }

    // 生成報告
    async function runReport() {
        if (!apiKey) {
            setOutput("錯誤: 請先輸入 Gemini API Key");
            return;
        }
        if (!folderPath) {
            setOutput("錯誤: 請先選擇音檔資料夾");
            return;
        }

        setLoading(true);
        setOutput("正在處理音檔並生成報告，這可能需要幾分鐘...");
        setReportPath("");

        try {
            const result = await invoke("generate_report", {
                apiKey,
                folderPath,
                customPromptPath: customPromptPath || null,
            });
            setOutput(result as string);

            // 從結果中提取報告路徑
            const match = (result as string).match(/輸出位置: (.+)/);
            if (match) {
                setReportPath(match[1]);
            }
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    // 選擇 MD 檔案
    async function handleSelectMdFile() {
        try {
            const selected = await open({
                multiple: false,
                title: "選擇 Markdown 報告檔案",
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });

            if (selected && typeof selected === "string") {
                setReportPath(selected);
            }
        } catch (err) {
            setOutput(`選擇檔案錯誤: ${err}`);
        }
    }

    // 轉換為 DOCX
    async function convertToDocx() {
        if (!reportPath) {
            setOutput("錯誤: 請先選擇報告檔案");
            return;
        }

        setConverting(true);
        setOutput("正在轉換為 DOCX...");

        try {
            const result = await invoke("convert_md_to_docx", {
                mdPath: reportPath,
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`轉換錯誤: ${err}`);
        } finally {
            setConverting(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">📄 報告生成</h2>
            <p className="page-description">使用 Gemini AI 分析音檔並產出逐字稿報告。</p>

            {/* 資料夾選擇 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">音檔資料夾 (通常是 02_split/)</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={folderPath}
                        placeholder="請選擇資料夾..."
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectFolder}
                    >
                        📁 選擇資料夾
                    </button>
                </div>
            </div>

            {/* API Key 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">Google Gemini API Key</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type={showApiKey ? "text" : "password"}
                        className="input"
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="輸入您的 API Key"
                        value={apiKey}
                        style={{ flex: 1, maxWidth: "400px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowApiKey(!showApiKey)}
                        style={{ minWidth: "80px" }}
                    >
                        {showApiKey ? "🙈 隱藏" : "👁️ 顯示"}
                    </button>
                </div>
            </div>

            {/* 自定義 Prompt 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">自定義 Prompt (選填，.txt)</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={customPromptPath}
                        placeholder="預設使用內建 Prompt，可選 .txt 覆蓋..."
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectPromptFile}
                    >
                        📝 選擇 Prompt
                    </button>
                    {customPromptPath && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => setCustomPromptPath("")}
                            style={{ backgroundColor: "#e74c3c" }}
                        >
                            🗑️ 清除
                        </button>
                    )}
                </div>
            </div>

            {/* 生成按鈕 */}
            <div className="btn-group" style={{ marginBottom: "30px" }}>
                <button
                    className="btn btn-primary"
                    onClick={runReport}
                    disabled={loading || converting}
                >
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "生成中..." : "🚀 生成報告 (自動產出 Word 檔)"}
                </button>
            </div>

            {/* 分隔線 */}
            <hr style={{ margin: "20px 0", borderColor: "#444" }} />

            {/* 轉換為 DOCX 區塊 */}
            <h3 style={{ marginBottom: "15px", fontSize: "1rem", color: "#888" }}>🛠️ 手動工具：轉換 markdown 為 Word 文件</h3>

            <div className="input-group" style={{ marginBottom: "15px" }}>
                <label className="input-label">選擇報告檔案 (.md)</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={reportPath}
                        placeholder="請選擇 report.md 檔案..."
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectMdFile}
                        disabled={converting}
                    >
                        📂 選擇檔案
                    </button>
                </div>
            </div>

            <div className="btn-group">
                <button
                    className="btn btn-primary"
                    onClick={convertToDocx}
                    disabled={loading || converting || !reportPath}
                >
                    {converting && <span className="loading-spinner"></span>}
                    {converting ? "轉換中..." : "📝 轉換為 DOCX"}
                </button>
            </div>

            {/* 輸出區域 */}
            {output && (
                <div
                    className={`output-box ${output.includes("錯誤") ? "error" : ""}`}
                    style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}
                >
                    {output}
                </div>
            )}
        </div>
    );
}
