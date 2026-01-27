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

        // 1. 取得主檔名
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| "無法解析檔案名稱，請確認路徑是否正確".to_string())?;

        // 2. 決定根目錄
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
        fs::create_dir_all(&self.silence).map_err(|e| format!("無法建立靜音目錄: {}", e))?;
        fs::create_dir_all(&self.report).map_err(|e| format!("無法建立報告目錄: {}", e))?;
        Ok(())
    }
}
