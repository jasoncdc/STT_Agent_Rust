import { useState } from "react";
import "./App.css";

// Import modular pages
import { ConvertPage } from "./pages/ConvertPage";
import { SplitPage } from "./pages/SplitPage";
import { SilencePage } from "./pages/SilencePage";
import { ReportPage } from "./pages/ReportPage";

type Tab = "convert" | "split" | "silence" | "report";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("report");
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="container">
      <h1>Gemini 音訊助理 (Rust 模組化版)</h1>

      {/* Navigation Bar */}
      <div className="nav-bar" style={{ display: "flex", gap: "10px", justifyContent: "center", marginBottom: "20px" }}>
        <button onClick={() => setActiveTab("convert")} className={activeTab === "convert" ? "active" : ""}>轉檔 (Convert)</button>
        <button onClick={() => setActiveTab("split")} className={activeTab === "split" ? "active" : ""}>切割 (Split)</button>
        <button onClick={() => setActiveTab("silence")} className={activeTab === "silence" ? "active" : ""}>靜音 (Silence)</button>
        <button onClick={() => setActiveTab("report")} className={activeTab === "report" ? "active" : ""}>報告 (Report)</button>
      </div>

      {/* Global API Key Input (Only shown near Report tab or generally available) */}
      <div className="row" style={{ marginBottom: "20px" }}>
        <input
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Google Gemini API Key (共用)"
          value={apiKey}
          style={{ width: "300px", padding: "8px" }}
        />
      </div>

      {/* Content Area - Render Active Component */}
      <div className="content-area" style={{ border: "1px solid #333", padding: "20px", borderRadius: "8px", minHeight: "200px" }}>
        {activeTab === "convert" && <ConvertPage />}
        {activeTab === "split" && <SplitPage />}
        {activeTab === "silence" && <SilencePage />}
        {activeTab === "report" && <ReportPage apiKey={apiKey} />}
      </div>

    </div>
  );
}

export default App;