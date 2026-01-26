import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Import modular pages
import { ConvertPage } from "./pages/ConvertPage";
import { SplitPage } from "./pages/SplitPage";
import { SilencePage } from "./pages/SilencePage";
import { ReportPage } from "./pages/ReportPage";

type Tab = "convert" | "split" | "silence" | "report";
type MenuOpen = "file" | "edit" | null;
type Theme = "dark" | "light";

// SVG Icons
const ConvertIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const SplitIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M17 5H9a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
    <path d="M7 12h10" />
  </svg>
);

const SilenceIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const ReportIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("convert");
  const [openMenu, setOpenMenu] = useState<MenuOpen>(null);
  const [fontSize, setFontSize] = useState(16);
  const [theme, setTheme] = useState<Theme>("dark");
  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "convert", label: "轉檔", icon: <ConvertIcon /> },
    { id: "split", label: "切割", icon: <SplitIcon /> },
    { id: "silence", label: "靜音", icon: <SilenceIcon /> },
    { id: "report", label: "報告", icon: <ReportIcon /> },
  ];

  // 點擊外部關閉選單
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 更新字體大小
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // 更新主題
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const handleExit = async () => {
    await invoke("exit_app");
  };

  const handleUninstall = async () => {
    try {
      await invoke("uninstall_app");
    } catch (error) {
      console.error("Uninstall failed:", error);
      alert("無法啟動解除安裝程式 (可能因為是在開發模式下運行，或者找不到 uninstall.exe)");
    }
  };

  const handleZoomIn = () => {
    setFontSize((prev) => Math.min(prev + 2, 24));
  };

  const handleZoomOut = () => {
    setFontSize((prev) => Math.max(prev - 2, 12));
  };

  const handleResetZoom = () => {
    setFontSize(16);
  };

  const handleSetThemeDark = () => {
    setTheme("dark");
    setOpenMenu(null);
  };

  const handleSetThemeLight = () => {
    setTheme("light");
    setOpenMenu(null);
  };

  return (
    <div className="app-wrapper">
      {/* Top Menu Bar */}
      <div className="menu-bar" ref={menuRef}>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "file" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
          >
            檔案
          </button>
          {openMenu === "file" && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={handleUninstall}>
                解除安裝
              </button>
              <button className="dropdown-item" onClick={handleExit}>
                結束
              </button>
            </div>
          )}
        </div>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          >
            編輯
          </button>
          {openMenu === "edit" && (
            <div className="dropdown-menu">
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  字體
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button className="dropdown-item" onClick={handleZoomIn}>
                    放大
                  </button>
                  <button className="dropdown-item" onClick={handleZoomOut}>
                    縮小
                  </button>
                  <button className="dropdown-item" onClick={handleResetZoom}>
                    重設大小
                  </button>
                </div>
              </div>
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  外觀
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button
                    className={`dropdown-item ${theme === "dark" ? "selected" : ""}`}
                    onClick={handleSetThemeDark}
                  >
                    深色模式
                  </button>
                  <button
                    className={`dropdown-item ${theme === "light" ? "selected" : ""}`}
                    onClick={handleSetThemeLight}
                  >
                    淺色模式
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <h2 className="sidebar-title">會議轉錄助理</h2>
          <nav className="sidebar-nav">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`sidebar-item ${activeTab === item.id ? "active" : ""}`}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {/* Content Area - Render Active Component */}
          <div className="content-area">
            {activeTab === "convert" && <ConvertPage />}
            {activeTab === "split" && <SplitPage />}
            {activeTab === "silence" && <SilencePage />}
            {activeTab === "report" && <ReportPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;