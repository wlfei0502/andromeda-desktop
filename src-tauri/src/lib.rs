mod browser;
mod cloud;
mod config;
mod map_bridge;
mod terminal;

pub use cloud::{
    cancel_run, parse_sse_block, push_sse_line, start_run, ChatWireMessage, ParseError, SseEvent,
    SseParseState, StartRunResponse,
};
pub use config::DesktopConfig;
pub use terminal::{
    terminal_close, terminal_create, terminal_resize, terminal_write, TerminalState,
};
use browser::{browser_clear_data, browser_hard_reload, browser_reload, browser_screenshot};
use map_bridge::map_dispatch;

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
        .plugin(tauri_plugin_fs::init())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_cloud_config,
            start_run,
            cancel_run,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close,
            browser_reload,
            browser_hard_reload,
            browser_clear_data,
            browser_screenshot,
            map_dispatch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
