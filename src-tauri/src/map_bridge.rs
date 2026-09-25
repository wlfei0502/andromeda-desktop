//! Dispatch JSON commands into a map child WebView via `eval`.

use tauri::{AppHandle, Manager};

#[tauri::command(rename_all = "snake_case")]
pub fn map_dispatch(app: AppHandle, label: String, message: serde_json::Value) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("map webview not found: {label}"))?;
    let json = serde_json::to_string(&message)
        .map_err(|e| format!("serialize map message: {e}"))?;
    // Queue until the Vue map page mounts and registers __ANDROMEDA_MAP__.
    // CustomEvent alone is lost if no listener is attached yet.
    let script = format!(
        "(function(){{var d={json};window.__ANDROMEDA_MAP_QUEUE__=window.__ANDROMEDA_MAP_QUEUE__||[];if(window.__ANDROMEDA_MAP__&&typeof window.__ANDROMEDA_MAP__.dispatch==='function'){{try{{window.__ANDROMEDA_MAP__.dispatch(d);}}catch(e){{window.__ANDROMEDA_MAP_QUEUE__.push(d);}}}}else{{window.__ANDROMEDA_MAP_QUEUE__.push(d);}}try{{window.dispatchEvent(new CustomEvent('andromeda-map',{{detail:d}}));}}catch(_){{}}}})();"
    );
    webview.eval(&script).map_err(|e| format!("map eval failed: {e}"))
}
