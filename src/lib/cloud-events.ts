export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type CloudSseEvent =
  | { type: "run.started"; run_id: string }
  | {
      type: "message.delta";
      run_id: string;
      message_id: string;
      delta: string;
    }
  | {
      type: "reasoning.delta";
      run_id: string;
      message_id: string;
      delta: string;
    }
  | {
      type: "message.completed";
      run_id: string;
      message_id: string;
      role: string;
      content: string;
      reasoning_content?: string | null;
    }
  | { type: "todos.updated"; run_id: string; todos: TodoItem[] }
  | {
      type: "tool.request";
      run_id: string;
      tool_call_id: string;
      name: string;
      arguments: Record<string, unknown>;
      agent_id?: string | null;
      parent_task_id?: string | null;
    }
  | {
      type: "task.started";
      run_id: string;
      task_id: string;
      goal: string;
      agent: string;
    }
  | {
      type: "task.completed";
      run_id: string;
      task_id: string;
      summary: string;
    }
  | {
      type: "task.failed";
      run_id: string;
      task_id: string;
      message: string;
      code?: string | null;
    }
  | { type: "task.timed_out"; run_id: string; task_id: string }
  | { type: "run.finished"; run_id: string; reason: string }
  | { type: "error"; run_id: string; message: string; code?: string };

export type WireChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

export function isCloudSseEvent(value: unknown): value is CloudSseEvent {
  if (value == null || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "run.started" ||
    type === "message.delta" ||
    type === "reasoning.delta" ||
    type === "message.completed" ||
    type === "todos.updated" ||
    type === "tool.request" ||
    type === "task.started" ||
    type === "task.completed" ||
    type === "task.failed" ||
    type === "task.timed_out" ||
    type === "run.finished" ||
    type === "error"
  );
}

/** Ignore stale runs; setup errors may omit run_id. */
export function shouldIgnoreSseForRun(
  activeRunId: string | null,
  event: CloudSseEvent,
): boolean {
  const runId = event.run_id;
  if (event.type === "error" && runId === "") {
    return false;
  }
  if (activeRunId && runId && runId !== activeRunId) {
    return true;
  }
  return false;
}
