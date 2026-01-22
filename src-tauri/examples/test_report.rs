// examples/test_report.rs
// 執行: GEMINI_API_KEY=your_key cargo run --example test_report

use stt_agent_rust_lib::services::report::ReportAgent;

#[tokio::main]
async fn main() {
    println!("--- 測試 Report ---");

    let api_key = std::env::var("GEMINI_API_KEY").unwrap_or_else(|_| {
        println!("警告: 未設定 GEMINI_API_KEY 環境變數，使用假 Key 測試");
        "YOUR_API_KEY".to_string()
    });

    let agent = ReportAgent::new(api_key);
    match agent.execute().await {
        Ok(reply) => println!("執行成功: {}", reply),
        Err(e) => println!("執行失敗: {}", e),
    }
}
