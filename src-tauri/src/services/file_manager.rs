use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ProjectPaths {
    pub root: PathBuf,
    pub converted: PathBuf,
    pub split: PathBuf,
    pub silence: PathBuf,
    pub report: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub custom_project_root: Option<String>,
}

pub type CurrentProjectState = std::sync::Mutex<Option<PathBuf>>;

impl ProjectPaths {
    fn get_config_path() -> PathBuf {
        let config_dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        config_dir.join("stt_agent_rust").join("config.json")
    }

    fn load_config() -> AppConfig {
        let config_path = Self::get_config_path();
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
        AppConfig::default()
    }

    pub fn set_custom_root(path: String) -> Result<(), String> {
        let config_path = Self::get_config_path();
        let config_dir = config_path.parent().expect("Config dir should have parent");

        if !config_dir.exists() {
            fs::create_dir_all(config_dir).map_err(|e| format!("無法建立設定目錄: {}", e))?;
        }

        let mut config = Self::load_config();
        config.custom_project_root = Some(path);

        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Serialization error: {}", e))?;
        fs::write(config_path, content).map_err(|e| format!("無法寫入設定檔: {}", e))?;
        Ok(())
    }

    /// 根據來源檔案路徑，建立專案資料夾結構
    /// 優先順序：設定檔 > 系統預設
    pub fn new(source_path: &str) -> Result<Self, String> {
        let path = Path::new(source_path);

        // 1. 嘗試偵測是否已在專案結構中 (01_converted, 02_split, 03_silence, 04_report)
        // 這樣可以確保後續處理 (如 Silence, Split) 輸出到正確的專案資料夾，而不是新建一個
        for ancestor in path.ancestors() {
            if let Some(name) = ancestor.file_name().and_then(|s| s.to_str()) {
                if ["01_converted", "02_split", "03_silence", "04_report"].contains(&name) {
                    if let Some(parent) = ancestor.parent() {
                        let project_root = parent.to_path_buf();
                        return Ok(Self {
                            converted: project_root.join("01_converted"),
                            split: project_root.join("02_split"),
                            silence: project_root.join("03_silence"),
                            report: project_root.join("04_report"),
                            root: project_root,
                        });
                    }
                }
            }
        }

        // 2. 如果不在專案結構中，則視為新專案，依照檔名建立
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| "無法解析檔案名稱，請確認路徑是否正確".to_string())?;

        let config = Self::load_config();

        let root_base = if let Some(custom) = config.custom_project_root {
            PathBuf::from(custom)
        } else {
            // 預設路徑邏輯
            if cfg!(target_os = "linux") {
                dirs::home_dir()
                    .ok_or_else(|| "無法找到家目錄 (Home)".to_string())?
                    .join("STT_Agent_Projects")
            } else {
                dirs::document_dir()
                    .ok_or_else(|| "無法找到系統文件夾 (Documents)".to_string())?
                    .join("STT_Agent_Projects")
            }
        };

        let project_root = root_base.join(stem);

        // 3. 定義子資料夾結構
        let paths = Self {
            converted: project_root.join("01_converted"),
            split: project_root.join("02_split"),
            silence: project_root.join("03_silence"),
            report: project_root.join("04_report"),
            root: project_root,
        };

        Ok(paths)
    }

    /// 自動建立所有需要的資料夾
    pub fn create_all_dirs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("無法建立專案根目錄: {}", e))?;
        fs::create_dir_all(&self.converted).map_err(|e| format!("無法建立轉檔目錄: {}", e))?;
        fs::create_dir_all(&self.split).map_err(|e| format!("無法建立切割目錄: {}", e))?;
        fs::create_dir_all(&self.silence).map_err(|e| format!("無法建立消音目錄: {}", e))?;
        fs::create_dir_all(&self.report).map_err(|e| format!("無法建立報告目錄: {}", e))?;
        Ok(())
    }

    /// 於指定路徑建立新專案 (Explicit Creation)
    pub fn create(path: &str) -> Result<Self, String> {
        let root = Path::new(path);
        let paths = Self {
            root: root.to_path_buf(),
            converted: root.join("01_converted"),
            split: root.join("02_split"),
            silence: root.join("03_silence"),
            report: root.join("04_report"),
        };
        paths.create_all_dirs()?;
        Ok(paths)
    }

    pub fn from_root(root: PathBuf) -> Result<Self, String> {
        let paths = Self {
            converted: root.join("01_converted"),
            split: root.join("02_split"),
            silence: root.join("03_silence"),
            report: root.join("04_report"),
            root,
        };
        paths.create_all_dirs()?;
        Ok(paths)
    }
}
