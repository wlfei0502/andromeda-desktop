import { CircleStop, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { UI_COPY } from "./ui-copy";

export type PendingQueueItem = {
  id: string;
  content: string;
};

type PendingQueueProps = {
  items: PendingQueueItem[];
  /** Interrupt current run and send the first item (only shown on index 0). */
  onInterruptFirst: () => void;
  onRemove: (id: string) => void;
  interruptDisabled?: boolean;
  className?: string;
};

export function PendingQueue({
  items,
  onInterruptFirst,
  onRemove,
  interruptDisabled = false,
  className,
}: PendingQueueProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        "animate-fade-rise mb-2 rounded-2xl border border-border/70 bg-muted/50 px-3 py-2.5",
        className,
      )}
      role="status"
      aria-label={UI_COPY.ariaQueue}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground">
          <span className="text-foreground">
            {items.length} {UI_COPY.queueLabel}
          </span>
          <span className="mx-1.5 text-border">·</span>
          {UI_COPY.queueHint}
        </p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="group flex items-start gap-2 text-sm leading-snug text-foreground"
          >
            <span
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/70"
              aria-hidden
            />
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {item.content}
            </p>
            <div className="flex shrink-0 items-center gap-0.5">
              {index === 0 ? (
                <button
                  type="button"
                  onClick={onInterruptFirst}
                  disabled={interruptDisabled}
                  className="rounded-md p-0.5 text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 disabled:opacity-40"
                  aria-label={UI_COPY.queueInterrupt}
                  title={UI_COPY.queueInterrupt}
                >
                  <CircleStop className="size-3.5" aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="rounded-md p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
                aria-label={UI_COPY.queueRemove}
                title={UI_COPY.queueRemove}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
