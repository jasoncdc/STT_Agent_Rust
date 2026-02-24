import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface ReportPageProps {
    isActive?: boolean;
}

export function ReportPage({ isActive }: ReportPageProps) {
    const { t, language } = useI18n();
    const [apiKey, setApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [folderPath, setFolderPath] = useState("");
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);
    // const [converting, setConverting] = useState(false);
    // const [reportPath, setReportPath] = useState("");
    const [modelName, setModelName] = useState("gemini-3.1-pro-preview");
    const [customPromptPath, setCustomPromptPath] = useState("");
    const [showPromptModal, setShowPromptModal] = useState(false);
    const [defaultPrompt, setDefaultPrompt] = useState("");
    const [modalTitle, setModalTitle] = useState("");

    // 選擇資料夾
    async function handleSelectFolder() {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: language === "zh" ? "選擇音檔資料夾" : "Select Audio Folder",
                defaultPath: "02_split"
            });

            if (selected && typeof selected === "string") {
                setFolderPath(selected);
                localStorage.setItem("latest_report_folder", selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    // 選擇 Prompt 檔案
    async function handleSelectPromptFile() {
        try {
            const selected = await open({
                multiple: false,
                title: language === "zh" ? "選擇自定義 Prompt (.txt)" : "Select Custom Prompt (.txt)",
                filters: [{ name: "Text", extensions: ["txt"] }],
            });

            if (selected && typeof selected === "string") {
                setCustomPromptPath(selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    async function handleViewPrompt() {
        try {
            const rawPrompt = await invoke<string>("get_default_prompt");
            const title = t.defaultPromptTitle;

            // Format the prompt to remove leading indentation
            const lines = rawPrompt.split('\n');
            // Find minimum indentation (ignoring empty lines)
            const minIndent = lines
                .filter(line => line.trim().length > 0)
                .reduce((min, line) => {
                    const indent = line.search(/\S/);
                    return indent !== -1 ? Math.min(min, indent) : min;
                }, Infinity);

            const cleanedPrompt = lines
                .map(line => {
                    if (minIndent !== Infinity && line.length >= minIndent) {
                        return line.slice(minIndent);
                    }
                    return line.trim(); // Trim empty or whitespace-only lines
                })
                .join('\n')
                .trim();

            setDefaultPrompt(cleanedPrompt);
            setModalTitle(title);
            setShowPromptModal(true);
        } catch (err) {
            console.error("Failed to get default prompt:", err);
            setOutput(`${t.error}: ${err}`);
        }
    }

    // 生成報告
    async function runReport() {
        if (!apiKey) {
            setOutput(`${t.error}: ${t.errorApiKey}`);
            return;
        }
        if (!folderPath) {
            setOutput(`${t.error}: ${t.errorSelectFolder}`);
            return;
        }

        setLoading(true);
        setOutput(t.processingReport);
        // setReportPath("");

        try {
            const result = await invoke("generate_report", {
                apiKey,
                folderPath,
                modelName,
                customPromptPath: customPromptPath || null,
            });
            setOutput(result as string);

            // 從結果中提取報告路徑
            const match = (result as string).match(/輸出位置: (.+)/);
            if (match) {
                // setReportPath(match[1]);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    // 選擇 MD 檔案 - 暫時隱藏
    /*
    async function handleSelectMdFile() {
        try {
            const selected = await open({
                multiple: false,
                title: language === "zh" ? "選擇 Markdown 報告檔案" : "Select Markdown Report File",
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });
    
            if (selected && typeof selected === "string") {
                setReportPath(selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }
    */

    // 轉換為 DOCX - 暫時隱藏
    /*
    async function convertToDocx() {
        if (!reportPath) {
            setOutput(`${t.error}: ${t.errorSelectReport}`);
            return;
        }
    
        setConverting(true);
        setOutput(t.convertingToDocx);
    
        try {
            const result = await invoke("convert_md_to_docx", {
                mdPath: reportPath,
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setConverting(false);
        }
    }
    */

    // Load default path from localStorage
    useEffect(() => {
        if (isActive) {
            const stored = localStorage.getItem("latest_report_folder");
            if (stored) {
                setFolderPath(stored);
            }
        }
    }, [isActive]);

    useEffect(() => {
        const stored = localStorage.getItem("latest_report_folder");
        if (stored) {
            setFolderPath(stored);
        }
    }, []);

    return (
        <div>
            <h2 className="page-title">📄 {t.reportTitle}</h2>
            <p className="page-description">{t.reportDescription}</p>

            {/* 資料夾選擇 - UI Adjusted: Button top-left of input */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>{t.audioFolder}</label>
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectFolder}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        📁 {t.selectFolder}
                    </button>
                </div>

                <input
                    type="text"
                    className="input"
                    value={folderPath}
                    placeholder={t.selectFolderPlaceholder}
                    readOnly
                    style={{ width: "100%" }}
                />
            </div>

            {/* API Key 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.apiKeyLabel}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type={showApiKey ? "text" : "password"}
                        className="input"
                        onChange={(e) => setApiKey(e.target.value)}
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
                <label className="input-label">{t.selectModel}</label>
                <select
                    className="custom-file-select"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                >
                    <option value="gemini-3.1-pro-preview">{`gemini-3.1-pro-preview ${t.defaultSuffix}`}</option>
                    <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                    <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                </select>
            </div>

            {/* 自定義 Prompt 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.customPrompt}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={customPromptPath}
                        placeholder={t.customPromptPlaceholder}
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectPromptFile}
                    >
                        📝 {t.selectPrompt}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleViewPrompt}
                        title={t.viewPrompt}
                    >
                        👁️ {t.viewPrompt}
                    </button>
                    {customPromptPath && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => setCustomPromptPath("")}
                            style={{ backgroundColor: "#e74c3c" }}
                        >
                            🗑️ {t.clear}
                        </button>
                    )}
                </div>
            </div>

            {/* 生成按鈕 */}
            <div className="btn-group" style={{ marginBottom: "30px" }}>
                <button
                    className="btn btn-primary"
                    onClick={runReport}
                    disabled={loading}
                >
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.generating : `🚀 ${t.generateReport}`}
                </button>
            </div>

            {/* 暫時隱藏手動工具功能
            <hr style={{ margin: "20px 0", borderColor: "#444" }} />

            <h3 style={{ marginBottom: "15px", fontSize: "1rem", color: "#888" }}>🛠️ {t.manualTools}</h3>

            <div className="input-group" style={{ marginBottom: "15px" }}>
                <label className="input-label">{t.selectReportFile}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={reportPath}
                        placeholder={t.selectReportPlaceholder}
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectMdFile}
                        disabled={converting}
                    >
                        📂 {t.selectFile}
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
                    {converting ? t.convertingDocx : `📝 ${t.convertToDocx}`}
                </button>
            </div>
            */}

            {/* 輸出區域 */}
            {output && (
                <div
                    className={`output-box ${output.includes(t.error) ? "error" : ""}`}
                    style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}
                >
                    {output}
                </div>
            )}

            {/* Default Prompt Modal */}
            {showPromptModal && (
                <div className="modal-overlay" onClick={() => setShowPromptModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "800px", width: "90%" }}>
                        <h3 style={{ marginBottom: "16px", color: "var(--text-primary)" }}>{modalTitle}</h3>
                        <div style={{
                            backgroundColor: "var(--bg-tertiary)",
                            padding: "16px",
                            borderRadius: "8px",
                            border: "1px solid var(--border)",
                            whiteSpace: "pre-wrap",
                            maxHeight: "60vh",
                            overflowY: "auto",
                            fontFamily: "monospace",
                            fontSize: "0.9rem",
                            lineHeight: "1.5",
                            color: "var(--text-secondary)"
                        }}>
                            {defaultPrompt}
                        </div>
                        <div style={{ marginTop: "20px", textAlign: "right" }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setShowPromptModal(false)}
                            >
                                {t.close}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
