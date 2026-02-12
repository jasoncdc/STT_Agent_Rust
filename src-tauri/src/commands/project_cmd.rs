use crate::services::file_manager::{CurrentProjectState, ProjectPaths};
use tauri::{command, AppHandle, WebviewUrl, WebviewWindowBuilder};

#[command]
pub fn create_project_cmd(
    _app: AppHandle,
    state: tauri::State<CurrentProjectState>,
    path: String,
) -> Result<String, String> {
    let project_paths = ProjectPaths::create(&path).map_err(|e| e.to_string())?;

    // Update global state
    let mut current_project = state.lock().map_err(|_| "Failed to lock state")?;
    *current_project = Some(project_paths.root.clone());

    Ok(format!("專案建立成功: {}", project_paths.root.display()))
}

#[command]
pub fn open_project_cmd(
    _app: AppHandle,
    state: tauri::State<CurrentProjectState>,
    path: String,
) -> Result<String, String> {
    // Validate project structure by trying to instantiate ProjectPaths from the given root
    let project_paths =
        ProjectPaths::from_root(std::path::PathBuf::from(&path)).map_err(|e| e.to_string())?;

    // Update global state
    let mut current_project = state.lock().map_err(|_| "Failed to lock state")?;
    *current_project = Some(project_paths.root.clone());

    Ok(format!("專案開啟成功: {}", project_paths.root.display()))
}

#[command]
pub fn get_current_project_cmd(
    state: tauri::State<CurrentProjectState>,
) -> Result<Option<String>, String> {
    let current_project = state.lock().map_err(|_| "Failed to lock state")?;
    Ok(current_project
        .as_ref()
        .map(|p| p.to_string_lossy().to_string()))
}

#[command]
pub async fn new_window_cmd(app: AppHandle) -> Result<(), String> {
    let label = format!(
        "window-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::App("index.html?page=welcome".into()),
    )
    .title("STT Agent")
    .inner_size(1280.0, 800.0)
    .build()
    .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}
