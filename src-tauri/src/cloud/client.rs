use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::cloud::sse::{parse_sse_block, push_sse_line, SseParseState};
use crate::cloud::wire::{ChatWireMessage, SseEvent};
use crate::config::DesktopConfig;

const SSE_CHANNEL: &str = "agent://sse";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRunResponse {
    pub run_id: String,
}

#[derive(Debug, Serialize)]
struct CreateRunRequest {
    messages: Vec<ChatWireMessage>,
    tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
}

fn emit_sse(app: &AppHandle, event: &SseEvent) {
    if let Err(err) = app.emit(SSE_CHANNEL, event) {
        eprintln!("failed to emit {SSE_CHANNEL}: {err}");
    }
}

fn emit_error(app: &AppHandle, run_id: &str, message: impl Into<String>) {
    emit_sse(
        app,
        &SseEvent::Error {
            run_id: run_id.to_string(),
            message: message.into(),
            code: None,
        },
    );
}

fn base_url(config: &DesktopConfig) -> String {
    config.cloud_base_url.trim_end_matches('/').to_string()
}

/// POST `/v1/runs`, return `X-Run-Id` when present, spawn SSE reader that emits on `agent://sse`.
#[tauri::command]
pub async fn start_run(
    app: AppHandle,
    messages: Vec<ChatWireMessage>,
) -> Result<StartRunResponse, String> {
    let config = DesktopConfig::load().map_err(|e| {
        emit_error(&app, "", e.clone());
        e
    })?;

    let url = format!("{}/v1/runs", base_url(&config));
    let body = CreateRunRequest {
        messages,
        tools: vec![],
        session_id: None,
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("cloud request failed: {e}");
            emit_error(&app, "", &msg);
            msg
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = if body.is_empty() {
            format!("cloud HTTP {status}")
        } else {
            format!("cloud HTTP {status}: {body}")
        };
        emit_error(&app, "", &msg);
        return Err(msg);
    }

    let run_id = resp
        .headers()
        .get("x-run-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let app_stream = app.clone();
    let run_id_for_stream = run_id.clone();
    tauri::async_runtime::spawn(async move {
        consume_sse_stream(app_stream, resp, run_id_for_stream).await;
    });

    Ok(StartRunResponse { run_id })
}

async fn consume_sse_stream(app: AppHandle, resp: reqwest::Response, run_id: String) {
    let mut state = SseParseState::new();
    let mut pending = String::new();
    let mut stream = resp.bytes_stream();

    while let Some(item) = stream.next().await {
        let bytes = match item {
            Ok(b) => b,
            Err(e) => {
                emit_error(&app, &run_id, format!("SSE stream error: {e}"));
                return;
            }
        };

        pending.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = pending.find('\n') {
            let line: String = pending[..idx].to_string();
            pending.drain(..=idx);
            handle_sse_line(&app, &mut state, &line);
        }
    }

    // Flush a trailing block if the stream closed without a final blank line.
    if let Some(block) = push_sse_line(&mut state, "") {
        handle_sse_block(&app, &block);
    }
}

fn handle_sse_line(app: &AppHandle, state: &mut SseParseState, line: &str) {
    if let Some(block) = push_sse_line(state, line) {
        handle_sse_block(app, &block);
    }
}

fn handle_sse_block(app: &AppHandle, block: &str) {
    match parse_sse_block(block) {
        Ok(Some(event)) => {
            if matches!(event, SseEvent::ToolRequest { .. }) {
                eprintln!("warn: ignoring tool.request (v1 has no local tools)");
                return;
            }
            emit_sse(app, &event);
        }
        Ok(None) => {
            eprintln!("warn: ignored SSE block (tool.request or unknown type)");
        }
        Err(e) => {
            emit_error(app, "", format!("SSE parse error: {e}"));
        }
    }
}

/// POST `/v1/runs/{id}/cancel`.
#[tauri::command]
pub async fn cancel_run(run_id: String) -> Result<(), String> {
    if run_id.is_empty() {
        return Err("run_id is empty".into());
    }

    let config = DesktopConfig::load()?;
    let url = format!("{}/v1/runs/{run_id}/cancel", base_url(&config));

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("cancel request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(if body.is_empty() {
            format!("cancel HTTP {status}")
        } else {
            format!("cancel HTTP {status}: {body}")
        });
    }

    Ok(())
}
