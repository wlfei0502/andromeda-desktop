export type CloudSseEvent =
  | { type: "run.started"; run_id: string }
  | {
      type: "message.delta";
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
    }
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
    type === "message.completed" ||
    type === "run.finished" ||
    type === "error"
  );
}
