// src-tauri/src/services/converter.rs

use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub struct Converter;

impl Converter {
    pub fn new() -> Self {
        Self
    }

    /// 將單一檔案轉換成 MP3
    /// 回傳 Ok(輸出檔案路徑) 或 Err(錯誤訊息)
    pub async fn convert_to_mp3(
        &self,
        app: &AppHandle,
        input_path: &str,
        output_dir: &str,
    ) -> Result<String, String> {
        let input = Path::new(input_path);

        // 取得檔名（不含副檔名）
        let file_stem = input
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("無法取得檔案名稱")?;

        // 建立輸出路徑
        let output_path = format!("{}/{}.mp3", output_dir, file_stem);

        println!("正在轉檔: {} -> {}", input_path, output_path);

        // 確保輸出目錄存在
        std::fs::create_dir_all(output_dir).map_err(|e| format!("無法建立輸出目錄: {}", e))?;

        // 執行 FFmpeg Sidecar
        // 注意：這裡使用 Sidecar，不需要指定完整路徑，Tauri 會自動找到
        let output = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("無法建立 FFmpeg Sidecar: {}", e))?
            .args([
                "-i",
                input_path, // 輸入檔案
                "-vn",      // 不要視訊
                "-acodec",
                "libmp3lame", // MP3 編碼器
                "-ab",
                "192k", // 位元率 192kbps
                "-ar",
                "44100", // 取樣率 44.1kHz
                "-y",    // 覆蓋已存在的檔案
                &output_path,
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg 執行失敗: {}。請確認已正確配置 Sidecar。", e))?;

        if output.status.success() {
            Ok(output_path)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let exit_code = output.status.code().unwrap_or(-1);

            Err(format!(
                "FFmpeg 轉檔失敗 (Exit Code: {})。\nStderr: {}\nStdout: {}",
                exit_code, stderr, stdout
            ))
        }
    }

    /// 批次轉換多個檔案
    pub async fn convert_files(
        &self,
        app: &AppHandle,
        input_paths: Vec<String>,
        output_dir: &str,
    ) -> Vec<Result<String, String>> {
        let mut results = Vec::new();
        for path in input_paths {
            results.push(self.convert_to_mp3(app, &path, output_dir).await);
        }
        results
    }
}
