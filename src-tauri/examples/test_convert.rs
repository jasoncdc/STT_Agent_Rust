// examples/test_convert.rs
// 執行: cargo run --example test_convert /path/to/file.mp4

use stt_agent_rust_lib::services::Converter;
use std::env;

fn main() {
    println!("--- 測試 Convert ---");

    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        println!("用法: cargo run --example test_convert <檔案路徑>");
        println!("範例: cargo run --example test_convert /home/jason/video.mp4");
        return;
    }

    let input_path = &args[1];
    let output_dir = "/home/jason/Downloads";

    let converter = Converter::new();
    match converter.convert_to_mp3(input_path, output_dir) {
        Ok(output) => println!("轉檔成功: {}", output),
        Err(e) => println!("轉檔失敗: {}", e),
    }
}
