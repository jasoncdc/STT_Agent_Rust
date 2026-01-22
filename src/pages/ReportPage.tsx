import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ReportPageProps {
    apiKey: string;
}

export function ReportPage({ apiKey }: ReportPageProps) {
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function runReport() {
        if (!apiKey) {
            setOutput("請先在上方輸入 Gemini API Key");
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
            <h2>報告生成 (Report)</h2>
            <p>使用 AI 分析內容並產出報告。</p>
            <button onClick={runReport} disabled={loading}>
                {loading ? "生成中..." : "生成報告"}
            </button>

            {output && (
                <div style={{ marginTop: "10px", padding: "10px", background: "#222", borderRadius: "5px", whiteSpace: "pre-wrap", textAlign: "left" }}>
                    {output}
                </div>
            )}
        </div>
    );
}
