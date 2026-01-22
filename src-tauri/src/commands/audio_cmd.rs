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
pub async fn convert_files_to_mp3(file_paths: Vec<String>) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("未選擇任何檔案".to_string());
    }

    let output_dir = get_download_dir();

    // 在背景執行緒執行，避免阻塞 UI
    let result = tokio::task::spawn_blocking(move || {
        let converter = Converter::new();
        let results = converter.convert_files(file_paths.clone(), &output_dir);

        let mut success_count = 0;
        let mut fail_count = 0;
        let mut messages = Vec::new();

        for (i, result) in results.iter().enumerate() {
            match result {
                Ok(output_path) => {
                    success_count += 1;
                    messages.push(format!("✓ {}", output_path));
                }
                Err(e) => {
                    fail_count += 1;
                    messages.push(format!("✗ {} - {}", file_paths[i], e));
                }
            }
        }

        format!(
            "轉檔完成！成功: {} 個，失敗: {} 個\n輸出目錄: {}\n\n{}",
            success_count,
            fail_count,
            output_dir,
            messages.join("\n")
        )
    })
    .await
    .map_err(|e| format!("執行錯誤: {}", e))?;

    Ok(result)
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
