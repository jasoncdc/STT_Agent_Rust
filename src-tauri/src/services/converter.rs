// src-tauri/src/services/converter.rs

use std::path::Path;
use std::process::Command;

pub struct Converter;

impl Converter {
    pub fn new() -> Self {
        Self
    }

    /// 將單一檔案轉換成 MP3
    /// 回傳 Ok(輸出檔案路徑) 或 Err(錯誤訊息)
    pub fn convert_to_mp3(&self, input_path: &str, output_dir: &str) -> Result<String, String> {
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
        std::fs::create_dir_all(output_dir)
            .map_err(|e| format!("無法建立輸出目錄: {}", e))?;

        // 執行 FFmpeg
        let output = Command::new("ffmpeg")
            .args([
                "-i", input_path,      // 輸入檔案
                "-vn",                 // 不要視訊
                "-acodec", "libmp3lame", // MP3 編碼器
                "-ab", "192k",         // 位元率 192kbps
                "-ar", "44100",        // 取樣率 44.1kHz
                "-y",                  // 覆蓋已存在的檔案
                &output_path,
            ])
            .output()
            .map_err(|e| format!("FFmpeg 執行失敗: {}。請確認已安裝 FFmpeg。", e))?;

        if output.status.success() {
            Ok(output_path)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("FFmpeg 轉檔失敗: {}", stderr))
        }
    }

    /// 批次轉換多個檔案
    pub fn convert_files(&self, input_paths: Vec<String>, output_dir: &str) -> Vec<Result<String, String>> {
        input_paths
            .iter()
            .map(|path| self.convert_to_mp3(path, output_dir))
            .collect()
    }
}
