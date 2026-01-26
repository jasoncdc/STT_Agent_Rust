import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SplitPage() {
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function runSplit() {
        setLoading(true);
        setOutput("執行中...");
        try {
            const result = await invoke("run_split_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">切割模組</h2>
            <p className="page-description">將長錄音切分成小片段，方便後續處理。</p>

            <div className="btn-group">
                <button className="btn btn-primary" onClick={runSplit} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? "執行中..." : "執行切割"}
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
