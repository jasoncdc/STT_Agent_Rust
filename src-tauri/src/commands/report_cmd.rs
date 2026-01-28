// src-tauri/src/commands/report_cmd.rs
use crate::services::report::ReportAgent;
use std::path::Path;
use tauri::command;

/// 生成報告
/// 處理指定資料夾中的音檔，生成逐字稿報告，並自動轉換為 DOCX
#[command]
pub async fn generate_report(
    api_key: String,
    folder_path: String,
    custom_prompt_path: Option<String>,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("請輸入 Gemini API Key".to_string());
    }
    if folder_path.is_empty() {
        return Err("請選擇音檔資料夾".to_string());
    }

    // 處理自定義 Prompt
    let custom_prompt = if let Some(path) = custom_prompt_path {
        if !path.is_empty() {
            match std::fs::read_to_string(&path) {
                Ok(content) => Some(content),
                Err(e) => return Err(format!("讀取自定義 Prompt 檔案失敗: {}", e)),
            }
        } else {
            None
        }
    } else {
        None
    };

    // 根據資料夾路徑推算輸出路徑 (04_report/report.md)
    let output_path = if folder_path.contains("02_split") {
        // 如果選的是 02_split，輸出到 04_report
        folder_path.replace("02_split", "04_report") + "/report.md"
    } else {
        // 否則在同目錄建立 report.md
        format!("{}/report.md", folder_path)
    };

    // 1. 生成報告 (Markdown)
    let agent = ReportAgent::new(api_key);
    let report_result = agent
        .process_folder(&folder_path, &output_path, custom_prompt)
        .await?;

    // 2. 自動轉換為 DOCX
    let docx_result = match convert_md_to_docx_internal(&output_path).await {
        Ok(docx_path) => format!("\n\n✅ 已自動轉換為 Word 文件: {}", docx_path),
        Err(e) => format!("\n\n⚠️ Word 轉換失敗 (請確認已安裝 Pandoc): {}", e),
    };

    Ok(format!("{}{}", report_result, docx_result))
}

/// 將 Markdown 轉換為 DOCX (Command)
#[command]
pub async fn convert_md_to_docx(md_path: String) -> Result<String, String> {
    let docx_path = convert_md_to_docx_internal(&md_path).await?;
    Ok(format!("轉換成功！\nDOCX 檔案位置: {}", docx_path))
}

/// 內部函數：執行 Pandoc 轉換
async fn convert_md_to_docx_internal(md_path: &str) -> Result<String, String> {
    // 驗證檔案存在
    let md_file = Path::new(md_path);
    if !md_file.exists() {
        return Err(format!("找不到檔案: {}", md_path));
    }

    // 產生 DOCX 輸出路徑
    let docx_path = md_path.replace(".md", ".docx");

    // 使用 Pandoc 轉換
    let output = tokio::process::Command::new("pandoc")
        .args([md_path, "-o", &docx_path, "--from=markdown", "--to=docx"])
        .output()
        .await
        .map_err(|e| format!("無法執行 Pandoc: {}。請確認已安裝 Pandoc。", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 轉換失敗: {}", stderr));
    }

    Ok(docx_path)
}

/// 舊的命令 (保留向後相容)
#[command]
#[deprecated(note = "使用 generate_report 替代")]
#[allow(deprecated)]
pub async fn run_report_cmd(_api_key: String) -> Result<String, String> {
    Err("請使用新的 generate_report 命令".to_string())
}
