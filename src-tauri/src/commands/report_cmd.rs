// src-tauri/src/commands/report_cmd.rs
use crate::services::report::ReportAgent;
use tauri::command;

#[command]
pub async fn run_report_cmd(api_key: String) -> Result<String, String> {
    let agent = ReportAgent::new(api_key);
    agent.execute().await
}
