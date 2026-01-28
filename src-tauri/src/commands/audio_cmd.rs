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
#[deprecated(note = "使用 split_audio_segments 替代")]
#[allow(deprecated)]
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

/// 段落資訊（從前端傳入）
#[derive(serde::Deserialize)]
pub struct SegmentInfo {
    pub name: String,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
}

/// 切割音訊檔案
/// 根據傳入的段落列表，將音檔切割成多個片段
#[command]
pub async fn split_audio_segments(
    app: tauri::AppHandle,
    audio_path: String,
    segments: Vec<SegmentInfo>,
) -> Result<String, String> {
    if audio_path.is_empty() {
        return Err("未載入音訊檔案".to_string());
    }

    if segments.is_empty() {
        return Err("未設定任何段落".to_string());
    }

    // 驗證段落資料
    for (i, seg) in segments.iter().enumerate() {
        if seg.name.trim().is_empty() {
            return Err(format!("第 {} 個段落名稱不能為空", i + 1));
        }
        if seg.start_time.is_empty() || seg.end_time.is_empty() {
            return Err(format!("第 {} 個段落 '{}' 的時間不完整", i + 1, seg.name));
        }
    }

    // 使用 ProjectPaths 建立輸出目錄 (02_split)
    let project_paths = crate::services::ProjectPaths::new(&audio_path)?;
    project_paths.create_all_dirs()?;
    let output_dir_str = project_paths.split.to_string_lossy().to_string();

    // 轉換段落資料格式
    let segment_tuples: Vec<(String, String, String)> = segments
        .into_iter()
        .map(|s| (s.name, s.start_time, s.end_time))
        .collect();

    // 執行切割
    let splitter = Splitter::new();
    let output_files = splitter
        .split_segments(&app, &audio_path, &output_dir_str, segment_tuples)
        .await?;

    Ok(format!(
        "切割完成！共產生 {} 個檔案\n輸出目錄: {}\n\n{}",
        output_files.len(),
        output_dir_str,
        output_files.join("\n")
    ))
}
