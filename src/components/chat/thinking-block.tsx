import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { UI_COPY } from "./ui-copy";

type ThinkingBlockProps = {
  content: string;
  streaming?: boolean;
  className?: string;
};

export function ThinkingBlock({
  content,
  streaming = false,
  className,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [content, streaming, open]);

  if (!content && !streaming) return null;

  return (
    <div
      className={cn(
        "mb-2.5 rounded-lg border border-border/60 bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium tracking-wide transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <Sparkles
          className={cn("size-3 shrink-0 text-primary/70", streaming && "animate-soft-pulse")}
          aria-hidden
        />
        <span className="flex-1">
          {streaming ? UI_COPY.thinking : UI_COPY.thinkingDone}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          ref={bodyRef}
          className="thinking-scroll max-h-48 overflow-x-hidden overflow-y-auto border-t border-border/50 px-2.5 py-2 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {content || (streaming ? "\u2026" : null)}
        </div>
      ) : null}
    </div>
  );
}
