import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  isCloudSseEvent,
  shouldIgnoreSseForRun,
  type WireChatMessage,
} from "@/lib/cloud-events";
import { cn } from "@/lib/utils";
import { ChatMessageList } from "./chat-message-list";
import type { ChatMessage, ChatRole } from "./types";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toWireMessages(messages: ChatMessage[]): WireChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function applyDelta(
  messages: ChatMessage[],
  messageId: string,
  delta: string,
): ChatMessage[] {
  const index = messages.findIndex(
    (m) => m.serverMessageId === messageId || m.id === messageId,
  );
  if (index === -1) {
    return [
      ...messages,
      {
        id: messageId,
        serverMessageId: messageId,
        role: "assistant",
        content: delta,
      },
    ];
  }
  const next = [...messages];
  const existing = next[index];
  next[index] = {
    ...existing,
    serverMessageId: messageId,
    content: existing.content + delta,
  };
  return next;
}

function applyCompleted(
  messages: ChatMessage[],
  messageId: string,
  role: string,
  content: string,
): ChatMessage[] {
  const chatRole: ChatRole = role === "user" ? "user" : "assistant";
  const index = messages.findIndex(
    (m) => m.serverMessageId === messageId || m.id === messageId,
  );
  if (index === -1) {
    return [
      ...messages,
      {
        id: messageId,
        serverMessageId: messageId,
        role: chatRole,
        content,
      },
    ];
  }
  const next = [...messages];
  next[index] = {
    ...next[index],
    serverMessageId: messageId,
    role: chatRole,
    content,
  };
  return next;
}

export function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isReplying;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isReplying, replyError]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<unknown>("agent://sse", (event) => {
      const payload = event.payload;
      if (!isCloudSseEvent(payload)) return;
      if (shouldIgnoreSseForRun(activeRunIdRef.current, payload)) return;

      switch (payload.type) {
        case "run.started":
          activeRunIdRef.current = payload.run_id;
          break;
        case "message.delta":
          setMessages((prev) =>
            applyDelta(prev, payload.message_id, payload.delta),
          );
          break;
        case "message.completed":
          setMessages((prev) =>
            applyCompleted(
              prev,
              payload.message_id,
              payload.role,
              payload.content,
            ),
          );
          break;
        case "run.finished":
          if (activeRunIdRef.current === payload.run_id) {
            activeRunIdRef.current = null;
          }
          setIsReplying(false);
          textareaRef.current?.focus();
          break;
        case "error":
          setIsReplying(false);
          setReplyError(payload.message || "请求失败");
          textareaRef.current?.focus();
          break;
        default:
          break;
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || isReplying) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setReplyError(null);
    setIsReplying(true);

    try {
      const { run_id } = await invoke<{ run_id: string }>("start_run", {
        messages: toWireMessages(nextMessages),
      });
      if (run_id) {
        activeRunIdRef.current = run_id;
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "启动对话失败";
      setIsReplying(false);
      setReplyError(message);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.94_0.04_185)_0%,transparent_55%),radial-gradient(ellipse_at_bottom,oklch(0.95_0.03_220)_0%,transparent_50%)]" />
        <div className="animate-soft-pulse absolute left-1/2 top-[18%] h-40 w-40 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <header className="flex shrink-0 items-center justify-center px-6 pt-6">
        <div className="animate-fade-rise flex items-center gap-2 text-foreground/80">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <span className="font-heading text-lg font-semibold tracking-tight">
            Andromeda
          </span>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-8 pt-2">
        {hasMessages ? (
          <section className="min-h-0 flex-1 overflow-hidden pb-3">
            <ScrollArea className="h-full pr-2">
              <ChatMessageList messages={messages} />
              {isReplying ? (
                <p className="animate-fade-rise px-1 py-2 text-xs text-muted-foreground">
                  正在思考…
                </p>
              ) : null}
              {replyError ? (
                <p
                  role="alert"
                  className="animate-fade-rise px-1 py-2 text-xs text-destructive"
                >
                  {replyError}
                </p>
              ) : null}
              <div ref={bottomRef} />
            </ScrollArea>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-end pb-6">
            <div className="animate-fade-rise mx-auto mb-6 max-w-md text-center">
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                有什么可以帮你？
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                在下方输入指令或问题，开始与智能体对话。
              </p>
              {replyError ? (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {replyError}
                </p>
              ) : null}
            </div>
          </section>
        )}

        <form
          onSubmit={handleSubmit}
          className={cn(
            "animate-fade-rise w-full",
            hasMessages ? "mt-auto" : "mb-[12vh]",
          )}
          style={{ animationDelay: "80ms" }}
        >
          <div className="rounded-3xl border border-border/80 bg-card/90 p-2 shadow-[0_10px_40px_-20px_oklch(0.45_0.05_210_/_0.35)] backdrop-blur-md transition-[box-shadow,border-color] focus-within:border-ring/50 focus-within:shadow-[0_12px_44px_-18px_oklch(0.5_0.07_185_/_0.4)]">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="问 Andromeda 任何事情…"
              rows={1}
              disabled={isReplying}
              aria-label="智能体消息输入"
              className="min-h-12 border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-3 px-1.5 pb-1 pt-0.5">
              <p className="text-[11px] text-muted-foreground">
                Enter 发送 · Shift+Enter 换行
              </p>
              <Button
                type="submit"
                size="icon-sm"
                disabled={!canSend}
                aria-label="发送消息"
                className="rounded-2xl"
              >
                <ArrowUp data-icon="inline-start" />
              </Button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
