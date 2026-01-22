// examples/test_silence.rs
// 執行: cargo run --example test_silence

use stt_agent_rust_lib::services::Silence;

fn main() {
    println!("--- 測試 Silence ---");
    let silence = Silence::new();
    silence.execute();
}
