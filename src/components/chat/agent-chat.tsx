import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  isCloudSseEvent,
  shouldIgnoreSseForRun,
  type TodoItem,
  type WireChatMessage,
} from "@/lib/cloud-events";
import { cn } from "@/lib/utils";
import { ChatMessageList, COMPOSER_SHELL } from "./chat-message-list";
import { PlanTodoList } from "./plan-todo-list";
import { UI_COPY } from "./ui-copy";
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
        reasoningStreaming: false,
      },
    ];
  }
  const next = [...messages];
  const existing = next[index];
  next[index] = {
    ...existing,
    serverMessageId: messageId,
    content: existing.content + delta,
    reasoningStreaming: false,
  };
  return next;
}

function applyReasoningDelta(
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
        content: "",
        reasoning: delta,
        reasoningStreaming: true,
      },
    ];
  }
  const next = [...messages];
  const existing = next[index];
  next[index] = {
    ...existing,
    serverMessageId: messageId,
    reasoning: (existing.reasoning ?? "") + delta,
    reasoningStreaming: existing.content.length === 0,
  };
  return next;
}

function applyCompleted(
  messages: ChatMessage[],
  messageId: string,
  role: string,
  content: string,
  reasoningContent?: string | null,
): ChatMessage[] {
  const chatRole: ChatRole = role === "user" ? "user" : "assistant";
  const index = messages.findIndex(
    (m) => m.serverMessageId === messageId || m.id === messageId,
  );
  const reasoning =
    reasoningContent && reasoningContent.length > 0
      ? reasoningContent
      : undefined;
  if (index === -1) {
    return [
      ...messages,
      {
        id: messageId,
        serverMessageId: messageId,
        role: chatRole,
        content,
        reasoning,
        reasoningStreaming: false,
      },
    ];
  }
  const next = [...messages];
  const existing = next[index];
  next[index] = {
    ...existing,
    serverMessageId: messageId,
    role: chatRole,
    content,
    reasoning: reasoning ?? existing.reasoning,
    reasoningStreaming: false,
  };
  return next;
}

export function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [plan_mode, set_plan_mode] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runEndedRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const [composerPad, setComposerPad] = useState(200);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isReplying;

  useEffect(() => {
    void invoke<{ default_plan_mode?: boolean }>("get_cloud_config")
      .then((cfg) => {
        if (cfg?.default_plan_mode) {
          set_plan_mode(true);
        }
      })
      .catch(() => {
        /* keep UI default off */
      });
  }, []);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const syncSpace = () => {
      // Include a small buffer so the last lines clear the floating dock.
      const next = Math.ceil(composer.getBoundingClientRect().height) + 28;
      setComposerPad(next);
      document.documentElement.style.setProperty(
        "--chat-composer-space",
        `${next}px`,
      );
    };
    syncSpace();
    const observer = new ResizeObserver(syncSpace);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;

    const onScroll = () => {
      const distance =
        shell.scrollHeight - shell.scrollTop - shell.clientHeight;
      stickToBottomRef.current = distance < 80;
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => shell.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const shell = scrollRef.current;
    if (!shell) return;
    shell.scrollTo({ top: shell.scrollHeight, behavior: "smooth" });
  }, [messages, isReplying, replyError, todos, composerPad]);

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
        case "reasoning.delta":
          setMessages((prev) =>
            applyReasoningDelta(prev, payload.message_id, payload.delta),
          );
          break;
        case "message.completed":
          setMessages((prev) =>
            applyCompleted(
              prev,
              payload.message_id,
              payload.role,
              payload.content,
              payload.reasoning_content,
            ),
          );
          break;
        case "todos.updated":
          setTodos(payload.todos);
          break;
        case "run.finished":
          if (
            activeRunIdRef.current === null ||
            activeRunIdRef.current === payload.run_id
          ) {
            activeRunIdRef.current = null;
          }
          runEndedRef.current = true;
          setIsReplying(false);
          textareaRef.current?.focus();
          break;
        case "error":
          if (
            activeRunIdRef.current === null ||
            !payload.run_id ||
            activeRunIdRef.current === payload.run_id
          ) {
            activeRunIdRef.current = null;
          }
          runEndedRef.current = true;
          setIsReplying(false);
          setReplyError(payload.message || UI_COPY.requestFailed);
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
    await startRunWithMessages(nextMessages);
    setDraft("");
  }

  async function resubmitUserMessage(messageId: string, content: string) {
    const trimmed = content.trim();
    if (!trimmed || isReplying) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...messages.slice(0, index), userMessage];
    await startRunWithMessages(nextMessages);
  }

  async function startRunWithMessages(nextMessages: ChatMessage[]) {
    setMessages(nextMessages);
    setReplyError(null);
    setIsReplying(true);
    stickToBottomRef.current = true;
    if (!plan_mode) {
      setTodos([]);
    }
    activeRunIdRef.current = null;
    runEndedRef.current = false;

    try {
      const { run_id } = await invoke<{ run_id: string }>("start_run", {
        messages: toWireMessages(nextMessages),
        plan_mode,
      });
      if (run_id && !runEndedRef.current) {
        activeRunIdRef.current = run_id;
      }
    } catch (err) {
      activeRunIdRef.current = null;
      runEndedRef.current = true;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : UI_COPY.startFailed;
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
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.94_0.04_185)_0%,transparent_55%),radial-gradient(ellipse_at_bottom,oklch(0.95_0.03_220)_0%,transparent_50%)]" />
        <div className="animate-soft-pulse absolute left-1/2 top-[18%] h-40 w-40 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Parent scrollport — scrollbar on the shell, composer floats above content only. */}
      <div className="chat-frame">
        <div ref={scrollRef} className="chat-shell">
          <main
            className={cn(
              "chat-column mx-auto w-full pt-2",
              !hasMessages && "flex min-h-full flex-col",
            )}
            style={{ paddingBottom: composerPad }}
          >
            {hasMessages ? (
              <section className="min-w-0">
                {plan_mode || todos.length > 0 ? (
                  <PlanTodoList
                    todos={todos}
                    waiting={plan_mode && isReplying && todos.length === 0}
                    className="mb-3"
                  />
                ) : null}
                <ChatMessageList
                  messages={messages}
                  disabled={isReplying}
                  onResubmitUserMessage={(messageId, content) => {
                    void resubmitUserMessage(messageId, content);
                  }}
                />
                {replyError ? (
                  <p
                    role="alert"
                    className="animate-fade-rise px-1 py-2 text-xs text-destructive"
                  >
                    {replyError}
                  </p>
                ) : null}
                <div
                  ref={bottomRef}
                  className="chat-scroll-anchor"
                  aria-hidden
                />
              </section>
            ) : (
              <section className="flex min-h-0 flex-1 flex-col items-center justify-center">
                <div className="animate-fade-rise mx-auto max-w-md -translate-y-[8vh] text-center">
                  <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
                    {UI_COPY.hello}
                  </h1>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                    {UI_COPY.emptyHint}
                  </p>
                  {plan_mode ? (
                    <PlanTodoList
                      todos={todos}
                      waiting={isReplying && todos.length === 0}
                      className="mt-4 text-left"
                    />
                  ) : null}
                  {replyError ? (
                    <p role="alert" className="mt-3 text-xs text-destructive">
                      {replyError}
                    </p>
                  ) : null}
                </div>
              </section>
            )}
          </main>
        </div>

        <div ref={composerRef} className="chat-composer-dock pointer-events-none">
          <form
            onSubmit={handleSubmit}
            className="chat-column pointer-events-auto mx-auto w-full animate-fade-rise pb-6"
            style={{ animationDelay: "80ms" }}
          >
          <div
            className={cn(
              COMPOSER_SHELL,
              "p-2 transition-[box-shadow,border-color] focus-within:border-ring/50 focus-within:shadow-[0_12px_44px_-18px_oklch(0.5_0.07_185_/_0.4)]",
            )}
          >
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={UI_COPY.placeholder}
              rows={1}
              disabled={isReplying}
              aria-label={UI_COPY.ariaInput}
              className="min-h-12 border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0"
            />
            <div className="flex flex-nowrap items-center justify-between gap-3 px-1.5 pb-1 pt-0.5">
              <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">
                <button
                  type="button"
                  onClick={() => set_plan_mode((v) => !v)}
                  disabled={isReplying}
                  aria-pressed={plan_mode}
                  title={UI_COPY.planTitle}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2 py-1 text-[11px] transition-colors",
                    plan_mode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted/60",
                    isReplying && "opacity-50",
                  )}
                >
                  <ListTodo className="size-3.5" aria-hidden />
                  {UI_COPY.planButton}
                </button>
                <p className="truncate whitespace-nowrap text-[11px] text-muted-foreground">
                  {UI_COPY.enterHint}
                </p>
              </div>
              <Button
                type="submit"
                size="icon-sm"
                disabled={!canSend}
                aria-label={UI_COPY.ariaSend}
                className="rounded-2xl"
              >
                <ArrowUp data-icon="inline-start" />
              </Button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}
