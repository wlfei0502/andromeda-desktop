import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "./markdown-content";
import { ThinkingBlock } from "./thinking-block";
import type { ChatMessage } from "./types";

/** Shared shell with the bottom composer so widths and chrome match. */
export const COMPOSER_SHELL =
  "rounded-2xl border border-border/80 bg-card shadow-[0_10px_40px_-22px_oklch(0.2_0_0_/_0.28)]";

type ChatMessageListProps = {
  messages: ChatMessage[];
  disabled?: boolean;
  onResubmitUserMessage?: (messageId: string, content: string) => void;
};

function UserMessageBubble({
  content,
  disabled = false,
  onResubmit,
}: {
  content: string;
  disabled?: boolean;
  onResubmit?: (content: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skipBlurResetRef = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(content);
  }, [content, focused]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!focused) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, focused]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    if (trimmed === content.trim()) {
      textareaRef.current?.blur();
      return;
    }
    skipBlurResetRef.current = true;
    onResubmit?.(trimmed);
    setFocused(false);
    textareaRef.current?.blur();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(content);
      setFocused(false);
      textareaRef.current?.blur();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit();
    }
  }

  return (
    <div
      className={cn(
        COMPOSER_SHELL,
        "overflow-hidden px-3 py-2.5 transition-[box-shadow,border-color]",
        focused
          ? "border-ring/50 shadow-[0_12px_44px_-18px_oklch(0.2_0_0_/_0.28)]"
          : "cursor-pointer",
      )}
    >
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={disabled}
        rows={1}
        spellCheck={false}
        aria-label="Edit user message"
        onChange={(event) => setDraft(event.target.value)}
        onMouseDown={(event) => {
          // First activation: keep caret at end (browser would place it at click).
          if (document.activeElement === textareaRef.current) return;
          event.preventDefault();
          const el = textareaRef.current;
          if (!el || disabled) return;
          setFocused(true);
          el.focus();
          const end = el.value.length;
          el.setSelectionRange(end, end);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (skipBlurResetRef.current) {
            skipBlurResetRef.current = false;
            setFocused(false);
            return;
          }
          setFocused(false);
          setDraft(content);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "block w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
          focused
            ? "max-h-64 cursor-text overflow-y-auto whitespace-pre-wrap"
            : "h-6 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis",
        )}
      />
    </div>
  );
}

/** Join reasoning from a tool-only turn into the following assistant reply. */
function joinReasoning(current?: string, next?: string): string | undefined {
  const left = current?.trim() ?? "";
  const right = next?.trim() ?? "";
  if (!left) return next;
  if (!right) return current;
  if (left === right || right.startsWith(left)) return next;
  if (left.endsWith(right)) return current;
  return `${current}\n\n${next}`;
}

/**
 * A tool round often completes as an assistant message with reasoning and no
 * body, then the next round adds another. Show that as one thinking card.
 */
function coalesceAssistantTurns(messages: ChatMessage[]): ChatMessage[] {
  const visible: ChatMessage[] = [];
  for (const message of messages) {
    const prev = visible[visible.length - 1];
    if (
      prev &&
      prev.role === "assistant" &&
      message.role === "assistant" &&
      prev.content.trim().length === 0
    ) {
      visible[visible.length - 1] = {
        ...prev,
        serverMessageId: message.serverMessageId ?? prev.serverMessageId,
        content: message.content,
        reasoning: joinReasoning(prev.reasoning, message.reasoning),
        reasoningStreaming: Boolean(message.reasoningStreaming),
      };
      continue;
    }
    visible.push(message);
  }
  return visible;
}

export function ChatMessageList({
  messages,
  disabled = false,
  onResubmitUserMessage,
}: ChatMessageListProps) {
  const visible = coalesceAssistantTurns(messages);
  return (
    <div className="flex min-w-0 w-full flex-col gap-4 py-2">
      {visible.map((message, index) => {
        const isUser = message.role === "user";
        const hasReasoning =
          Boolean(message.reasoning) || message.reasoningStreaming;

        return (
          <div
            key={message.id}
            className="animate-fade-rise w-full min-w-0"
            style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
          >
            {isUser ? (
              <UserMessageBubble
                content={message.content}
                disabled={disabled}
                onResubmit={
                  onResubmitUserMessage
                    ? (content) => onResubmitUserMessage(message.id, content)
                    : undefined
                }
              />
            ) : (
              <div className="min-w-0 w-full overflow-hidden text-base leading-relaxed [overflow-wrap:anywhere]">
                {hasReasoning ? (
                  <ThinkingBlock
                    content={message.reasoning ?? ""}
                    streaming={message.reasoningStreaming}
                  />
                ) : null}
                {message.content.trim() ? (
                  <MarkdownContent content={message.content} />
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
