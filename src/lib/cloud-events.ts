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
