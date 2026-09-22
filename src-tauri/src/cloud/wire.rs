use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
}

/// Minimal chat message for `start_run` (role + content).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatWireMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCallWire {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: TodoStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageSource {
    Assistant,
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RunOptions {
    #[serde(default = "default_persist")]
    pub persist: bool,
    #[serde(default)]
    pub plan_mode: bool,
    #[serde(default)]
    pub subagents: bool,
}

fn default_persist() -> bool {
    true
}

/// Cloud SSE wire events — `type` tag aligned with andromeda `protocol::SseEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum SseEvent {
    #[serde(rename = "run.started")]
    RunStarted { run_id: String },
    #[serde(rename = "message.delta")]
    MessageDelta {
        run_id: String,
        message_id: String,
        delta: String,
    },
    #[serde(rename = "reasoning.delta")]
    ReasoningDelta {
        run_id: String,
        message_id: String,
        delta: String,
    },
    #[serde(rename = "message.completed")]
    MessageCompleted {
        run_id: String,
        message_id: String,
        role: Role,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCallWire>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<MessageSource>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_content: Option<String>,
    },
    #[serde(rename = "tool.request")]
    ToolRequest {
        run_id: String,
        tool_call_id: String,
        name: String,
        arguments: Value,
        /// Present when a subagent issued the tool call (LH-M5).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
        /// Parent `task` tool_call_id when set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_task_id: Option<String>,
    },
    #[serde(rename = "todos.updated")]
    TodosUpdated {
        run_id: String,
        todos: Vec<TodoItem>,
    },
    #[serde(rename = "task.started")]
    TaskStarted {
        run_id: String,
        task_id: String,
        goal: String,
        agent: String,
    },
    #[serde(rename = "task.completed")]
    TaskCompleted {
        run_id: String,
        task_id: String,
        summary: String,
    },
    #[serde(rename = "task.failed")]
    TaskFailed {
        run_id: String,
        task_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    #[serde(rename = "task.timed_out")]
    TaskTimedOut {
        run_id: String,
        task_id: String,
    },
    #[serde(rename = "run.finished")]
    RunFinished { run_id: String, reason: String },
    #[serde(rename = "error")]
    Error {
        run_id: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
}

impl SseEvent {
    pub fn event_name(&self) -> &'static str {
        match self {
            SseEvent::RunStarted { .. } => "run.started",
            SseEvent::MessageDelta { .. } => "message.delta",
            SseEvent::ReasoningDelta { .. } => "reasoning.delta",
            SseEvent::MessageCompleted { .. } => "message.completed",
            SseEvent::ToolRequest { .. } => "tool.request",
            SseEvent::TodosUpdated { .. } => "todos.updated",
            SseEvent::TaskStarted { .. } => "task.started",
            SseEvent::TaskCompleted { .. } => "task.completed",
            SseEvent::TaskFailed { .. } => "task.failed",
            SseEvent::TaskTimedOut { .. } => "task.timed_out",
            SseEvent::RunFinished { .. } => "run.finished",
            SseEvent::Error { .. } => "error",
        }
    }
}
