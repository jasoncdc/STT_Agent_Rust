pub mod converter;
pub mod report;
pub mod silence;
pub mod splitter;
pub mod audio_player;

// Re-export for convenience
pub use converter::Converter;
pub use silence::Silence;
pub use splitter::Splitter;
pub mod file_manager;
pub use file_manager::ProjectPaths;
pub use audio_player::AudioPlayer;
