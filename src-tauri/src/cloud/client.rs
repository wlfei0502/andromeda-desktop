use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::cloud::sse::{parse_sse_block, push_sse_line, SseParseState};
use crate::cloud::weather::{client_tools, execute_tool};
use crate::cloud::wire::{ChatWireMessage, RunOptions, SseEvent};
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
    options: RunOptions,
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
#[tauri::command(rename_all = "snake_case")]
pub async fn start_run(
    app: AppHandle,
    messages: Vec<ChatWireMessage>,
    plan_mode: Option<bool>,
    subagents: Option<bool>,
) -> Result<StartRunResponse, String> {
    let config = DesktopConfig::load().map_err(|e| {
        emit_error(&app, "", e.clone());
        e
    })?;

    let plan_mode = plan_mode.unwrap_or(config.default_plan_mode);
    let subagents = subagents.unwrap_or(config.default_subagents);
    let url = format!("{}/v1/runs", base_url(&config));
    let body = CreateRunRequest {
        messages,
        tools: client_tools(),
        session_id: None,
        options: RunOptions {
            persist: true,
            plan_mode,
            subagents,
        },
    };

    match serde_json::to_string(&body) {
        Ok(json) => eprintln!("start_run POST {url} body={json}"),
        Err(err) => eprintln!("start_run POST {url} (body serialize failed: {err})"),
    }

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
    let cloud_base = base_url(&config);
    tauri::async_runtime::spawn(async move {
        consume_sse_stream(app_stream, resp, run_id_for_stream, cloud_base).await;
    });

    Ok(StartRunResponse { run_id })
}

/// Accumulates SSE byte chunks and yields complete lines without splitting UTF-8.
#[derive(Debug, Default)]
struct SseUtf8LineBuffer {
    buf: Vec<u8>,
}

impl SseUtf8LineBuffer {
    fn new() -> Self {
        Self::default()
    }

    /// Append `chunk`; return every complete line (without trailing `\n`).
    /// Incomplete UTF-8 sequences stay buffered until later chunks arrive.
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut lines = Vec::new();
        loop {
            let (valid_len, skip_invalid) = match std::str::from_utf8(&self.buf) {
                Ok(_) => (self.buf.len(), None),
                Err(e) => {
                    let valid = e.valid_up_to();
                    match e.error_len() {
                        None => (valid, None), // incomplete trailing sequence
                        Some(n) => (valid, Some(n)),
                    }
                }
            };

            if valid_len > 0 {
                let text = std::str::from_utf8(&self.buf[..valid_len]).expect("valid_up_to");
                if let Some(nl) = text.find('\n') {
                    let line = text[..nl].to_string();
                    self.buf.drain(..nl + 1);
                    lines.push(line);
                    continue;
                }
            }

            if let Some(n) = skip_invalid {
                let start = valid_len;
                let end = (start + n).min(self.buf.len());
                if start < end {
                    self.buf.drain(start..end);
                    continue;
                }
            }
            break;
        }
        lines
    }
}

fn is_terminal_sse_event(event: &SseEvent) -> bool {
    matches!(event, SseEvent::RunFinished { .. } | SseEvent::Error { .. })
}

async fn consume_sse_stream(
    app: AppHandle,
    resp: reqwest::Response,
    run_id: String,
    cloud_base: String,
) {
    let mut state = SseParseState::new();
    let mut line_buf = SseUtf8LineBuffer::new();
    let mut stream = resp.bytes_stream();
    let mut saw_terminal = false;

    while let Some(item) = stream.next().await {
        let bytes = match item {
            Ok(b) => b,
            Err(e) => {
                emit_error(&app, &run_id, format!("SSE stream error: {e}"));
                return;
            }
        };

        for line in line_buf.push(&bytes) {
            if handle_sse_line(&app, &mut state, &line, &run_id, &cloud_base).await {
                saw_terminal = true;
            }
        }
    }

    // Flush a trailing block if the stream closed without a final blank line.
    if let Some(block) = push_sse_line(&mut state, "") {
        if handle_sse_block(&app, &block, &run_id, &cloud_base).await {
            saw_terminal = true;
        }
    }

    if !saw_terminal {
        emit_error(
            &app,
            &run_id,
            "SSE stream ended without run.finished or error",
        );
    }
}

/// Returns true if a terminal event (`run.finished` / `error`) was emitted.
async fn handle_sse_line(
    app: &AppHandle,
    state: &mut SseParseState,
    line: &str,
    run_id: &str,
    cloud_base: &str,
) -> bool {
    if let Some(block) = push_sse_line(state, line) {
        return handle_sse_block(app, &block, run_id, cloud_base).await;
    }
    false
}

/// Returns true if a terminal event (`run.finished` / `error`) was emitted.
async fn handle_sse_block(app: &AppHandle, block: &str, run_id: &str, cloud_base: &str) -> bool {
    match parse_sse_block(block) {
        Ok(Some(event)) => {
            if let SseEvent::ToolRequest {
                run_id: tool_run_id,
                tool_call_id,
                name,
                arguments,
                ..
            } = &event
            {
                emit_sse(app, &event);
                let target_run = if tool_run_id.is_empty() {
                    run_id
                } else {
                    tool_run_id.as_str()
                };
                match execute_tool(name, arguments).await {
                    Ok(content) => {
                        if let Err(err) =
                            post_tool_result(cloud_base, target_run, tool_call_id, &content, false)
                                .await
                        {
                            emit_error(app, target_run, err);
                            return true;
                        }
                    }
                    Err(err) => {
                        if let Err(post_err) = post_tool_result(
                            cloud_base,
                            target_run,
                            tool_call_id,
                            &err,
                            true,
                        )
                        .await
                        {
                            emit_error(app, target_run, post_err);
                            return true;
                        }
                    }
                }
                return false;
            }
            let terminal = is_terminal_sse_event(&event);
            emit_sse(app, &event);
            terminal
        }
        Ok(None) => {
            eprintln!("warn: ignored SSE block (unknown type)");
            false
        }
        Err(e) => {
            emit_error(app, run_id, format!("SSE parse error: {e}"));
            true
        }
    }
}

async fn post_tool_result(
    cloud_base: &str,
    run_id: &str,
    tool_call_id: &str,
    content: &str,
    is_error: bool,
) -> Result<(), String> {
    let url = format!("{cloud_base}/v1/runs/{run_id}/tool_results");
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "tool_call_id": tool_call_id,
            "content": content,
            "is_error": is_error,
        }))
        .send()
        .await
        .map_err(|e| format!("tool_results request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(if body.is_empty() {
            format!("tool_results HTTP {status}")
        } else {
            format!("tool_results HTTP {status}: {body}")
        });
    }
    eprintln!("tool_results ok run={run_id} tool_call_id={tool_call_id} is_error={is_error}");
    Ok(())
}

/// POST `/v1/runs/{id}/cancel`.
#[tauri::command(rename_all = "snake_case")]
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

#[cfg(test)]
mod tests {
    use super::SseUtf8LineBuffer;

    #[test]
    fn utf8_line_buffer_splits_chinese_across_chunks() {
        let mut buf = SseUtf8LineBuffer::new();
        let bytes = "你好\n".as_bytes();
        // "你" is E4 BD A0 — split after 2 bytes so the first chunk is incomplete UTF-8.
        assert!(buf.push(&bytes[..2]).is_empty());
        assert_eq!(buf.push(&bytes[2..]), vec!["你好".to_string()]);
    }

    #[test]
    fn utf8_line_buffer_holds_partial_line() {
        let mut buf = SseUtf8LineBuffer::new();
        assert!(buf.push(b"data: hello").is_empty());
        assert_eq!(buf.push(b" world\n"), vec!["data: hello world".to_string()]);
    }
}
