export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** Cloud `message_id` when this bubble tracks a streaming assistant reply. */
  serverMessageId?: string;
};
