import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { ModelPricingModal, ModelPricing } from "../components/ModelPricingModal";

interface AdjustPageProps {
    isActive?: boolean;
    apiKey: string;
    setApiKey: (key: string) => void;
}

/** 案件底下的既知子資料夾，與後端 adjust.rs 的 CASE_SUBFOLDERS 對應 */
const CASE_SUBFOLDERS = [
    "01_convert", "01_converted", "02_split",
    "03_audio", "03_silence", "04_report", "05_adjust",
];

/**
 * 由音檔資料夾推導出 04_report 的路徑，作為選檔對話框的起始位置。
 * 純屬體感優化——實際的輸出位置由後端 output_dir_for_source 決定。
 */
function deriveReportFolder(p: string): string {
    const sep = p.includes("\\") ? "\\" : "/";
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return p;
    const last = parts[parts.length - 1];
    const root = CASE_SUBFOLDERS.includes(last) ? parts.slice(0, -1) : parts;
    const prefix = p.startsWith("/") ? "/" : "";
    return prefix + [...root, "04_report"].join(sep);
}

/** 取出所在資料夾，作為下次選檔的起始位置 */
function dirNameOf(p: string): string {
    const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
    return idx > 0 ? p.slice(0, idx) : p;
}

export function AdjustPage({ isActive, apiKey, setApiKey }: AdjustPageProps) {
    const { t, language } = useI18n();

    const [showApiKey, setShowApiKey] = useState(false);
    const [sourcePath, setSourcePath] = useState("");
    const [promptPath, setPromptPath] = useState("");
    const [modelName, setModelName] = useState("gemini-2.5-pro");
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [pricingMap, setPricingMap] = useState<Record<string, ModelPricing>>({});
    const [showPriceModal, setShowPriceModal] = useState(false);
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 載入定價表（供排序與定價彈窗使用）
    useEffect(() => {
        invoke<ModelPricing[]>("fetch_gemini_pricing")
            .then((list) => {
                const map: Record<string, ModelPricing> = {};
                list.forEach((p) => { map[p.model_id] = p; });
                setPricingMap(map);
            })
            .catch(() => { });
    }, []);

    function sortModelsByPrice(models: string[]): string[] {
        return [...models].sort((a, b) => {
            const pa = pricingMap[a]?.sort_price ?? 9999;
            const pb = pricingMap[b]?.sort_price ?? 9999;
            if (pa !== pb) return pa - pb;
            return a.localeCompare(b);
        });
    }

    async function fetchAvailableModels(key: string) {
        if (!key) return;
        setModelsLoading(true);
        try {
            const models = await invoke<string[]>("list_gemini_models", { apiKey: key });
            const sorted = sortModelsByPrice(models);
            setAvailableModels(sorted);
            if (sorted.length > 0 && !sorted.includes(modelName)) {
                setModelName(sorted[0]);
            }
        } catch {
            setAvailableModels([]);
        } finally {
            setModelsLoading(false);
        }
    }

    // 記住上次選的來源與 Prompt（跨重開）
    useEffect(() => {
        const storedSource = localStorage.getItem("latest_adjust_source");
        if (storedSource) setSourcePath(storedSource);
        const storedPrompt = localStorage.getItem("latest_adjust_prompt");
        if (storedPrompt) setPromptPath(storedPrompt);
    }, []);

    /** 選檔對話框的起始位置：上次選過的來源 > 報告頁的資料夾推導 */
    function initialSourceDir(): string | undefined {
        if (sourcePath) return dirNameOf(sourcePath);
        const audioFolder = localStorage.getItem("latest_report_folder");
        if (audioFolder) return deriveReportFolder(audioFolder);
        return undefined;
    }

    async function handleSelectSource() {
        try {
            const selected = await open({
                multiple: false,
                defaultPath: initialSourceDir(),
                title: language === "zh" ? "選擇要調整的報告 (.md)" : "Select report to adjust (.md)",
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (selected && typeof selected === "string") {
                setSourcePath(selected);
                localStorage.setItem("latest_adjust_source", selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    async function handleSelectPromptFile() {
        try {
            const selected = await open({
                multiple: false,
                defaultPath: promptPath ? dirNameOf(promptPath) : undefined,
                title: language === "zh" ? "選擇調整用的 Prompt 檔案" : "Select adjustment prompt file",
                filters: [{ name: "Text", extensions: ["txt"] }],
            });
            if (selected && typeof selected === "string") {
                setPromptPath(selected);
                localStorage.setItem("latest_adjust_prompt", selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    function clearPrompt() {
        setPromptPath("");
        localStorage.removeItem("latest_adjust_prompt");
    }

    async function runAdjust() {
        if (!apiKey) {
            setOutput(`${t.error}: ${t.errorApiKey}`);
            return;
        }
        if (!sourcePath) {
            setOutput(`${t.error}: ${t.errorAdjustSource}`);
            return;
        }
        if (!promptPath) {
            setOutput(`${t.error}: ${t.errorAdjustPrompt}`);
            return;
        }

        setLoading(true);
        setOutput(t.processingAdjust);

        // 專屬事件名稱，避免與「報告」頁的進度訊息互相干擾
        const unlisten = await listen<string>("adjust-progress", (ev) => {
            setOutput((prev) => prev + "\n" + ev.payload);
        });

        try {
            const result = await invoke("adjust_report", {
                apiKey,
                sourcePath,
                modelName,
                promptPath,
            });
            setOutput((prev) => prev + "\n\n" + (result as string));
        } catch (err) {
            const errorMsg = String(err);
            setOutput((prev) => prev + "\n\n❌ " + errorMsg);
            await message(errorMsg, {
                title: language === "zh" ? "報告調整發生錯誤" : "Report Adjustment Error",
                kind: "error",
            });
        } finally {
            unlisten();
            setLoading(false);
        }
    }

    // isActive 目前不影響行為，保留參數以符合其他頁面的介面慣例
    void isActive;

    return (
        <div>
            <h2 className="page-title">🪄 {t.adjustTitle}</h2>
            <p className="page-description">{t.adjustDescription}</p>

            {/* 雲端上傳提醒 */}
            <div
                style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                    padding: "10px 14px",
                    marginBottom: "20px",
                    borderRadius: "8px",
                    border: "1px solid rgba(230, 162, 60, 0.5)",
                    background: "rgba(230, 162, 60, 0.12)",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                }}
            >
                <span aria-hidden="true">⚠️</span>
                <span>{t.adjustCloudNotice}</span>
            </div>

            {/* 來源報告：可選任何 .md */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>{t.adjustSource}</label>
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectSource}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        📄 {t.selectFile}
                    </button>
                </div>
                <input
                    type="text"
                    className="input"
                    value={sourcePath}
                    placeholder={t.adjustSourcePlaceholder}
                    readOnly
                    title={sourcePath}
                    style={{ width: "100%" }}
                />
            </div>

            {/* API Key */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.apiKeyLabel}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type={showApiKey ? "text" : "password"}
                        className="input"
                        onChange={(e) => {
                            const val = e.target.value;
                            setApiKey(val);
                            if (debounceTimer.current) clearTimeout(debounceTimer.current);
                            debounceTimer.current = setTimeout(() => fetchAvailableModels(val), 1000);
                        }}
                        placeholder={t.apiKeyPlaceholder}
                        value={apiKey}
                        style={{ flex: 1, maxWidth: "400px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowApiKey(!showApiKey)}
                        style={{ minWidth: "80px" }}
                    >
                        {showApiKey ? `🙈 ${t.hide}` : `👁️ ${t.show}`}
                    </button>
                </div>
            </div>

            {/* 模型選擇 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>{t.selectModel}</label>
                    <button
                        className="btn btn-secondary"
                        onClick={() => fetchAvailableModels(apiKey)}
                        disabled={!apiKey || modelsLoading}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        {modelsLoading ? <span className="loading-spinner"></span> : "🔄"} {language === "zh" ? "重新偵測" : "Refresh"}
                    </button>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <select
                        className="custom-file-select"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        style={{ flex: 1 }}
                    >
                        {availableModels.length > 0 ? (
                            availableModels.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))
                        ) : (
                            <>
                                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                            </>
                        )}
                    </select>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowPriceModal(true)}
                        title={language === "zh" ? "查看定價" : "View pricing"}
                        style={{ padding: "4px 10px", fontSize: "0.9rem", whiteSpace: "nowrap" }}
                    >
                        💰
                    </button>
                </div>
                {availableModels.length > 0 && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                        {language === "zh" ? `✅ 已偵測到 ${availableModels.length} 個可用模型` : `✅ ${availableModels.length} models detected`}
                    </div>
                )}
            </div>

            {showPriceModal && (
                <ModelPricingModal
                    models={availableModels}
                    pricingMap={pricingMap}
                    selectedModel={modelName}
                    language={language}
                    onSelect={setModelName}
                    onClose={() => setShowPriceModal(false)}
                />
            )}

            {/* 調整 Prompt（必填） */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.adjustPrompt}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={promptPath}
                        placeholder={t.adjustPromptPlaceholder}
                        readOnly
                        title={promptPath}
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectPromptFile}
                    >
                        📝 {t.selectPrompt}
                    </button>
                    {promptPath && (
                        <button
                            className="btn btn-secondary"
                            onClick={clearPrompt}
                            style={{ backgroundColor: "#e74c3c" }}
                        >
                            🗑️ {t.clear}
                        </button>
                    )}
                </div>
            </div>

            {/* 調整按鈕：來源或 Prompt 未選時 disabled，讓「必填」在介面上就看得出來 */}
            <div className="btn-group" style={{ marginBottom: "30px" }}>
                <button
                    className="btn btn-primary"
                    onClick={runAdjust}
                    disabled={loading || !sourcePath || !promptPath}
                >
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.adjusting : `🪄 ${t.runAdjust}`}
                </button>
            </div>

            {/* 輸出區域 */}
            {output && (
                <div
                    className={`output-box ${output.includes(t.error) ? "error" : ""}`}
                    style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}
                >
                    {output}
                </div>
            )}
        </div>
    );
}
