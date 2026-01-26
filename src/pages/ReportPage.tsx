import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ReportPage() {
    const [apiKey, setApiKey] = useState("");
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function runReport() {
        if (!apiKey) {
            setOutput("請先輸入 Gemini API Key");
            return;
        }
        setLoading(true);
        setOutput("正在呼叫 Gemini 生成報告...");
        try {
            const result = await invoke("run_report_cmd", { apiKey });
            setOutput(`Gemini 回覆:\n${result}`);
        } catch (err) {
            setOutput(`發生錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">報告生成</h2>
            <p className="page-description">使用 AI 分析內容並產出報告。</p>

            <div className="input-group">
                <label className="input-label">Google Gemini API Key</label>
                <input
                    type="password"
                    className="input"
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="輸入您的 API Key"
                    value={apiKey}
                    style={{ maxWidth: "400px" }}
                />
            </div>

            <div className="btn-group">
                <button className="btn btn-primary" onClick={runReport} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "生成中..." : "生成報告"}
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
