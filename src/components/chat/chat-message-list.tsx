import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "./markdown-content";
import { ThinkingBlock } from "./thinking-block";
import type { ChatMessage } from "./types";

/** Shared shell with the bottom composer so widths and chrome match. */
export const COMPOSER_SHELL =
  "rounded-3xl border border-border/80 bg-background shadow-[0_10px_40px_-20px_oklch(0.45_0.05_210_/_0.35)]";

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
          ? "border-ring/50 shadow-[0_12px_44px_-18px_oklch(0.5_0.07_185_/_0.4)]"
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

export function ChatMessageList({
  messages,
  disabled = false,
  onResubmitUserMessage,
}: ChatMessageListProps) {
  return (
    <div className="flex min-w-0 w-full flex-col gap-4 py-2">
      {messages.map((message, index) => {
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
                <p className="mb-1.5 text-[11px] font-medium tracking-wide text-primary">
                  Andromeda
                </p>
                {hasReasoning ? (
                  <ThinkingBlock
                    content={message.reasoning ?? ""}
                    streaming={message.reasoningStreaming}
                  />
                ) : null}
                {message.content ? (
                  <MarkdownContent content={message.content} />
                ) : message.reasoningStreaming ? null : (
                  <p className="text-muted-foreground">…</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
