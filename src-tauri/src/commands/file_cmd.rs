use std::fs;
use std::path::Path;
use tauri::command;

/// Create directory if it doesn't exist
#[command]
pub fn ensure_dir_exists(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
    } else {
        Ok(())
    }
}

/// Save content to a JSON file
#[command]
pub fn save_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Read content from a text file
#[command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Check if a file exists
#[command]
pub fn check_file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}
