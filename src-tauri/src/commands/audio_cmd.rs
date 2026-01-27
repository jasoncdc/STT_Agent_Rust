// src-tauri/src/commands/audio_cmd.rs
use crate::services::{Converter, Silence, Splitter};
use tauri::command;

/// 取得系統下載資料夾路徑 (跨平台)
/// Windows: C:\Users\使用者\Downloads
/// Linux: /home/使用者/Downloads
/// macOS: /Users/使用者/Downloads
fn get_download_dir() -> String {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.join("Downloads").to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        })
}

#[command]
pub fn run_convert_cmd() -> String {
    format!("Converter 已就緒，輸出目錄: {}", get_download_dir())
}

/// 轉換多個檔案為 MP3
#[command]
pub async fn convert_files_to_mp3(
    app: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("未選擇任何檔案".to_string());
    }

    let converter = Converter::new();
    let mut success_count = 0;
    let mut fail_count = 0;
    let mut messages = Vec::new();

    // 用於最後顯示路徑
    let first_file_path = file_paths.first().cloned();

    // 針對每一個檔案，都必須建立其專屬的 Project Folder
    for path in file_paths {
        // 1. 初始化專案路徑
        let project_paths = match crate::services::ProjectPaths::new(&path) {
            Ok(p) => p,
            Err(e) => {
                fail_count += 1;
                messages.push(format!("✗ {} - 路徑錯誤: {}", path, e));
                continue;
            }
        };

        // 2. 建立資料夾
        if let Err(e) = project_paths.create_all_dirs() {
            fail_count += 1;
            messages.push(format!("✗ {} - 無法建立資料夾: {}", path, e));
            continue;
        }

        let output_dir = project_paths.converted.to_string_lossy().to_string();

        // 3. 執行單一轉檔
        match converter.convert_to_mp3(&app, &path, &output_dir).await {
            Ok(output_path) => {
                success_count += 1;
                messages.push(format!("✓ {}", output_path));
            }
            Err(e) => {
                fail_count += 1;
                messages.push(format!("✗ {} - {}", path, e));
            }
        }
    }

    // 4. 計算最後顯示的根目錄路徑
    let root_path_display = if let Some(path) = first_file_path {
        if let Ok(p) = crate::services::ProjectPaths::new(&path) {
            p.root
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string())
        } else {
            "Unknown".to_string()
        }
    } else {
        "Unknown".to_string()
    };

    let result_msg = format!(
        "轉檔完成！成功: {} 個，失敗: {} 個\n檔案位置: {}\n(已依照檔名自動分類專案資料夾)\n\n{}",
        success_count,
        fail_count,
        root_path_display,
        messages.join("\n")
    );

    Ok(result_msg)
}

#[command]
pub fn set_project_root_dir(path: String) -> Result<String, String> {
    crate::services::ProjectPaths::set_custom_root(path.clone())
        .map(|_| format!("成功設定預設專案路徑為: {}", path))
}

#[command]
pub fn run_split_cmd() -> String {
    let splitter = Splitter::new();
    splitter.execute();
    "Split 完成 (Layered Arch)".to_string()
}

#[command]
pub fn run_silence_cmd() -> String {
    let silence = Silence::new();
    silence.execute();
    "Silence 完成 (Layered Arch)".to_string()
}
