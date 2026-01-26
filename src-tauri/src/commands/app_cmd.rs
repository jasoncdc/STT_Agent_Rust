#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
pub fn uninstall_app() -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent_dir = current_exe.parent().ok_or("Cannot find parent directory")?;
    let uninstall_path = parent_dir.join("uninstall.exe");

    if !uninstall_path.exists() {
        return Err("找不到解除安裝程式 (uninstall.exe)".to_string());
    }

    std::process::Command::new(uninstall_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    // Optional: Exit app so uninstaller can remove files
    std::process::exit(0);
}
