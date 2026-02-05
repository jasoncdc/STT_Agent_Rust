import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";

// Import modular pages
import { ConvertPage } from "./pages/ConvertPage";
import { SplitPage } from "./pages/SplitPage";
import { SilencePage } from "./pages/SilencePage";
import { ReportPage } from "./pages/ReportPage";
import { useI18n } from "./i18n";

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
  const { language, setLanguage, t } = useI18n();

  const [activeTab, setActiveTab] = useState<Tab>("convert");
  const [openMenu, setOpenMenu] = useState<MenuOpen>(null);
  const [showAbout, setShowAbout] = useState(false);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("app-font-size");
    const initial = saved ? parseInt(saved, 10) : 16;
    return isNaN(initial) ? 16 : initial;
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("app-theme");
    return saved === "light" ? "light" : "dark";
  });


  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems: { id: Tab; labelKey: keyof typeof t; icon: React.ReactNode }[] = [
    { id: "convert", labelKey: "convert", icon: <ConvertIcon /> },
    { id: "split", labelKey: "split", icon: <SplitIcon /> },
    { id: "silence", labelKey: "silence", icon: <SilenceIcon /> },
    { id: "report", labelKey: "report", icon: <ReportIcon /> },
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

  // 更新字體大小並儲存
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem("app-font-size", fontSize.toString());
  }, [fontSize]);

  // 更新主題並儲存
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  // Auto-Update Check
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const update = await check();
        if (update?.available) {
          const yes = await ask(
            language === "zh" 
              ? `發現新版本 v${update.version}！\n\n更新內容：\n${update.body}`
              : `Update to v${update.version} is available!\n\nRelease notes:\n${update.body}`,
            {
              title: language === "zh" ? '發現更新' : 'Update Available',
              kind: 'info',
              okLabel: language === "zh" ? '立即更新' : 'Update',
              cancelLabel: language === "zh" ? '稍後' : 'Cancel'
            }
          );
          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };
    checkUpdate();
  }, [language]);



  const handleExit = async () => {
    await invoke("exit_app");
  };

  const handleUninstall = async () => {
    try {
      await invoke("uninstall_app");
    } catch (error) {
      console.error("Uninstall failed:", error);
      if (error === "PLATFORM_NOT_SUPPORTED") {
        alert(language === "zh"
          ? "Linux 系統請透過套件管理員移除：\n\n終端機執行：\nsudo apt remove stt-agent"
          : "On Linux, please uninstall via terminal:\n\nsudo apt remove stt-agent");
      } else {
        alert(language === "zh"
          ? "無法啟動解除安裝程式 (可能因為是在開發模式下運行，或者找不到 uninstall.exe)"
          : "Cannot start uninstaller (possibly running in dev mode or uninstall.exe not found)");
      }
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

  const handleSetLanguageChinese = () => {
    setLanguage("zh");
    setOpenMenu(null);
  };

  const handleSetLanguageEnglish = () => {
    setLanguage("en");
    setOpenMenu(null);
  };

  const handleShowAbout = () => {
    setShowAbout(true);
    setOpenMenu(null);
  };

  const handleSetProjectPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: language === "zh" ? "選擇新的專案預設路徑" : "Select new project path",
      });

      if (selected && typeof selected === "string") {
        await invoke("set_project_root_dir", { path: selected });
        alert(language === "zh"
          ? `已設定新的專案路徑: ${selected}`
          : `Project path set to: ${selected}`);
      }
    } catch (error) {
      console.error("無法設定路徑:", error);
      alert(language === "zh" ? "設定失敗" : "Setting failed");
    }
    setOpenMenu(null);
  };


  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <div className="app-wrapper">
      {/* ... (About Dialog and Menu Bar remain unchanged, omitting for brevity in tool call if possible, but safer to keep structure?) 
          Actually I need to replace the RETURN statement area mostly.
      */}
      {/* About Dialog */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{t.aboutTitle}</h2>
            <div className="about-info">
              <p><strong>{t.version}:</strong> 1.0.5</p>
              <p>{t.description}</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowAbout(false)}>
              {t.close}
            </button>
          </div>
        </div>
      )}

      {/* Top Menu Bar */}
      <div className="menu-bar" ref={menuRef}>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "file" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
          >
            {t.file}
          </button>
          {openMenu === "file" && (
            <div className="dropdown-menu">

              <button className="dropdown-item" onClick={handleSetProjectPath}>
                {t.setProjectPath}
              </button>
              <div className="dropdown-divider"></div>
              <button className="dropdown-item" onClick={handleShowAbout}>
                {t.about}
              </button>
              <div className="dropdown-divider"></div>
              <button className="dropdown-item" onClick={handleUninstall}>
                {t.uninstall}
              </button>
              <button className="dropdown-item" onClick={handleExit}>
                {t.exit}
              </button>
            </div>
          )}
        </div>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          >
            {t.edit}
          </button>
          {openMenu === "edit" && (
            <div className="dropdown-menu">
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.font}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button className="dropdown-item" onClick={handleZoomIn}>
                    {t.zoomIn}
                  </button>
                  <button className="dropdown-item" onClick={handleZoomOut}>
                    {t.zoomOut}
                  </button>
                  <button className="dropdown-item" onClick={handleResetZoom}>
                    {t.resetZoom}
                  </button>
                </div>
              </div>
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.appearance}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button
                    className={`dropdown-item ${theme === "dark" ? "selected" : ""}`}
                    onClick={handleSetThemeDark}
                  >
                    {t.darkMode}
                  </button>
                  <button
                    className={`dropdown-item ${theme === "light" ? "selected" : ""}`}
                    onClick={handleSetThemeLight}
                  >
                    {t.lightMode}
                  </button>
                </div>
              </div>
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.language}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button
                    className={`dropdown-item ${language === "zh" ? "selected" : ""}`}
                    onClick={handleSetLanguageChinese}
                  >
                    {t.chinese}
                  </button>
                  <button
                    className={`dropdown-item ${language === "en" ? "selected" : ""}`}
                    onClick={handleSetLanguageEnglish}
                  >
                    {t.english}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>

          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            minHeight: isSidebarCollapsed ? "10px" : "50px",
            paddingLeft: isSidebarCollapsed ? "0" : "24px",
            transition: "all 0.3s ease",
            overflow: "hidden"
          }}>
            {/* Show Title only when Expanded */}
            {!isSidebarCollapsed && <h2 className="sidebar-title" style={{ padding: 0 }}>{t.appTitle}</h2>}
          </div>

          <nav className="sidebar-nav">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`sidebar-item ${activeTab === item.id ? "active" : ""}`}
                title={isSidebarCollapsed ? (t[item.labelKey] as string) : ""}
              >
                <span className="sidebar-icon">{item.icon}</span>
                {!isSidebarCollapsed && <span className="sidebar-label">{t[item.labelKey] as string}</span>}
              </button>
            ))}
          </nav>

          {/* Vertical Toggle Strip */}
          <div
            className="sidebar-toggle-strip"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand" : "Collapse"}
          >
            <span className="sidebar-toggle-arrow">
              {isSidebarCollapsed ? "▶" : "◀"}
            </span>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {/* Content Area - All components stay mounted, hidden with CSS for state persistence */}
          <div className="content-area">
            <div style={{ display: activeTab === "convert" ? "block" : "none" }}>
              <ConvertPage />
            </div>
            <div style={{ display: activeTab === "split" ? "block" : "none" }}>
              <SplitPage />
            </div>
            <div style={{ display: activeTab === "silence" ? "block" : "none" }}>
              <SilencePage />
            </div>
            <div style={{ display: activeTab === "report" ? "block" : "none" }}>
              <ReportPage isActive={activeTab === "report"} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;