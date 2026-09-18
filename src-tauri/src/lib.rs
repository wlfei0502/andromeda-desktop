mod cloud;
mod config;

pub use cloud::{
    cancel_run, parse_sse_block, push_sse_line, start_run, ChatWireMessage, ParseError,
    SseEvent, SseParseState, StartRunResponse,
};
pub use config::DesktopConfig;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_cloud_config() -> Result<DesktopConfig, String> {
    DesktopConfig::load()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_cloud_config,
            start_run,
            cancel_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
