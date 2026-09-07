// src-tauri/src/services/report.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Emitter;

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
    content: Option<Content>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Option<Vec<Part>>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
    // 部分模型（如 transcribe 系列）會回傳思考過程的 part，需排除
    #[serde(default)]
    thought: bool,
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
               - 統一講者格式為：【講者名稱】（使用全形中括號，移除 ** 或粗體，並與說話內容放在同一行）。
            4. **去蕪存菁**：僅刪除無意義的語助詞（呃、那、這個、嘿、吼），但**必須保留**語氣中的轉折詞（但是、不過、然而），因為這影響診斷邏輯。
            5. **修正口語**：將重複結巴的詞彙修正為通順語句，但**不能改變原意**。
            6. **醫學術語翻譯**：
               - 將轉錄的英文術語翻譯中文後，中英文一起顯示(ex. Abdominal Aortic Aneurysm -> 腹主動脈瘤(Abdominal Aortic Aneurysm))。
               - 保持專業術語的準確性。
        "#;

// 6. **醫學術語翻譯**：
// - 將轉錄的英文術語翻譯中文後，中英文一起顯示(ex. Abdominal Aortic Aneurysm -> 腹主動脈瘤(Abdominal Aortic Aneurysm))。
// - 保持專業術語的準確性。

/// 依副檔名決定上傳用的 MIME type
/// 音檔分支與改動前完全相同；額外支援 .md / .txt 供「報告調整」上傳文字檔
pub(crate) fn mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("md") => "text/markdown",
        Some("txt") => "text/plain",
        _ => "audio/mpeg",
    }
}

/// generate_content 的完整結果：除了文字，也帶回 finishReason 供呼叫端判斷是否被截斷
pub(crate) struct GenerateOutcome {
    pub text: String,
    pub finish_reason: String,
}

/// 截斷過長的原始回應，避免錯誤訊息塞爆 UI（以字元為單位，不會切壞 UTF-8）
pub(crate) fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let head: String = s.chars().take(max_chars).collect();
        format!("{}...(已截斷)", head)
    }
}

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

    /// 決定每個音檔段落的標頭文字
    /// 個案格式 → 【個案來源：檔名.mp3】（保留副檔名）
    /// 一般格式 → 直接用檔名（去掉副檔名）
    fn section_heading(filename: &str, use_case_format: bool) -> String {
        if use_case_format {
            format!("【個案來源：{}】", filename)
        } else {
            Path::new(filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| filename.to_string())
        }
    }

    /// 處理資料夾中的所有音檔，生成報告
    pub async fn process_folder(
        &self,
        folder_path: &str,
        output_path: &str,
        model_name: Option<String>,
        custom_prompt: Option<String>,
        // 是否使用個案格式（【個案來源：檔名.mp3】+ 醫學會議標題）。
        // None 時退回舊行為：沒有自訂 Prompt 就用個案格式。
        case_format: Option<bool>,
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        // 0. 決定模型 (預設 gemini-3.1-pro-preview)
        let model = model_name.unwrap_or_else(|| "gemini-3.1-pro-preview".to_string());
        if !model.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') || model.is_empty() {
            return Err(format!("無效的模型名稱: {}", model));
        }
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
        // 決定報告標題與各段落標頭的樣式。
        // 由前端的開關明確指定；未指定時退回舊行為（沒有自訂 Prompt 即視為個案流程）。
        let use_case_format = case_format.unwrap_or_else(|| custom_prompt.is_none());

        let report_title = if use_case_format {
            "# 醫學會議精煉報告"
        } else {
            "# 逐字稿報告"
        };

        let mut report_content =
            format!("{}\n\n生成時間: {}\n\n---\n\n", report_title, timestamp);

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
            let _ = app.emit("report-progress", format!(
                "🎙️ 正在處理 ({}/{})：{}", idx + 1, total, filename
            ));

            match self
                .process_single_file(audio_path.to_str().unwrap_or_default(), &model, &prompt, app)
                .await
            {
                Ok(text) => {
                    let _ = app.emit("report-progress", format!(
                        "✅ ({}/{}) 完成：{}", idx + 1, total, filename
                    ));
                    report_content.push_str(&format!(
                        "## {}\n\n{}\n\n---\n\n",
                        Self::section_heading(&filename, use_case_format),
                        text
                    ));
                }
                Err(e) => {
                    let _ = app.emit("report-progress", format!(
                        "❌ ({}/{}) 失敗：{}\n錯誤：{}", idx + 1, total, filename, e
                    ));
                    // 發生錯誤時，將錯誤訊息寫入報告並立即中斷
                    report_content.push_str(&format!(
                        "## {}\n\n[API 呼叫中斷] {}\n\n---\n\n",
                        Self::section_heading(&filename, use_case_format),
                        e
                    ));
                    // 將已經成功處理的部分寫入檔案，以免前面做白工
                    let _ = fs::write(output_path, &report_content);
                    
                    return Err(format!("在處理「{}」時發生錯誤：\n{}\n\n（處理已中斷暫停，但在這之前成功的紀錄已儲存）", filename, e));
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
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        // 取得音檔長度
        let duration = Self::get_audio_duration_sync(file_path)?;
        let duration_min = duration / 60.0;

        // 閾值：24 分鐘
        const SPLIT_THRESHOLD_MIN: f64 = 24.0;

        if duration_min < SPLIT_THRESHOLD_MIN {
            // 短檔案：直接處理
            println!("   -> {:.1} 分鐘 (短檔)，直接生成報告...", duration_min);

            let (file_uri, mime) = self.upload_file(file_path).await?;
            let result = self.generate_content(&file_uri, &mime, model_name, prompt, app).await?;
            let _ = self.delete_file(&file_uri).await;

            Ok(result)
        } else {
            // 長檔案：分段處理
            // 每段最長 30 分鐘，動態計算段數
            const MAX_SEGMENT_MIN: f64 = 30.0;
            let segment_count = (duration_min / MAX_SEGMENT_MIN).ceil() as usize;
            let segment_duration = duration / segment_count as f64;

            println!(
                "   -> ⚠️ {:.1} 分鐘 (長檔)，啟動「分段聽寫」模式（共 {} 段，每段約 {:.1} 分鐘）...",
                duration_min, segment_count, segment_duration / 60.0
            );

            let mut full_transcript = String::new();

            // 建立暫存目錄
            let parent = Path::new(file_path).parent().unwrap_or(Path::new("."));
            let temp_dir = parent.join("temp_split_process");
            fs::create_dir_all(&temp_dir).map_err(|e| format!("建立暫存目錄失敗: {}", e))?;

            for i in 0..segment_count {
                let start_sec = i as f64 * segment_duration;
                let end_sec = ((i + 1) as f64 * segment_duration).min(duration);

                println!("      正在聽寫第 {}/{} 段...", i + 1, segment_count);
                let _ = app.emit("report-progress", format!(
                    "   📎 長檔案分段處理：第 {}/{} 段...", i + 1, segment_count
                ));

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
                let (file_uri, mime) = self.upload_file(segment_path.to_str().unwrap()).await?;
                let part_text = self.generate_content(&file_uri, &mime, model_name, prompt, app).await?;
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
    pub(crate) async fn upload_file(&self, file_path: &str) -> Result<(String, String), String> {
        let path = Path::new(file_path);
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "audio.mp3".to_string());

        // 讀取檔案
        let file_bytes = fs::read(file_path).map_err(|e| format!("讀取檔案失敗: {}", e))?;
        let file_size = file_bytes.len();

        // 決定 MIME type（音檔與文字檔共用同一份對照表）
        let mime_type = mime_for_path(path);

        // Step 1: 初始化 Resumable Upload
        const UPLOAD_URL: &str = "https://generativelanguage.googleapis.com/upload/v1beta/files";

        let metadata = serde_json::json!({
            "file": {
                "display_name": file_name
            }
        });

        let init_response = self
            .client
            .post(UPLOAD_URL)
            .header("x-goog-api-key", &self.api_key)
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
                return Ok((file_uri, mime_type.to_string()));
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
            "https://generativelanguage.googleapis.com/v1beta/{}",
            file_name
        );

        let response = self
            .client
            .get(&url)
            .header("x-goog-api-key", &self.api_key)
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
    pub(crate) async fn delete_file(&self, file_uri: &str) -> Result<(), String> {
        // 從 URI 中提取檔案名稱
        let file_name = file_uri.split('/').last().unwrap_or_default();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/files/{}",
            file_name
        );

        let _ = self.client.delete(&url).header("x-goog-api-key", &self.api_key).send().await;
        Ok(())
    }

    /// 使用 Gemini 生成內容，只取回文字（報告流程用）
    async fn generate_content(
        &self,
        file_uri: &str,
        mime_type: &str,
        model_name: &str,
        prompt: &str,
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        let outcome = self
            .generate_content_detailed(file_uri, mime_type, model_name, prompt, "report-progress", app)
            .await?;
        Ok(outcome.text)
    }

    /// 使用 Gemini 生成內容（遇到 429 自動等待重試，最多 3 次）
    /// 回傳 GenerateOutcome，呼叫端可依 finish_reason 判斷輸出是否被截斷
    pub(crate) async fn generate_content_detailed(
        &self,
        file_uri: &str,
        mime_type: &str,
        model_name: &str,
        prompt: &str,
        event_name: &str,
        app: &tauri::AppHandle,
    ) -> Result<GenerateOutcome, String> {
        use tauri::Emitter;

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            model_name
        );

        let request = GenerateRequest {
            contents: vec![RequestContent {
                parts: vec![
                    RequestPart::FileData {
                        file_data: FileData {
                            mime_type: mime_type.to_string(),
                            file_uri: file_uri.to_string(),
                        },
                    },
                    RequestPart::Text {
                        text: prompt.to_string(),
                    },
                ],
            }],
        };

        const MAX_RETRIES: u32 = 3;
        const RETRY_WAIT_SECS: u64 = 65;

        for attempt in 0..MAX_RETRIES {
            let response = self
                .client
                .post(&url)
                .header("x-goog-api-key", &self.api_key)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| format!("API 請求失敗: {}", e))?;


            let status = response.status();

            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                if attempt + 1 < MAX_RETRIES {
                    // 通知前端正在等待重試
                    for remaining in (1..=RETRY_WAIT_SECS).rev() {
                        let _ = app.emit(event_name, format!(
                            "⏳ 已達免費額度速率限制（429），等待 {} 秒後自動重試（第 {}/{} 次）...",
                            remaining, attempt + 1, MAX_RETRIES - 1
                        ));
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                    continue;
                } else {
                    return Err(
                        "已達免費 API 速率限制（429 Too Many Requests）。\n\
                        免費方案每分鐘請求數有限，建議：\n\
                        1. 稍後再試\n\
                        2. 升級至付費方案以移除限制".to_string()
                    );
                }
            }

            if !status.is_success() {
                let error_text = response.text().await.unwrap_or_default();
                // 解析常見錯誤碼給出友善訊息
                let friendly = if error_text.contains("API_KEY_INVALID") || error_text.contains("API key not valid") {
                    "API Key 無效，請確認金鑰是否正確。".to_string()
                } else if error_text.contains("PERMISSION_DENIED") {
                    "API Key 權限不足，此模型可能需要付費方案。".to_string()
                } else if error_text.contains("RESOURCE_EXHAUSTED") {
                    "已超過每日免費額度，請明天再試或升級付費方案。".to_string()
                } else {
                    format!("API 錯誤 ({}): {}", status.as_u16(), error_text)
                };
                return Err(friendly);
            }

            // 先取回原始文字，解析失敗時才有東西可以回報
            let body = response
                .text()
                .await
                .map_err(|e| format!("讀取回應失敗: {}", e))?;

            let result: GenerateResponse = serde_json::from_str(&body)
                .map_err(|e| format!("解析回應失敗: {}\n原始回應：{}", e, truncate(&body, 2000)))?;

            let candidate = result
                .candidates
                .and_then(|c| c.into_iter().next())
                .ok_or_else(|| format!(
                    "模型「{}」沒有回傳任何內容（candidates 為空）。\n原始回應：{}",
                    model_name, truncate(&body, 2000)
                ))?;

            let finish_reason = candidate.finish_reason.clone().unwrap_or_else(|| "未提供".to_string());

            // 串接所有 parts 的文字（排除思考過程），而非只取第一個
            let text = candidate
                .content
                .and_then(|c| c.parts)
                .map(|parts| {
                    parts
                        .into_iter()
                        .filter(|p| !p.thought)
                        .filter_map(|p| p.text)
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();

            if text.trim().is_empty() {
                return Err(format!(
                    "模型「{}」回傳空白內容。\n結束原因 (finishReason)：{}\n原始回應：{}",
                    model_name, finish_reason, truncate(&body, 2000)
                ));
            }

            return Ok(GenerateOutcome { text, finish_reason });
        }

        Err("已達最大重試次數，請稍後再試。".to_string())
    }

    // 舊的 execute 方法 (保留向後相容)
    #[deprecated(note = "使用 process_folder 替代")]
    pub async fn execute(&self) -> Result<String, String> {
        println!("(Report) 正在呼叫 Gemini 生成報告 (Service Layer)...");
        Ok("請使用 process_folder 方法".to_string())
    }
}

#[cfg(test)]
mod report_tests {
    use super::*;

    #[test]
    fn section_heading_formats() {
        // 個案格式：保留副檔名，加上【個案來源：】
        assert_eq!(
            ReportAgent::section_heading("1段落一.mp3", true),
            "【個案來源：1段落一.mp3】"
        );
        // 一般格式：去掉副檔名，只留檔名
        assert_eq!(ReportAgent::section_heading("1段落一.mp3", false), "1段落一");
        assert_eq!(
            ReportAgent::section_heading("abstract_ch.wav", false),
            "abstract_ch"
        );
    }
}
