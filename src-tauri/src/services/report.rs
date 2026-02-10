// src-tauri/src/services/report.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// Gemini File API 回應結構
#[derive(Debug, Deserialize)]
struct UploadResponse {
    file: FileInfo,
}

#[derive(Debug, Deserialize)]
struct FileInfo {
    name: String,
    uri: String,
    #[allow(dead_code)]
    state: String,
}

#[derive(Debug, Deserialize)]
struct GetFileResponse {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    uri: String,
    state: String,
}

// Gemini Generate Content 回應結構
#[derive(Debug, Deserialize)]
struct GenerateResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Content,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
}

// Generate Content 請求結構
#[derive(Debug, Serialize)]
struct GenerateRequest {
    contents: Vec<RequestContent>,
}

#[derive(Debug, Serialize)]
struct RequestContent {
    parts: Vec<RequestPart>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum RequestPart {
    Text { text: String },
    FileData { file_data: FileData },
}

#[derive(Debug, Serialize)]
struct FileData {
    mime_type: String,
    file_uri: String,
}

pub const DEFAULT_PROMPT: &str = r#"
            你是一位專業醫學會議紀錄員。請針對音檔內容進行「高解析度逐字紀錄還原」。

            【任務：高解析度逐字聽寫】
            【重要警告】
            這份紀錄將用於醫療回溯，**嚴禁任何形式的摘要或省略**。即使內容冗長，也必須完整保留所有病程細節、臨床數值、藥物劑量與醫師間的鑑別診斷邏輯。

            【任務：逐字紀錄還原 (Verbatim Transcription)】
            請輸出完整對話紀錄，執行以下規則：
            1. **完整保留**：保留所有醫學術語、數據（如數據、日期）、症狀描述。**請勿因為篇幅而合併對話或是刪除對話**。
            2. **名字遮罩**：醫生或其他人講到病患名字，要把病患名字改成XXX。
            3. **格式清理**：
               - 移除時間戳記（如 [04:10]）。
               - 統一講者格式為：[講者名稱]（移除 ** 或粗體）。
            4. **去蕪存菁**：僅刪除無意義的語助詞（呃、那、這個、嘿、吼），但**必須保留**語氣中的轉折詞（但是、不過、然而），因為這影響診斷邏輯。
            5. **修正口語**：將重複結巴的詞彙修正為通順語句，但**不能改變原意**。
        "#;

pub struct ReportAgent {
    api_key: String,
    client: reqwest::Client,
}

impl ReportAgent {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// 處理資料夾中的所有音檔，生成報告
    pub async fn process_folder(
        &self,
        folder_path: &str,
        output_path: &str,
        model_name: Option<String>,
        custom_prompt: Option<String>,
    ) -> Result<String, String> {
        // 0. 決定模型 (預設 gemini-3-pro-preview)
        let model = model_name.unwrap_or_else(|| "gemini-3-pro-preview".to_string());
        println!("使用模型: {}", model);
        // 1. 列出音檔
        let audio_extensions = ["mp3", "wav", "aac", "flac", "ogg", "m4a"];
        let folder = Path::new(folder_path);

        if !folder.exists() || !folder.is_dir() {
            return Err(format!("資料夾不存在: {}", folder_path));
        }

        let mut audio_files: Vec<_> = fs::read_dir(folder)
            .map_err(|e| format!("讀取資料夾失敗: {}", e))?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                if let Some(ext) = entry.path().extension() {
                    audio_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str())
                } else {
                    false
                }
            })
            .map(|entry| entry.path())
            .collect();

        audio_files.sort();

        if audio_files.is_empty() {
            return Err(format!("找不到音訊檔案: {}", folder_path));
        }

        // 2. 確保輸出目錄存在
        if let Some(parent) = Path::new(output_path).parent() {
            fs::create_dir_all(parent).map_err(|e| format!("無法建立輸出目錄: {}", e))?;
        }

        // 3. 初始化報告
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let mut report_content =
            format!("# 醫學會議精煉報告\n\n生成時間: {}\n\n---\n\n", timestamp);

        // 決定使用的 Prompt
        let prompt = custom_prompt.unwrap_or_else(|| DEFAULT_PROMPT.to_string());

        // 4. 處理每個音檔
        let total = audio_files.len();
        for (idx, audio_path) in audio_files.iter().enumerate() {
            let filename = audio_path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            println!("🎙️ 正在處理 ({}/{}) {}...", idx + 1, total, filename);

            match self
                .process_single_file(audio_path.to_str().unwrap_or_default(), &model, &prompt)
                .await
            {
                Ok(text) => {
                    report_content.push_str(&format!(
                        "## 【個案來源：{}】\n\n{}\n\n---\n\n",
                        filename, text
                    ));
                }
                Err(e) => {
                    report_content.push_str(&format!(
                        "## 【個案來源：{}】\n\n[處理錯誤] {}\n\n---\n\n",
                        filename, e
                    ));
                }
            }
        }

        // 5. 儲存報告
        fs::write(output_path, &report_content).map_err(|e| format!("儲存報告失敗: {}", e))?;

        Ok(format!(
            "報告生成完成！\n處理了 {} 個音檔\n輸出位置: {}",
            total, output_path
        ))
    }

    /// 處理單一音檔
    /// 短檔案直接處理，長檔案（>24分鐘）分段處理
    async fn process_single_file(
        &self,
        file_path: &str,
        model_name: &str,
        prompt: &str,
    ) -> Result<String, String> {
        // 取得音檔長度
        let duration = Self::get_audio_duration_sync(file_path)?;
        let duration_min = duration / 60.0;

        // 閾值：24 分鐘
        const SPLIT_THRESHOLD_MIN: f64 = 24.0;

        if duration_min < SPLIT_THRESHOLD_MIN {
            // 短檔案：直接處理
            println!("   -> {:.1} 分鐘 (短檔)，直接生成報告...", duration_min);

            let file_uri = self.upload_file(file_path).await?;
            let result = self.generate_content(&file_uri, model_name, prompt).await?;
            let _ = self.delete_file(&file_uri).await;

            Ok(result)
        } else {
            // 長檔案：分段處理
            println!(
                "   -> ⚠️ {:.1} 分鐘 (長檔)，啟動「分段聽寫」模式...",
                duration_min
            );

            let mut full_transcript = String::new();
            let segment_count = 3;
            let segment_duration = duration / segment_count as f64;

            // 建立暫存目錄
            let parent = Path::new(file_path).parent().unwrap_or(Path::new("."));
            let temp_dir = parent.join("temp_split_process");
            fs::create_dir_all(&temp_dir).map_err(|e| format!("建立暫存目錄失敗: {}", e))?;

            for i in 0..segment_count {
                let start_sec = i as f64 * segment_duration;
                let end_sec = ((i + 1) as f64 * segment_duration).min(duration);

                println!("      正在聽寫第 {}/{} 段...", i + 1, segment_count);

                // 使用 FFmpeg 切割
                let segment_path = temp_dir.join(format!("part_{}.mp3", i + 1));
                self.split_audio_segment(
                    file_path,
                    segment_path.to_str().unwrap(),
                    start_sec,
                    end_sec,
                )
                .await?;

                // 上傳並處理分段
                let file_uri = self.upload_file(segment_path.to_str().unwrap()).await?;
                let part_text = self.generate_content(&file_uri, model_name, prompt).await?;
                let _ = self.delete_file(&file_uri).await;

                full_transcript.push_str(&format!("\n{}\n", part_text));

                // 刪除暫存分段
                let _ = fs::remove_file(&segment_path);

                // 短暫延遲避免 API 限制
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }

            // 清理暫存目錄
            let _ = fs::remove_dir(&temp_dir);

            Ok(full_transcript)
        }
    }

    /// 取得音檔長度（秒）— 使用 symphonia 原生解析，不依賴外部程式
    fn get_audio_duration_sync(file_path: &str) -> Result<f64, String> {
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        let file = std::fs::File::open(file_path).map_err(|e| format!("無法開啟音檔: {}", e))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
        {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| format!("無法解析音檔格式: {}", e))?;

        let reader = probed.format;

        // 嘗試從預設 track 取得時長
        if let Some(track) = reader.default_track() {
            if let Some(n_frames) = track.codec_params.n_frames {
                if let Some(tb) = track.codec_params.time_base {
                    let time = tb.calc_time(n_frames);
                    return Ok(time.seconds as f64 + time.frac);
                }
            }
            // 備用：嘗試從 sample_rate 和 n_frames 推算
            if let (Some(n_frames), Some(sample_rate)) =
                (track.codec_params.n_frames, track.codec_params.sample_rate)
            {
                if sample_rate > 0 {
                    return Ok(n_frames as f64 / sample_rate as f64);
                }
            }
        }

        Err("無法從音檔取得時長資訊".to_string())
    }

    /// 使用 FFmpeg 切割音檔片段
    async fn split_audio_segment(
        &self,
        input_path: &str,
        output_path: &str,
        start_sec: f64,
        end_sec: f64,
    ) -> Result<(), String> {
        let start_str = format!("{:.2}", start_sec);
        let duration_str = format!("{:.2}", end_sec - start_sec);

        let output = tokio::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                input_path,
                "-ss",
                &start_str,
                "-t",
                &duration_str,
                "-c",
                "copy",
                output_path,
            ])
            .output()
            .await
            .map_err(|e| format!("無法執行 ffmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg 切割失敗: {}", stderr));
        }

        Ok(())
    }

    /// 上傳檔案到 Gemini File API (使用 Resumable Upload 協議)
    async fn upload_file(&self, file_path: &str) -> Result<String, String> {
        let path = Path::new(file_path);
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "audio.mp3".to_string());

        // 讀取檔案
        let file_bytes = fs::read(file_path).map_err(|e| format!("讀取檔案失敗: {}", e))?;
        let file_size = file_bytes.len();

        // 決定 MIME type
        let mime_type = match path.extension().and_then(|e| e.to_str()) {
            Some("mp3") => "audio/mpeg",
            Some("wav") => "audio/wav",
            Some("aac") => "audio/aac",
            Some("flac") => "audio/flac",
            Some("ogg") => "audio/ogg",
            Some("m4a") => "audio/mp4",
            _ => "audio/mpeg",
        };

        // Step 1: 初始化 Resumable Upload
        const UPLOAD_URL: &str = "https://generativelanguage.googleapis.com/upload/v1beta/files";

        let init_url = format!("{UPLOAD_URL}?key={}", self.api_key);

        let metadata = serde_json::json!({
            "file": {
                "display_name": file_name
            }
        });

        let init_response = self
            .client
            .post(&init_url)
            .header("X-Goog-Upload-Protocol", "resumable")
            .header("X-Goog-Upload-Command", "start")
            .header("X-Goog-Upload-Header-Content-Length", file_size.to_string())
            .header("X-Goog-Upload-Header-Content-Type", mime_type)
            .header("Content-Type", "application/json")
            .body(metadata.to_string())
            .send()
            .await
            .map_err(|e| format!("初始化上傳失敗: {}", e))?;

        if !init_response.status().is_success() {
            let error_text = init_response.text().await.unwrap_or_default();
            return Err(format!("初始化上傳失敗: {}", error_text));
        }

        // 取得上傳 URL
        let upload_url = init_response
            .headers()
            .get("x-goog-upload-url")
            .and_then(|v| v.to_str().ok())
            .ok_or("無法取得上傳 URL")?
            .to_string();

        // Step 2: 上傳檔案內容
        let upload_response = self
            .client
            .post(&upload_url)
            .header("X-Goog-Upload-Command", "upload, finalize")
            .header("X-Goog-Upload-Offset", "0")
            .header("Content-Length", file_size.to_string())
            .body(file_bytes)
            .send()
            .await
            .map_err(|e| format!("上傳檔案失敗: {}", e))?;

        if !upload_response.status().is_success() {
            let error_text = upload_response.text().await.unwrap_or_default();
            return Err(format!("上傳失敗: {}", error_text));
        }

        let upload_result: UploadResponse = upload_response
            .json()
            .await
            .map_err(|e| format!("解析上傳回應失敗: {}", e))?;

        // 等待檔案處理完成
        let file_name = &upload_result.file.name;
        let file_uri = upload_result.file.uri;

        for _ in 0..120 {
            let state = self.get_file_state(file_name).await?;
            if state == "ACTIVE" {
                return Ok(file_uri);
            } else if state == "FAILED" {
                return Err("檔案處理失敗".to_string());
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }

        Err("檔案處理超時".to_string())
    }

    /// 取得檔案狀態
    async fn get_file_state(&self, file_name: &str) -> Result<String, String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
            file_name, self.api_key
        );

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("查詢檔案狀態失敗: {}", e))?;

        let file_info: GetFileResponse = response
            .json()
            .await
            .map_err(|e| format!("解析檔案狀態失敗: {}", e))?;

        Ok(file_info.state)
    }

    /// 刪除已上傳的檔案
    async fn delete_file(&self, file_uri: &str) -> Result<(), String> {
        // 從 URI 中提取檔案名稱
        let file_name = file_uri.split('/').last().unwrap_or_default();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/files/{}?key={}",
            file_name, self.api_key
        );

        let _ = self.client.delete(&url).send().await;
        Ok(())
    }

    /// 使用 Gemini 生成內容
    async fn generate_content(
        &self,
        file_uri: &str,
        model_name: &str,
        prompt: &str,
    ) -> Result<String, String> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model_name, self.api_key
        );

        let request = GenerateRequest {
            contents: vec![RequestContent {
                parts: vec![
                    RequestPart::FileData {
                        file_data: FileData {
                            mime_type: "audio/mpeg".to_string(),
                            file_uri: file_uri.to_string(),
                        },
                    },
                    RequestPart::Text {
                        text: prompt.to_string(),
                    },
                ],
            }],
        };

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("API 請求失敗: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API 錯誤: {}", error_text));
        }

        let result: GenerateResponse = response
            .json()
            .await
            .map_err(|e| format!("解析回應失敗: {}", e))?;

        let text = result
            .candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content.parts.into_iter().next())
            .and_then(|p| p.text)
            .unwrap_or_else(|| "[無內容]".to_string());

        Ok(text)
    }

    // 舊的 execute 方法 (保留向後相容)
    #[deprecated(note = "使用 process_folder 替代")]
    pub async fn execute(&self) -> Result<String, String> {
        println!("(Report) 正在呼叫 Gemini 生成報告 (Service Layer)...");
        Ok("請使用 process_folder 方法".to_string())
    }
}
