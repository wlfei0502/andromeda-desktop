use crate::cloud::wire::SseEvent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    MissingData,
    InvalidJson(String),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::MissingData => write!(f, "SSE block missing data line"),
            ParseError::InvalidJson(msg) => write!(f, "invalid SSE JSON: {msg}"),
        }
    }
}

impl std::error::Error for ParseError {}

fn is_known_sse_type(type_name: &str) -> bool {
    matches!(
        type_name,
        "run.started"
            | "message.delta"
            | "message.completed"
            | "run.finished"
            | "error"
    )
}

/// Parse one complete SSE event block (may end with a blank line).
///
/// Returns `Ok(None)` for `tool.request` and unrecognized `type` values so the
/// stream can continue without failing.
pub fn parse_sse_block(block: &str) -> Result<Option<SseEvent>, ParseError> {
    let mut data_lines: Vec<&str> = Vec::new();

    for raw in block.lines() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.is_empty() {
            continue;
        }
        // SSE comments
        if line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            let value = rest.strip_prefix(' ').unwrap_or(rest);
            data_lines.push(value);
        }
        // `event:` / `id:` / `retry:` ignored — type comes from JSON `type` field
    }

    if data_lines.is_empty() {
        return Err(ParseError::MissingData);
    }

    let data = data_lines.join("\n");
    let value: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| ParseError::InvalidJson(e.to_string()))?;

    let type_name = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if type_name == "tool.request" {
        return Ok(None);
    }

    match serde_json::from_value::<SseEvent>(value) {
        Ok(ev) => Ok(Some(ev)),
        Err(e) => {
            if type_name.is_empty() || is_known_sse_type(&type_name) {
                Err(ParseError::InvalidJson(e.to_string()))
            } else {
                Ok(None)
            }
        }
    }
}

/// Incremental line buffer for SSE framing.
#[derive(Debug, Default, Clone)]
pub struct SseParseState {
    buf: String,
}

impl SseParseState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Push one line (without trailing `\n`). Returns a completed block when a blank
/// line closes the event; caller should then `parse_sse_block`.
pub fn push_sse_line(state: &mut SseParseState, line: &str) -> Option<String> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    if line.is_empty() {
        if state.buf.is_empty() {
            return None;
        }
        let block = std::mem::take(&mut state.buf);
        return Some(block);
    }
    state.buf.push_str(line);
    state.buf.push('\n');
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::wire::SseEvent;

    #[test]
    fn parses_message_delta_block() {
        let block = "event: message.delta\ndata: {\"type\":\"message.delta\",\"run_id\":\"r1\",\"message_id\":\"m1\",\"delta\":\"你\"}\n\n";
        let ev = parse_sse_block(block).unwrap().unwrap();
        match ev {
            SseEvent::MessageDelta { delta, .. } => assert_eq!(delta, "你"),
            _ => panic!("expected MessageDelta"),
        }
    }

    #[test]
    fn parses_run_started_block() {
        let block = "data: {\"type\":\"run.started\",\"run_id\":\"r1\"}\n\n";
        let ev = parse_sse_block(block).unwrap().unwrap();
        match ev {
            SseEvent::RunStarted { run_id } => assert_eq!(run_id, "r1"),
            _ => panic!("expected RunStarted"),
        }
    }

    #[test]
    fn parses_run_finished_block() {
        let block =
            "data: {\"type\":\"run.finished\",\"run_id\":\"r1\",\"reason\":\"completed\"}\n\n";
        let ev = parse_sse_block(block).unwrap().unwrap();
        match ev {
            SseEvent::RunFinished { run_id, reason } => {
                assert_eq!(run_id, "r1");
                assert_eq!(reason, "completed");
            }
            _ => panic!("expected RunFinished"),
        }
    }

    #[test]
    fn parses_error_block() {
        let block =
            "data: {\"type\":\"error\",\"run_id\":\"r1\",\"message\":\"boom\",\"code\":\"E1\"}\n\n";
        let ev = parse_sse_block(block).unwrap().unwrap();
        match ev {
            SseEvent::Error {
                run_id,
                message,
                code,
            } => {
                assert_eq!(run_id, "r1");
                assert_eq!(message, "boom");
                assert_eq!(code.as_deref(), Some("E1"));
            }
            _ => panic!("expected Error"),
        }
    }

    #[test]
    fn tool_request_returns_ok_none() {
        let block = "data: {\"type\":\"tool.request\",\"run_id\":\"r1\",\"tool_call_id\":\"t1\",\"name\":\"shell\",\"arguments\":{}}\n\n";
        let ev = parse_sse_block(block).unwrap();
        assert!(ev.is_none());
    }

    #[test]
    fn incomplete_message_delta_returns_invalid_json() {
        let block = "data: {\"type\":\"message.delta\",\"run_id\":\"r1\"}\n\n";
        assert!(matches!(
            parse_sse_block(block),
            Err(ParseError::InvalidJson(_))
        ));
    }

    #[test]
    fn unknown_type_returns_ok_none() {
        let block = "data: {\"type\":\"future.event\",\"run_id\":\"r1\"}\n\n";
        let ev = parse_sse_block(block).unwrap();
        assert!(ev.is_none());
    }

    #[test]
    fn missing_data_is_error() {
        let block = "event: message.delta\n\n";
        assert!(matches!(
            parse_sse_block(block),
            Err(ParseError::MissingData)
        ));
    }

    #[test]
    fn push_sse_line_accumulates_until_blank() {
        let mut state = SseParseState::new();
        assert!(push_sse_line(&mut state, "data: {\"type\":\"run.started\",\"run_id\":\"r1\"}").is_none());
        let block = push_sse_line(&mut state, "").unwrap();
        let ev = parse_sse_block(&block).unwrap().unwrap();
        assert!(matches!(ev, SseEvent::RunStarted { .. }));
    }
}
