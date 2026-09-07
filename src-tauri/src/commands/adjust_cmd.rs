// src-tauri/src/commands/adjust_cmd.rs

use crate::commands::report_cmd::convert_md_to_docx_internal;
use crate::services::adjust::{
    allocate_output_path, output_dir_for_source, AdjustAgent, ADJUST_EVENT,
};
use std::fs;
use std::path::Path;
use tauri::command;
use tauri::Emitter;

/// 讀取指定的 .md 報告，依自訂 Prompt 交由 Gemini 調整，
/// 輸出到案件的 05_adjust（檔名為「來源檔名_adj」）並轉成 Word
#[command]
pub async fn adjust_report(
    app: tauri::AppHandle,
    api_key: String,
    source_path: String,
    model_name: Option<String>,
    prompt_path: String,
) -> Result<String, String> {
    // 1. 必填驗證
    if api_key.is_empty() {
        return Err("請輸入 Gemini API Key".to_string());
    }
    if source_path.is_empty() {
        return Err("請選擇要調整的報告檔案（.md）".to_string());
    }
    if prompt_path.is_empty() {
        return Err("請選擇調整用的 Prompt 檔案（.txt），此頁面必須提供 Prompt".to_string());
    }

    // 2. 讀取 Prompt
    let prompt = fs::read_to_string(&prompt_path)
        .map_err(|e| format!("讀取 Prompt 檔案失敗: {}", e))?;
    if prompt.trim().is_empty() {
        return Err("Prompt 檔案內容為空，請確認檔案內容。".to_string());
    }

    // 3. 來源檢查一律在配置輸出檔名「之前」，避免失敗時留下空檔
    let source_md = Path::new(&source_path);
    if !source_md.is_file() {
        return Err(format!("找不到報告檔案：{}", source_md.display()));
    }
    let source_text =
        fs::read_to_string(source_md).map_err(|e| format!("讀取報告檔案失敗: {}", e))?;
    if source_text.trim().is_empty() {
        return Err(format!(
            "來源報告內容為空：{}\n請改選其他檔案。",
            source_md.display()
        ));
    }

    let source_stem = source_md
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "無法解析來源檔名".to_string())?;

    // 4. 模型驗證（與 process_folder 同一套規則）
    let model = model_name.unwrap_or_else(|| "gemini-2.5-pro".to_string());
    if model.is_empty() || !model.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') {
        return Err(format!("無效的模型名稱: {}", model));
    }

    // 5. 配置輸出編號（原子搶佔，不會覆蓋既有檔案）
    let adjust_dir = output_dir_for_source(source_md);
    let (index, out_md) = allocate_output_path(&adjust_dir, source_stem)?;

    let _ = app.emit(
        ADJUST_EVENT,
        format!("📄 來源報告：{}", source_md.display()),
    );
    let _ = app.emit(ADJUST_EVENT, format!("📁 輸出位置：{}", out_md.display()));

    // 6. 呼叫 Gemini
    let agent = AdjustAgent::new(api_key);
    let outcome = match agent.adjust_report(source_md, &model, &prompt, &app).await {
        Ok(o) => o,
        Err(e) => {
            // 搶佔的空檔已存在，寫入錯誤說明以免留下誤導性的空檔案
            let _ = fs::write(&out_md, format!("[調整失敗]\n{}\n", e));
            return Err(e);
        }
    };

    // 7. 先寫檔，確保被截斷時也保留已產出的部分
    fs::write(&out_md, &outcome.text).map_err(|e| format!("寫入調整後報告失敗: {}", e))?;

    // 8. 依 finishReason 分流
    let finish = outcome.finish_reason.as_str();
    if finish == "MAX_TOKENS" {
        let _ = convert_md_to_docx_internal(&out_md.to_string_lossy(), &app).await;
        return Err(format!(
            "模型輸出被截斷（finishReason: MAX_TOKENS），調整後的報告不完整。\n已保留部分結果：{}\n建議：改用輸出上限較高的模型，或縮短原始報告／精簡 Prompt 後重試。",
            out_md.display()
        ));
    }
    if finish == "SAFETY" || finish == "RECITATION" {
        let _ = convert_md_to_docx_internal(&out_md.to_string_lossy(), &app).await;
        return Err(format!(
            "模型因安全或引用政策中止輸出（finishReason: {}）。\n已保留部分結果：{}",
            finish,
            out_md.display()
        ));
    }

    // 9. 轉成 Word（失敗不致命）
    let docx_result = match convert_md_to_docx_internal(&out_md.to_string_lossy(), &app).await {
        Ok(docx_path) => format!("\n\n✅ 已自動轉換為 Word 文件: {}", docx_path),
        Err(e) => format!("\n\n⚠️ Word 轉換失敗: {}", e),
    };

    // STOP 以外的結束原因附帶提醒，但不視為失敗
    let finish_note = if finish == "STOP" || finish == "未提供" {
        String::new()
    } else {
        format!("\n\n⚠️ 模型結束原因：{}", finish)
    };

    Ok(format!(
        "報告調整完成！（第 {} 份）\n來源: {}\n輸出位置: {}{}{}",
        index,
        source_md.display(),
        out_md.display(),
        finish_note,
        docx_result
    ))
}
