use std::collections::HashSet;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::cloud::sse::{parse_sse_block, push_sse_line, SseParseState};
use crate::cloud::weather::{client_tools, execute_tool};
use crate::cloud::wire::{ChatWireMessage, RunOptions, SseEvent};
use crate::config::DesktopConfig;

const SSE_CHANNEL: &str = "agent://sse";
const MAX_RESUME_ATTEMPTS: u32 = 3;

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

#[derive(Debug, Clone)]
struct PendingToolPost {
    tool_call_id: String,
    content: String,
    is_error: bool,
}

#[derive(Debug)]
enum StreamOutcome {
    /// `run.finished` or `error` was emitted.
    Terminal,
    /// Connection dropped; caller should `GET .../events`.
    Dropped,
    /// `tool_results` hit `409 not_owner`; takeover via events then retry POST.
    NeedTakeover { pending: PendingToolPost },
}

#[derive(Debug)]
enum BlockResult {
    Continue,
    Terminal,
    NeedTakeover { pending: PendingToolPost },
}

#[derive(Debug)]
enum HttpPostError {
    NotOwner,
    Other(String),
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

fn response_code_is_not_owner(status: reqwest::StatusCode, body: &str) -> bool {
    if status != reqwest::StatusCode::CONFLICT {
        return false;
    }
    if body.contains("not_owner") {
        return true;
    }
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(|s| s == "not_owner"))
        .unwrap_or(false)
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
        run_sse_lifecycle(app_stream, Some(resp), run_id_for_stream, cloud_base, None).await;
    });

    Ok(StartRunResponse { run_id })
}

async fn open_events_stream(
    cloud_base: &str,
    run_id: &str,
) -> Result<reqwest::Response, String> {
    let url = format!("{cloud_base}/v1/runs/{run_id}/events");
    eprintln!("resume SSE GET {url}");
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| format!("events request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(if body.is_empty() {
            format!("events HTTP {status}")
        } else {
            format!("events HTTP {status}: {body}")
        });
    }
    Ok(resp)
}

async fn run_sse_lifecycle(
    app: AppHandle,
    mut initial: Option<reqwest::Response>,
    run_id: String,
    cloud_base: String,
    mut pending_post: Option<PendingToolPost>,
) {
    let mut resumes: u32 = 0;
    let mut completed_tools: HashSet<String> = HashSet::new();

    loop {
        let resp = if let Some(r) = initial.take() {
            r
        } else {
            if run_id.is_empty() {
                emit_error(&app, "", "SSE dropped before run_id was known");
                return;
            }
            if resumes >= MAX_RESUME_ATTEMPTS {
                emit_error(
                    &app,
                    &run_id,
                    format!("SSE resume failed after {MAX_RESUME_ATTEMPTS} attempts"),
                );
                return;
            }
            resumes += 1;
            match open_events_stream(&cloud_base, &run_id).await {
                Ok(r) => r,
                Err(err) => {
                    emit_error(&app, &run_id, err);
                    return;
                }
            }
        };

        // After takeover (`GET .../events`), retry any tool_results that hit not_owner.
        if let Some(pending) = pending_post.take() {
            match post_tool_result(
                &cloud_base,
                &run_id,
                &pending.tool_call_id,
                &pending.content,
                pending.is_error,
            )
            .await
            {
                Ok(()) => {
                    completed_tools.insert(pending.tool_call_id);
                }
                Err(HttpPostError::NotOwner) => {
                    pending_post = Some(pending);
                    // Drop this response and try events again.
                    continue;
                }
                Err(HttpPostError::Other(err)) => {
                    emit_error(&app, &run_id, err);
                    return;
                }
            }
        }

        match consume_one_sse_stream(
            &app,
            resp,
            &run_id,
            &cloud_base,
            &mut completed_tools,
        )
        .await
        {
            StreamOutcome::Terminal => return,
            StreamOutcome::Dropped => {
                eprintln!("SSE dropped run={run_id}; will resume via GET .../events");
                continue;
            }
            StreamOutcome::NeedTakeover { pending } => {
                eprintln!(
                    "tool_results not_owner run={run_id} tool={}; takeover via events",
                    pending.tool_call_id
                );
                pending_post = Some(pending);
                continue;
            }
        }
    }
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

async fn consume_one_sse_stream(
    app: &AppHandle,
    resp: reqwest::Response,
    run_id: &str,
    cloud_base: &str,
    completed_tools: &mut HashSet<String>,
) -> StreamOutcome {
    let mut state = SseParseState::new();
    let mut line_buf = SseUtf8LineBuffer::new();
    let mut stream = resp.bytes_stream();
    let mut saw_terminal = false;

    while let Some(item) = stream.next().await {
        let bytes = match item {
            Ok(b) => b,
            Err(e) => {
                eprintln!("SSE stream error run={run_id}: {e}; treating as drop");
                return StreamOutcome::Dropped;
            }
        };

        for line in line_buf.push(&bytes) {
            match handle_sse_line(app, &mut state, &line, run_id, cloud_base, completed_tools)
                .await
            {
                BlockResult::Continue => {}
                BlockResult::Terminal => {
                    return StreamOutcome::Terminal;
                }
                BlockResult::NeedTakeover { pending } => {
                    return StreamOutcome::NeedTakeover { pending };
                }
            }
        }
    }

    // Flush a trailing block if the stream closed without a final blank line.
    if let Some(block) = push_sse_line(&mut state, "") {
        match handle_sse_block(app, &block, run_id, cloud_base, completed_tools).await {
            BlockResult::Continue => {}
            BlockResult::Terminal => saw_terminal = true,
            BlockResult::NeedTakeover { pending } => {
                return StreamOutcome::NeedTakeover { pending };
            }
        }
    }

    if saw_terminal {
        StreamOutcome::Terminal
    } else {
        StreamOutcome::Dropped
    }
}

async fn handle_sse_line(
    app: &AppHandle,
    state: &mut SseParseState,
    line: &str,
    run_id: &str,
    cloud_base: &str,
    completed_tools: &mut HashSet<String>,
) -> BlockResult {
    if let Some(block) = push_sse_line(state, line) {
        return handle_sse_block(app, &block, run_id, cloud_base, completed_tools).await;
    }
    BlockResult::Continue
}

async fn handle_sse_block(
    app: &AppHandle,
    block: &str,
    run_id: &str,
    cloud_base: &str,
    completed_tools: &mut HashSet<String>,
) -> BlockResult {
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
                if completed_tools.contains(tool_call_id) {
                    eprintln!(
                        "skip already-posted tool_call_id={tool_call_id} (resume re-emit)"
                    );
                    return BlockResult::Continue;
                }
                let target_run = if tool_run_id.is_empty() {
                    run_id
                } else {
                    tool_run_id.as_str()
                };
                let (content, is_error) = match execute_tool(name, arguments).await {
                    Ok(content) => (content, false),
                    Err(err) => (err, true),
                };
                match post_tool_result(
                    cloud_base,
                    target_run,
                    tool_call_id,
                    &content,
                    is_error,
                )
                .await
                {
                    Ok(()) => {
                        completed_tools.insert(tool_call_id.clone());
                        BlockResult::Continue
                    }
                    Err(HttpPostError::NotOwner) => BlockResult::NeedTakeover {
                        pending: PendingToolPost {
                            tool_call_id: tool_call_id.clone(),
                            content,
                            is_error,
                        },
                    },
                    Err(HttpPostError::Other(err)) => {
                        emit_error(app, target_run, err);
                        BlockResult::Terminal
                    }
                }
            } else {
                let terminal = is_terminal_sse_event(&event);
                emit_sse(app, &event);
                if terminal {
                    BlockResult::Terminal
                } else {
                    BlockResult::Continue
                }
            }
        }
        Ok(None) => {
            eprintln!("warn: ignored SSE block (unknown type)");
            BlockResult::Continue
        }
        Err(e) => {
            emit_error(app, run_id, format!("SSE parse error: {e}"));
            BlockResult::Terminal
        }
    }
}

async fn post_tool_result(
    cloud_base: &str,
    run_id: &str,
    tool_call_id: &str,
    content: &str,
    is_error: bool,
) -> Result<(), HttpPostError> {
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
        .map_err(|e| HttpPostError::Other(format!("tool_results request failed: {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() {
        eprintln!("tool_results ok run={run_id} tool_call_id={tool_call_id} is_error={is_error}");
        return Ok(());
    }
    if response_code_is_not_owner(status, &body) {
        return Err(HttpPostError::NotOwner);
    }
    Err(HttpPostError::Other(if body.is_empty() {
        format!("tool_results HTTP {status}")
    } else {
        format!("tool_results HTTP {status}: {body}")
    }))
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
    use super::{response_code_is_not_owner, SseUtf8LineBuffer};

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

    #[test]
    fn detects_not_owner_conflict() {
        assert!(response_code_is_not_owner(
            reqwest::StatusCode::CONFLICT,
            r#"{"code":"not_owner"}"#
        ));
        assert!(!response_code_is_not_owner(
            reqwest::StatusCode::CONFLICT,
            r#"{"code":"other"}"#
        ));
        assert!(!response_code_is_not_owner(
            reqwest::StatusCode::NOT_FOUND,
            r#"{"code":"not_owner"}"#
        ));
    }
}
