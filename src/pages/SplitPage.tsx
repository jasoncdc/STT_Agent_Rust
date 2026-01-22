import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function SplitPage() {
    const [output, setOutput] = useState("");

    async function runSplit() {
        setOutput("執行中...");
        try {
            const result = await invoke("run_split_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`錯誤: ${err}`);
        }
    }

    return (
        <div>
            <h2>切割模組 (Split)</h2>
            <p>將長錄音切分成小片段。</p>
            <button onClick={runSplit}>執行切割</button>

            {output && (
                <div style={{ marginTop: "10px", padding: "10px", background: "#222", borderRadius: "5px" }}>
                    {output}
                </div>
            )}
        </div>
    );
}
