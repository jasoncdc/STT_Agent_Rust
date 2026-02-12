import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface RecentProject {
    path: string;
    name: string;
    lastOpened: number;
}

interface WelcomePageProps {
    onProjectOpened: (path: string) => void;
}

export function WelcomePage({ onProjectOpened }: WelcomePageProps) {
    const { t, language } = useI18n();
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

    useEffect(() => {
        loadRecentProjects();
    }, []);

    const loadRecentProjects = () => {
        try {
            const saved = localStorage.getItem("recent-projects");
            if (saved) {
                const parsed = JSON.parse(saved);
                // Sort by lastOpened desc
                parsed.sort((a: RecentProject, b: RecentProject) => b.lastOpened - a.lastOpened);
                setRecentProjects(parsed.slice(0, 5)); // Keep top 5
            }
        } catch (e) {
            console.error("Failed to load recent projects", e);
        }
    };

    const saveRecentProject = (path: string) => {
        const name = path.split(/[/\\]/).pop() || path;
        const newProject: RecentProject = {
            path,
            name,
            lastOpened: Date.now(),
        };

        let current = [...recentProjects];
        // Remove existing if present
        current = current.filter(p => p.path !== path);
        // Add to top
        current.unshift(newProject);
        // Limit to 10 stored
        current = current.slice(0, 10);

        localStorage.setItem("recent-projects", JSON.stringify(current));
        setRecentProjects(current.slice(0, 5));
    };

    const handleCreateProject = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: language === "zh" ? "選擇新建專案位置" : "Select location for new project"
            });
            if (selected && typeof selected === "string") {
                await invoke("create_project_cmd", { path: selected });
                saveRecentProject(selected);
                onProjectOpened(selected);
            }
        } catch (e) {
            console.error(e);
            alert(e);
        }
    };

    const handleOpenProject = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: language === "zh" ? "選擇專案資料夾" : "Select project folder"
            });
            if (selected && typeof selected === "string") {
                await invoke("open_project_cmd", { path: selected });
                saveRecentProject(selected);
                onProjectOpened(selected);
            }
        } catch (e) {
            console.error(e);
            alert(e);
        }
    };

    const handleOpenRecent = async (path: string) => {
        try {
            await invoke("open_project_cmd", { path });
            saveRecentProject(path); // Update timestamp
            onProjectOpened(path);
        } catch (e) {
            console.error(e);
            alert(`${language === "zh" ? "無法開啟專案" : "Failed to open project"}: ${e}`);
        }
    };

    return (
        <div className="welcome-container fade-in">
            <div className="welcome-content">
                <div className="logo-section">
                    <h1 className="app-title">STT Agent</h1>
                    <p className="app-subtitle">{t.appDescription || "AI-Powered Speech to Text Workflow"}</p>
                </div>

                <div className="action-buttons">
                    <button className="btn btn-primary btn-large welcome-btn" onClick={handleOpenProject}>
                        <span className="icon">📂</span>
                        <div className="btn-text">
                            <span className="btn-title">{t.openProject}</span>
                            <span className="btn-desc">{language === "zh" ? "開啟現有專案資料夾" : "Open existing project folder"}</span>
                        </div>
                    </button>

                    <button className="btn btn-secondary btn-large welcome-btn" onClick={handleCreateProject}>
                        <span className="icon">✨</span>
                        <div className="btn-text">
                            <span className="btn-title">{t.newProject}</span>
                            <span className="btn-desc">{language === "zh" ? "建立新的專案工作區" : "Create a new project workspace"}</span>
                        </div>
                    </button>

                    <button className="btn btn-secondary btn-large welcome-btn" onClick={async () => await invoke("new_window_cmd")}>
                        <span className="icon">🔲</span>
                        <div className="btn-text">
                            <span className="btn-title">{t.newWindow}</span>
                            <span className="btn-desc">{language === "zh" ? "開啟另一個視窗" : "Open another window"}</span>
                        </div>
                    </button>
                </div>

                {recentProjects.length > 0 && (
                    <div className="recent-section">
                        <h3>{t.recentFiles || "Recent Projects"}</h3>
                        <ul className="recent-list">
                            {recentProjects.map((p) => (
                                <li key={p.path} onClick={() => handleOpenRecent(p.path)}>
                                    <span className="project-name">{p.name}</span>
                                    <span className="project-path">{p.path}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <style>{`
                .welcome-container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background-color: var(--bg-primary);
                    color: var(--text-primary);
                }
                .welcome-content {
                    max-width: 480px;
                    width: 100%;
                    padding: 30px;
                    text-align: center;
                }
                .logo-section {
                    margin-bottom: 30px;
                }
                .app-title {
                    font-size: 2.2rem;
                    font-weight: 800;
                    margin-bottom: 8px;
                    background: linear-gradient(45deg, var(--accent-primary), var(--accent-secondary));
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .app-subtitle {
                    color: var(--text-secondary);
                    font-size: 0.95rem;
                }
                .action-buttons {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 30px;
                }
                .welcome-btn {
                    display: flex;
                    align-items: center;
                    justify-content: flex-start;
                    padding: 12px 20px;
                    text-align: left;
                    border-radius: 10px;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .welcome-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                }
                .welcome-btn .icon {
                    font-size: 20px;
                    margin-right: 15px;
                }
                .btn-text {
                    display: flex;
                    flex-direction: column;
                }
                .btn-title {
                    font-weight: bold;
                    font-size: 1rem;
                }
                .btn-desc {
                    font-size: 0.8rem;
                    opacity: 0.8;
                }
                .recent-section {
                    text-align: left;
                }
                .recent-section h3 {
                    margin-bottom: 10px;
                    color: var(--text-secondary);
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .recent-list {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }
                .recent-list li {
                    padding: 8px 12px;
                    margin-bottom: 6px;
                    background: var(--bg-secondary);
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    transition: background 0.2s;
                }
                .recent-list li:hover {
                    background: var(--bg-tertiary);
                }
                .project-name {
                    font-weight: bold;
                    font-size: 0.9rem;
                    color: var(--text-primary);
                }
                .project-path {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
            `}</style>
        </div>
    );
}
