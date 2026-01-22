// src-tauri/src/services/splitter.rs

pub struct Splitter;

impl Splitter {
    pub fn new() -> Self {
        Self
    }
    pub fn execute(&self) {
        println!("(Split) 正在執行音訊切割 (Service Layer)...");
    }
}
