import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SilencePage() {
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function runSilence() {
        setLoading(true);
        setOutput("執行中...");
        try {
            const result = await invoke("run_silence_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">靜音偵測</h2>
            <p className="page-description">分析音訊中的靜音片段並進行處理。</p>

            <div className="btn-group">
                <button className="btn btn-primary" onClick={runSilence} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "偵測中..." : "執行偵測"}
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
