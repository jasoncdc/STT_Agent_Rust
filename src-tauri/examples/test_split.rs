// examples/test_split.rs
// 執行: cargo run --example test_split

use stt_agent_rust_lib::services::Splitter;

fn main() {
    println!("--- 測試 Split ---");
    let splitter = Splitter::new();
    splitter.execute();
}
