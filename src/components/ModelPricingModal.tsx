import React from "react";

export interface ModelPricing {
    model_id: string;
    input_free: string;
    input_paid: string;
    output_free: string;
    output_paid: string;
    sort_price: number;
}

interface ModelPricingModalProps {
    models: string[];
    pricingMap: Record<string, ModelPricing>;
    selectedModel: string;
    language: string;
    onSelect: (model: string) => void;
    onClose: () => void;
}

/**
 * Gemini 模型定價表彈窗。
 * 由「報告」與「報告調整」兩個頁面共用，避免同一份表格維護兩次。
 */
export function ModelPricingModal({
    models,
    pricingMap,
    selectedModel,
    language,
    onSelect,
    onClose,
}: ModelPricingModalProps) {
    const borderColor = "var(--border-color, #444)";
    const textSecondary = "var(--text-secondary, #888)";
    const modelsToShow = models.length > 0 ? models : Object.keys(pricingMap);

    const thStyle: React.CSSProperties = {
        padding: "6px 10px", fontWeight: 600, fontSize: "0.78rem",
        borderBottom: `1px solid ${borderColor}`, whiteSpace: "pre-line",
        background: "#0f0f1a",
        color: "#e2e8f0",
        position: "sticky", top: 0, zIndex: 1,
    };
    const tdStyle: React.CSSProperties = {
        padding: "8px 10px", fontSize: "0.82rem", verticalAlign: "top",
        borderBottom: `1px solid ${borderColor}`, whiteSpace: "pre-line",
        background: "#2a2a3e",
    };

    return (
        <div
            style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "var(--bg-secondary, #1e1e2e)",
                    border: `1px solid ${borderColor}`,
                    borderRadius: "12px", padding: "24px",
                    width: "min(860px, 95vw)", maxHeight: "80vh",
                    display: "flex", flexDirection: "column",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>
                        💰 {language === "zh" ? "Gemini 模型定價（標準方案）" : "Gemini Model Pricing (Standard)"}
                    </h3>
                    <span style={{ fontSize: "0.75rem", color: textSecondary }}>
                        {language === "zh" ? "每 100 萬 token（美元）· 每日更新" : "Per 1M tokens (USD) · Updated daily"}
                    </span>
                </div>

                <div style={{ overflowY: "auto", flex: 1 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr>
                                <th style={{ ...thStyle, textAlign: "left", width: "22%" }}>
                                    {language === "zh" ? "模型" : "Model"}
                                </th>
                                <th style={{ ...thStyle, textAlign: "center", width: "19%" }}>
                                    {language === "zh" ? "輸入（免費）" : "Input (Free)"}
                                </th>
                                <th style={{ ...thStyle, textAlign: "center", width: "30%" }}>
                                    {language === "zh" ? "輸入（付費層級）" : "Input (Paid)"}
                                </th>
                                <th style={{ ...thStyle, textAlign: "center", width: "14%" }}>
                                    {language === "zh" ? "輸出（免費）" : "Output (Free)"}
                                </th>
                                <th style={{ ...thStyle, textAlign: "center", width: "15%" }}>
                                    {language === "zh" ? "輸出（付費）" : "Output (Paid)"}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {modelsToShow.map((m) => {
                                const p = pricingMap[m];
                                const isSelected = m === selectedModel;
                                const rowBg = isSelected ? "#3b3b6b" : "#2a2a3e";
                                const cellStyle = { ...tdStyle, background: rowBg };
                                return (
                                    <tr
                                        key={m}
                                        onClick={() => { onSelect(m); onClose(); }}
                                        title={language === "zh" ? "點擊選擇此模型" : "Click to select"}
                                        style={{ cursor: "pointer" }}
                                    >
                                        {p ? (
                                            <>
                                                <td style={{ ...cellStyle, fontWeight: isSelected ? 700 : 400 }}>
                                                    {isSelected && <span style={{ color: "#818cf8", marginRight: 4 }}>▶</span>}
                                                    {m}
                                                </td>
                                                <td style={{ ...cellStyle, textAlign: "center", color: textSecondary }}>{p.input_free}</td>
                                                <td style={{ ...cellStyle, textAlign: "center" }}>{p.input_paid}</td>
                                                <td style={{ ...cellStyle, textAlign: "center", color: textSecondary }}>{p.output_free}</td>
                                                <td style={{ ...cellStyle, textAlign: "center" }}>{p.output_paid}</td>
                                            </>
                                        ) : (
                                            <>
                                                <td style={{ ...cellStyle, fontWeight: isSelected ? 700 : 400 }}>
                                                    {isSelected && <span style={{ color: "#818cf8", marginRight: 4 }}>▶</span>}
                                                    {m}
                                                </td>
                                                <td colSpan={4} style={{ ...cellStyle, color: textSecondary, textAlign: "center" }}>
                                                    {language === "zh" ? "無定價資料" : "No pricing data"}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px" }}>
                    <span style={{ fontSize: "0.72rem", color: textSecondary }}>
                        ai.google.dev/gemini-api/docs/pricing
                    </span>
                    <button
                        className="btn btn-secondary"
                        onClick={onClose}
                        style={{ padding: "4px 20px" }}
                    >
                        {language === "zh" ? "關閉" : "Close"}
                    </button>
                </div>
            </div>
        </div>
    );
}
