// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// src-tauri/src/main.rs

use std::sync::Mutex;
use stt_agent_rust_lib::commands;
use stt_agent_rust_lib::commands::player_cmd::AudioPlayerState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Manage AudioPlayer state with Mutex<Option<AudioPlayer>>
        .manage(Mutex::new(None::<stt_agent_rust_lib::services::AudioPlayer>) as AudioPlayerState)
        .invoke_handler(tauri::generate_handler![
            commands::audio_cmd::run_convert_cmd,
            commands::audio_cmd::convert_files_to_mp3,
            commands::audio_cmd::set_project_root_dir,
            commands::audio_cmd::run_split_cmd,
            commands::audio_cmd::run_silence_cmd,
            commands::audio_cmd::split_audio_segments,
            commands::report_cmd::run_report_cmd,
            commands::report_cmd::run_report_cmd,
            commands::app_cmd::exit_app,
            commands::app_cmd::uninstall_app,
            // Audio player commands
            commands::player_cmd::load_track,
            commands::player_cmd::play,
            commands::player_cmd::pause,
            commands::player_cmd::seek,
            commands::player_cmd::get_playback_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
