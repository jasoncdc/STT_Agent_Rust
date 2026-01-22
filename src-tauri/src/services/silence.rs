// src-tauri/src/services/silence.rs

pub struct Silence;

impl Silence {
    pub fn new() -> Self {
        Self
    }
    pub fn execute(&self) {
        println!("(Silence) 正在執行音訊靜音處理 (Service Layer)...");
    }
}
