import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SilencePage() {
    const [output, setOutput] = useState("");

    async function runSilence() {
        setOutput("執行中...");
        try {
            const result = await invoke("run_silence_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        }
    }

    return (
        <div>
            <h2>靜音偵測 (Silence)</h2>
            <p>分析音訊中的靜音片段並進行處理。</p>
            <button onClick={runSilence}>執行偵測</button>

            {output && (
                <div style={{ marginTop: "10px", padding: "10px", background: "#222", borderRadius: "5px" }}>
                    {output}
                </div>
            )}
        </div>
    );
}
