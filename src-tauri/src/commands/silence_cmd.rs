use crate::services::silence::{Silence, TranscribeResponse};
use tauri::{command, AppHandle, State};

// Initialize the Silence service state
// managed likely in main.rs or lib.rs via .manage(Silence::new())

#[command]
pub async fn connect_server(ip: String, service: State<'_, Silence>) -> Result<bool, String> {
    Ok(service.check_health(&ip).await)
}

#[command]
pub async fn transcribe_audio(
    ip: String,
    file_path: String,
    service: State<'_, Silence>,
) -> Result<TranscribeResponse, String> {
    service.transcribe(&ip, &file_path).await
}

#[command]
pub async fn silence_audio(
    app: AppHandle,
    input_path: String,
    output_dir: String,
    segments: Vec<(f64, f64)>, // expects start, end
    service: State<'_, Silence>,
) -> Result<String, String> {
    service
        .apply_silence_to_segments(&app, &input_path, &output_dir, segments)
        .await
}
