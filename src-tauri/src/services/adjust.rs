// src-tauri/src/services/adjust.rs
//
// 「報告調整」：讀取使用者指定的 .md 報告，
// 以自訂的 Prompt 交由 Gemini 重新整理，輸出到案件的 05_adjust。
// 輸出檔名沿用來源檔名並加上 _adj 後綴（重複時遞增編號）。
//
// 與 report.rs 的關係：Gemini 的上傳／生成／刪除流程完全共用 ReportAgent，
// 本模組只負責調整專屬的邏輯（輸出目錄推導、檔名編號）。

use crate::services::report::{GenerateOutcome, ReportAgent};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// 進度事件名稱。
/// 不可沿用 "report-progress"：兩個頁面都常駐掛載，共用事件會讓訊息跑進錯誤的輸出框。
pub const ADJUST_EVENT: &str = "adjust-progress";

pub const ADJUST_DIR: &str = "05_adjust";

/// 輸出檔名後綴：{來源檔名}_adj.md、{來源檔名}_adj2.md ...
const ADJ_SUFFIX: &str = "_adj";

/// 案件底下的既知子資料夾。使用者指到其中任一個，都要能往上找到案件根目錄。
const CASE_SUBFOLDERS: [&str; 7] = [
    "01_convert",
    "01_converted",
    "02_split",
    "03_audio",
    "03_silence",
    "04_report",
    "05_adjust",
];

/// 依來源檔名與編號組出輸出檔名。
/// 1 -> {stem}_adj.md，n >= 2 -> {stem}_adj{n}.md
fn output_file_name(source_stem: &str, index: usize, ext: &str) -> String {
    if index <= 1 {
        format!("{}{}.{}", source_stem, ADJ_SUFFIX, ext)
    } else {
        format!("{}{}{}.{}", source_stem, ADJ_SUFFIX, index, ext)
    }
}

/// 由來源 .md 檔推導輸出目錄：一律寫進案件的 05_adjust。
/// 來源在 04_report/ 或 05_adjust/ 之類的子資料夾時，會先往上找到案件根目錄。
pub fn output_dir_for_source(source_md: &Path) -> PathBuf {
    let parent = source_md.parent().unwrap_or(Path::new("."));
    let root = if CASE_SUBFOLDERS.iter().any(|s| parent.ends_with(s)) {
        parent.parent().unwrap_or(parent)
    } else {
        parent
    };
    root.join(ADJUST_DIR)
}

/// 配置下一個可用的輸出檔名，並以 create_new 原子搶佔，避免同時執行時撞號。
/// .md 與 .docx 都算佔用，所以只剩 docx 的編號不會被覆寫。
/// 回傳 (編號, md 路徑)。
pub fn allocate_output_path(
    adjust_dir: &Path,
    source_stem: &str,
) -> Result<(usize, PathBuf), String> {
    fs::create_dir_all(adjust_dir).map_err(|e| format!("無法建立輸出目錄: {}", e))?;

    // 掃描既有檔案，記下這個來源已用掉哪些編號
    let prefix = format!("{}{}", source_stem, ADJ_SUFFIX);
    let mut occupied: HashSet<usize> = HashSet::new();
    if let Ok(entries) = fs::read_dir(adjust_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let ext_ok = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("docx"))
                .unwrap_or(false);
            if !ext_ok {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Some(rest) = stem.strip_prefix(&prefix) else {
                continue;
            };
            if rest.is_empty() {
                occupied.insert(1);
            } else if rest.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = rest.parse::<usize>() {
                    if n > 0 {
                        occupied.insert(n);
                    }
                }
            }
        }
    }

    // 取最小的空編號（刪掉 xxx_adj2.* 後，下次會補回 2）
    let mut index = 1usize;
    const MAX_INDEX: usize = 1000;
    while index <= MAX_INDEX {
        if occupied.contains(&index) {
            index += 1;
            continue;
        }

        let candidate = adjust_dir.join(output_file_name(source_stem, index, "md"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(_) => return Ok((index, candidate)),
            // 已被另一個執行緒／程序搶走，換下一號
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                index += 1;
            }
            Err(e) => return Err(format!("無法建立輸出檔案: {}", e)),
        }
    }

    Err(format!(
        "無法配置輸出檔名，{} 內以「{}」開頭的檔案過多。",
        ADJUST_DIR, prefix
    ))
}

pub struct AdjustAgent {
    agent: ReportAgent,
}

impl AdjustAgent {
    pub fn new(api_key: String) -> Self {
        Self {
            agent: ReportAgent::new(api_key),
        }
    }

    /// 上傳來源報告 → 交由 Gemini 依 Prompt 調整 → 刪除雲端檔案。
    /// 無論成功失敗都會清掉上傳的檔案，避免殘留在 Google 端。
    pub(crate) async fn adjust_report(
        &self,
        source_md: &Path,
        model_name: &str,
        prompt: &str,
        app: &tauri::AppHandle,
    ) -> Result<GenerateOutcome, String> {
        let source_str = source_md
            .to_str()
            .ok_or_else(|| "報告路徑含有無法處理的字元".to_string())?;

        let _ = app.emit(ADJUST_EVENT, "📤 正在上傳報告至 Gemini...".to_string());
        let (file_uri, mime) = self.agent.upload_file(source_str).await?;

        let _ = app.emit(
            ADJUST_EVENT,
            format!("🤖 正在以模型「{}」調整報告，請稍候...", model_name),
        );
        let outcome = self
            .agent
            .generate_content_detailed(&file_uri, &mime, model_name, prompt, ADJUST_EVENT, app)
            .await;

        // 不論結果如何都清除雲端暫存檔
        let _ = self.agent.delete_file(&file_uri).await;

        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn builds_output_file_name() {
        assert_eq!(output_file_name("report", 1, "md"), "report_adj.md");
        assert_eq!(output_file_name("report", 2, "md"), "report_adj2.md");
        assert_eq!(output_file_name("report", 3, "docx"), "report_adj3.docx");
        // 來源檔名可以是任意名稱
        assert_eq!(output_file_name("abstract_ch", 1, "md"), "abstract_ch_adj.md");
        assert_eq!(output_file_name("英文摘要", 2, "md"), "英文摘要_adj2.md");
    }

    #[test]
    fn allocates_and_fills_gaps() {
        let dir = std::env::temp_dir().join(format!("adj_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        // 空資料夾 -> 第一個是 report_adj.md
        let (n1, p1) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n1, 1);
        assert!(p1.ends_with("report_adj.md"));

        // 已被搶佔 -> 下一個是 2
        let (n2, p2) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n2, 2);
        assert!(p2.ends_with("report_adj2.md"));

        let (n3, _) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n3, 3);

        // 刪掉 2 的 md 但留下 docx -> docx 仍佔用該編號，應跳過
        fs::remove_file(dir.join("report_adj2.md")).unwrap();
        fs::write(dir.join("report_adj2.docx"), b"x").unwrap();
        let (n4, _) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n4, 4);

        // 兩個都刪掉 -> 補回空缺的 2
        fs::remove_file(dir.join("report_adj2.docx")).unwrap();
        let (n5, p5) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n5, 2);
        assert!(p5.ends_with("report_adj2.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn derives_output_dir() {
        // 來源在 04_report/ -> 往上找到案件根，寫進 05_adjust
        assert_eq!(
            output_dir_for_source(Path::new("/cases/A/04_report/report.md")),
            PathBuf::from("/cases/A/05_adjust")
        );
        // 來源已經在 05_adjust/（串接調整）-> 仍寫回同一個 05_adjust
        assert_eq!(
            output_dir_for_source(Path::new("/cases/A/05_adjust/report_adj.md")),
            PathBuf::from("/cases/A/05_adjust")
        );
        // 01_converted 不應被 01_convert 誤中（逐 component 比對）
        assert_eq!(
            output_dir_for_source(Path::new("/cases/A/01_converted/x.md")),
            PathBuf::from("/cases/A/05_adjust")
        );
        // 來源在非既知資料夾 -> 就地建 05_adjust
        assert_eq!(
            output_dir_for_source(Path::new("/tmp/loose/note.md")),
            PathBuf::from("/tmp/loose/05_adjust")
        );
    }

    #[test]
    fn numbers_per_source_stem() {
        let dir = std::env::temp_dir().join(format!("adj_stem_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        // 不同來源各自從 1 開始編號，互不影響
        let (n1, p1) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n1, 1);
        assert!(p1.ends_with("report_adj.md"));

        let (n2, p2) = allocate_output_path(&dir, "abstract_ch").unwrap();
        assert_eq!(n2, 1);
        assert!(p2.ends_with("abstract_ch_adj.md"));

        // 同一來源再跑 -> 遞增
        let (n3, p3) = allocate_output_path(&dir, "report").unwrap();
        assert_eq!(n3, 2);
        assert!(p3.ends_with("report_adj2.md"));

        // abstract_ch 不受 report 的編號影響
        let (n4, p4) = allocate_output_path(&dir, "abstract_ch").unwrap();
        assert_eq!(n4, 2);
        assert!(p4.ends_with("abstract_ch_adj2.md"));

        let _ = fs::remove_dir_all(&dir);
    }
}
