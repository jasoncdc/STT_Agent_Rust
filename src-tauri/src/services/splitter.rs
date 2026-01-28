// src-tauri/src/services/splitter.rs

use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub struct Splitter;

impl Splitter {
    pub fn new() -> Self {
        Self
    }

    /// 切割單一段落
    /// 使用 FFmpeg 從 input_path 切出 start_time 到 end_time 的片段
    /// 輸出到 output_path
    pub async fn split_segment(
        &self,
        app: &AppHandle,
        input_path: &str,
        output_path: &str,
        start_time: &str, // HH:MM:SS 格式
        end_time: &str,   // HH:MM:SS 格式
    ) -> Result<String, String> {
        println!(
            "正在切割: {} [{} - {}] -> {}",
            input_path, start_time, end_time, output_path
        );

        // 確保輸出目錄存在
        if let Some(parent) = Path::new(output_path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("無法建立輸出目錄: {}", e))?;
        }

        // 執行 FFmpeg Sidecar
        // ffmpeg -i input.mp3 -ss 00:01:00 -to 00:02:30 -c copy output.mp3
        let output = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("無法建立 FFmpeg Sidecar: {}", e))?
            .args([
                "-i",
                input_path, // 輸入檔案
                "-ss",
                start_time, // 開始時間
                "-to",
                end_time, // 結束時間
                "-c",
                "copy", // 直接複製，不重新編碼（速度快）
                "-y",   // 覆蓋已存在的檔案
                output_path,
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg 執行失敗: {}", e))?;

        if output.status.success() {
            Ok(output_path.to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("FFmpeg 切割失敗: {}", stderr))
        }
    }

    /// 批次切割多個段落
    pub async fn split_segments(
        &self,
        app: &AppHandle,
        input_path: &str,
        output_dir: &str,
        segments: Vec<(String, String, String)>, // (name, start_time, end_time)
    ) -> Result<Vec<String>, String> {
        let input = Path::new(input_path);

        // 取得原檔副檔名
        let ext = input.extension().and_then(|e| e.to_str()).unwrap_or("mp3");

        let mut output_files = Vec::new();

        for (name, start_time, end_time) in segments {
            // 輸出檔案路徑: output_dir/段落名稱.副檔名
            let output_path = format!("{}/{}.{}", output_dir, name, ext);

            match self
                .split_segment(app, input_path, &output_path, &start_time, &end_time)
                .await
            {
                Ok(path) => output_files.push(path),
                Err(e) => return Err(format!("切割 '{}' 失敗: {}", name, e)),
            }
        }

        Ok(output_files)
    }

    #[deprecated(note = "使用 split_segment 或 split_segments 替代")]
    pub fn execute(&self) {
        println!("(Split) 正在執行音訊切割 (Service Layer)...");
    }
}
