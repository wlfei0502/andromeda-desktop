import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, Square } from "lucide-react";
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
import { ComposerAttachButton, ComposerAttachPanel } from "./composer-attach-menu";
import { PlanTodoList } from "./plan-todo-list";
import { PendingQueue, type PendingQueueItem } from "./pending-queue";
import { UI_COPY } from "./ui-copy";
import type { ChatMessage, ChatRole } from "./types";

const COMPOSER_LINE_H = 28;
const COMPOSER_TALL_THRESHOLD = 40;
const COMPOSER_MAX_H = 192;

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
  const [toolHint, setToolHint] = useState<string | null>(null);
  const [taskHint, setTaskHint] = useState<string | null>(null);
  const [plan_mode, set_plan_mode] = useState(false);
  const [subagents, setSubagents] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<PendingQueueItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const runEndedRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingQueueRef = useRef<PendingQueueItem[]>([]);
  const pendingReopenRef = useRef<string | null>(null);
  const startRunRef = useRef<
    (next: ChatMessage[]) => Promise<void>
  >(async () => {});
  const [composerPad, setComposerPad] = useState(200);
  const [composerTall, setComposerTall] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  const hasMessages = messages.length > 0;
  const canEnqueue = isReplying && !!activeRunId && !cancelling;
  const canCancel = isReplying && !!activeRunId && !cancelling;
  const canSend =
    draft.trim().length > 0 && (!isReplying || canEnqueue);
  const canInterruptFirst =
    pendingQueue.length > 0 && !cancelling && (!isReplying || !!activeRunId);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pendingQueueRef.current = pendingQueue;
  }, [pendingQueue]);

  useEffect(() => {
    void invoke<{
      default_plan_mode?: boolean;
      default_subagents?: boolean;
    }>("get_cloud_config")
      .then((cfg) => {
        if (cfg?.default_plan_mode) {
          set_plan_mode(true);
        }
        if (cfg?.default_subagents) {
          setSubagents(true);
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
    const el = textareaRef.current;
    if (!el) return;
    if (!draft) {
      if (composerTall) setComposerTall(false);
      el.style.height = `${COMPOSER_LINE_H}px`;
      return;
    }
    el.style.height = "auto";
    const scroll = el.scrollHeight;
    const tall = scroll > COMPOSER_TALL_THRESHOLD;
    if (tall !== composerTall) setComposerTall(tall);
    el.style.height = `${Math.max(Math.min(scroll, COMPOSER_MAX_H), COMPOSER_LINE_H)}px`;
  }, [draft, composerTall]);

  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;

    const syncInset = () => {
      const gutter = Math.max(0, shell.offsetWidth - shell.clientWidth);
      document.documentElement.style.setProperty(
        "--chat-composer-inset",
        `${gutter}px`,
      );
    };
    const onScroll = () => {
      const distance =
        shell.scrollHeight - shell.scrollTop - shell.clientHeight;
      stickToBottomRef.current = distance < 80;
    };
    syncInset();
    const observer = new ResizeObserver(syncInset);
    observer.observe(shell);
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      shell.removeEventListener("scroll", onScroll);
    };
  }, [hasMessages]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const shell = scrollRef.current;
    if (!shell) return;
    shell.scrollTo({ top: shell.scrollHeight, behavior: "smooth" });
  }, [
    messages,
    isReplying,
    replyError,
    todos,
    toolHint,
    taskHint,
    pendingQueue,
    composerPad,
  ]);

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
          setActiveRunId(payload.run_id);
          break;
        case "run.resumed":
          activeRunIdRef.current = payload.run_id;
          setActiveRunId(payload.run_id);
          break;
        case "message.delta":
          setToolHint(null);
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
          // Ignore mid-run steer events if any; product path is queue + reopen.
          if (payload.source === "steer") {
            break;
          }
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
        case "tool.request": {
          const city =
            payload.arguments &&
            typeof payload.arguments.city === "string"
              ? payload.arguments.city
              : "";
          const base = city
            ? `${UI_COPY.weatherQuery}\uff1a${city}`
            : UI_COPY.weatherQuery;
          setToolHint(
            payload.agent_id
              ? `${base} (${payload.agent_id})`
              : base,
          );
          break;
        }
        case "task.started":
          setTaskHint(
            `${UI_COPY.taskRunning}\uff1a${payload.goal} [${payload.agent}]`,
          );
          break;
        case "task.completed":
          setTaskHint(
            `${UI_COPY.taskDone}\uff1a${payload.summary || payload.task_id}`,
          );
          break;
        case "task.failed":
          setTaskHint(
            `${UI_COPY.taskFailed}\uff1a${payload.message || payload.task_id}`,
          );
          break;
        case "task.timed_out":
          setTaskHint(`${UI_COPY.taskTimedOut}\uff1a${payload.task_id}`);
          break;
        case "run.finished":
        case "error": {
          const isError = payload.type === "error";
          if (
            activeRunIdRef.current === null ||
            !payload.run_id ||
            activeRunIdRef.current === payload.run_id
          ) {
            activeRunIdRef.current = null;
            setActiveRunId(null);
          }
          runEndedRef.current = true;
          setToolHint(null);
          setTaskHint(null);
          setIsReplying(false);
          setCancelling(false);
          if (isError) {
            setReplyError(payload.message || UI_COPY.requestFailed);
          }
          const reopen = pendingReopenRef.current;
          pendingReopenRef.current = null;
          if (reopen) {
            const userMessage: ChatMessage = {
              id: createId(),
              role: "user",
              content: reopen,
            };
            void startRunRef.current([...messagesRef.current, userMessage]);
            break;
          }

          // Natural completion: drain queue head as the next user turn.
          const finishedOk =
            payload.type === "run.finished" && payload.reason !== "cancelled";
          const next = finishedOk ? pendingQueueRef.current[0] : undefined;
          if (next) {
            setPendingQueue((prev) => prev.filter((item) => item.id !== next.id));
            const userMessage: ChatMessage = {
              id: createId(),
              role: "user",
              content: next.content,
            };
            void startRunRef.current([...messagesRef.current, userMessage]);
          } else {
            textareaRef.current?.focus();
          }
          break;
        }
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

  async function startRunWithMessages(nextMessages: ChatMessage[]) {
    setMessages(nextMessages);
    setReplyError(null);
    setToolHint(null);
    setTaskHint(null);
    setIsReplying(true);
    stickToBottomRef.current = true;
    if (!plan_mode) {
      setTodos([]);
    }
    activeRunIdRef.current = null;
    setActiveRunId(null);
    runEndedRef.current = false;

    try {
      const { run_id } = await invoke<{ run_id: string }>("start_run", {
        messages: toWireMessages(nextMessages),
        plan_mode,
        subagents,
      });
      if (run_id && !runEndedRef.current) {
        activeRunIdRef.current = run_id;
        setActiveRunId(run_id);
      }
    } catch (err) {
      activeRunIdRef.current = null;
      setActiveRunId(null);
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

  startRunRef.current = startRunWithMessages;

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;

    const runId = activeRunIdRef.current;
    if (isReplying && runId) {
      if (cancelling) return;
      setPendingQueue((prev) => [
        ...prev,
        { id: createId(), content: trimmed },
      ]);
      setDraft("");
      setReplyError(null);
      return;
    }

    if (isReplying) {
      setReplyError(UI_COPY.queueWaitingRun);
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };
    await startRunWithMessages([...messages, userMessage]);
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
    await startRunWithMessages([...messages.slice(0, index), userMessage]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  async function handleCancel() {
    const runId = activeRunIdRef.current;
    if (!runId || cancelling || !isReplying) return;
    pendingReopenRef.current = null;
    setCancelling(true);
    setReplyError(null);
    try {
      await invoke("cancel_run", { run_id: runId });
    } catch (err) {
      setCancelling(false);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : UI_COPY.cancelFailed;
      setReplyError(message);
      textareaRef.current?.focus();
    }
  }

  async function handleInterruptFirst() {
    const first = pendingQueue[0];
    if (!first || cancelling) return;

    setPendingQueue((prev) => prev.filter((item) => item.id !== first.id));
    setReplyError(null);

    const runId = activeRunIdRef.current;
    if (isReplying && runId) {
      pendingReopenRef.current = first.content;
      setCancelling(true);
      try {
        await invoke("cancel_run", { run_id: runId });
      } catch (err) {
        pendingReopenRef.current = null;
        setCancelling(false);
        setPendingQueue((prev) => [first, ...prev]);
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : UI_COPY.interruptFailed;
        setReplyError(message);
        textareaRef.current?.focus();
      }
      return;
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: first.content,
    };
    await startRunWithMessages([...messages, userMessage]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && canCancel) {
      event.preventDefault();
      void handleCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  useEffect(() => {
    if (isReplying || cancelling) setAttachOpen(false);
  }, [isReplying, cancelling]);

  const attachButton = (
    <ComposerAttachButton
      open={attachOpen}
      active={plan_mode || subagents}
      disabled={isReplying || cancelling}
      onOpenChange={setAttachOpen}
    />
  );

  const sendOrCancel = canCancel ? (
    <Button
      type="button"
      size="icon-xs"
      disabled={cancelling}
      onClick={() => void handleCancel()}
      aria-label={UI_COPY.ariaCancel}
      title={UI_COPY.cancelTitle}
      className="size-7 shrink-0 rounded-full"
    >
      <Square className="size-2.5 fill-current" aria-hidden />
    </Button>
  ) : (
    <Button
      type="submit"
      size="icon-xs"
      disabled={!canSend}
      aria-label={UI_COPY.ariaSend}
      className="size-7 shrink-0 rounded-full"
    >
      <ArrowUp className="size-3.5" data-icon="inline-start" />
    </Button>
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.92_0_0)_0%,transparent_55%),radial-gradient(ellipse_at_bottom,oklch(0.9_0_0)_0%,transparent_50%)]" />
        <div className="animate-soft-pulse absolute left-1/2 top-[18%] h-40 w-40 -translate-x-1/2 rounded-full bg-foreground/[0.04] blur-3xl" />
      </div>

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
                {toolHint ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {toolHint}
                  </p>
                ) : null}
                {taskHint ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    {taskHint}
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
            <PendingQueue
              items={pendingQueue}
              interruptDisabled={!canInterruptFirst}
              onInterruptFirst={() => {
                void handleInterruptFirst();
              }}
              onRemove={(id) => {
                setPendingQueue((prev) => prev.filter((item) => item.id !== id));
              }}
            />
            <div
              className={cn(
                COMPOSER_SHELL,
                "relative transition-[box-shadow,border-color] focus-within:border-ring/50 focus-within:shadow-[0_12px_44px_-18px_oklch(0.2_0_0_/_0.28)]",
                composerTall
                  ? "flex flex-col rounded-xl"
                  : "flex items-center gap-1.5 rounded-full p-1.5 pl-2",
              )}
            >
              <ComposerAttachPanel
                open={attachOpen}
                planMode={plan_mode}
                subagents={subagents}
                onOpenChange={setAttachOpen}
                onTogglePlan={() => set_plan_mode((v) => !v)}
                onToggleSubagents={() => setSubagents((v) => !v)}
              />
              {!composerTall ? attachButton : null}
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  canEnqueue ? UI_COPY.placeholderQueue : UI_COPY.placeholder
                }
                rows={1}
                disabled={cancelling || (isReplying && !activeRunId)}
                aria-label={UI_COPY.ariaInput}
                className={cn(
                  "max-h-48 resize-none border-0 bg-transparent text-sm shadow-none field-sizing-fixed focus-visible:border-transparent focus-visible:ring-0",
                  composerTall
                    ? "min-h-7 w-full overflow-y-auto px-3.5 pt-3.5 pb-2 leading-snug"
                    : "h-7 min-h-7 flex-1 overflow-y-hidden px-1.5 py-0 leading-7",
                )}
              />
              {composerTall ? (
                <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
                  {attachButton}
                  <div className="ml-auto shrink-0">{sendOrCancel}</div>
                </div>
              ) : (
                sendOrCancel
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
