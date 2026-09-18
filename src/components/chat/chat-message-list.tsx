import { cn } from "@/lib/utils";
import { MarkdownContent } from "./markdown-content";
import type { ChatMessage } from "./types";

type ChatMessageListProps = {
  messages: ChatMessage[];
};

export function ChatMessageList({ messages }: ChatMessageListProps) {
  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      {messages.map((message, index) => {
        const isUser = message.role === "user";

        return (
          <div
            key={message.id}
            className={cn(
              "animate-fade-rise flex w-full",
              isUser ? "justify-end" : "justify-start",
            )}
            style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                isUser
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/70 text-foreground ring-1 ring-border/70 backdrop-blur-sm",
              )}
            >
              {!isUser ? (
                <p className="mb-1 text-[11px] font-medium tracking-wide text-primary">
                  Andromeda
                </p>
              ) : null}
              {isUser ? (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              ) : (
                <MarkdownContent content={message.content} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
