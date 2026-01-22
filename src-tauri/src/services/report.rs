// src-tauri/src/services/report.rs
use gemini_rust::{Gemini, Model};

pub struct ReportAgent {
    api_key: String,
}

impl ReportAgent {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    pub async fn execute(&self) -> Result<String, String> {
        println!("(Report) 正在呼叫 Gemini 生成報告 (Service Layer)...");

        let client = Gemini::with_model(
            self.api_key.clone(),
            Model::Custom("models/gemini-3-pro-preview".to_string()),
        )
        .map_err(|e| format!("Client 建立失敗: {}", e))?;

        let response = client
            .generate_content()
            .with_user_message("Hello from Report Service Layer! Please confirm integration.")
            .execute()
            .await
            .map_err(|e| format!("生成內容失敗: {:#?}", e))?;

        let reply = response.text().to_string();
        println!("(Report) Gemini 回覆: {}", reply);
        Ok(reply)
    }
}
