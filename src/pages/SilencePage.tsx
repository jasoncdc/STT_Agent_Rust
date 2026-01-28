import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "../i18n";

export function SilencePage() {
    const { t } = useI18n();
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    async function runSilence() {
        setLoading(true);
        setOutput(t.processing);
        try {
            const result = await invoke("run_silence_cmd");
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="page-title">{t.silenceTitle}</h2>
            <p className="page-description">{t.silenceDescription}</p>

            <div className="btn-group">
                <button className="btn btn-primary" onClick={runSilence} disabled={loading}>
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.detecting : t.runDetection}
                </button>
            </div>

            {output && (
                <div className={`output-box ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}
