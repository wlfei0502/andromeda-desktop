import { Check, Circle, LoaderCircle, X } from "lucide-react";
import type { TodoItem, TodoStatus } from "@/lib/cloud-events";
import { cn } from "@/lib/utils";
import { UI_COPY } from "./ui-copy";

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: UI_COPY.todoPending,
  in_progress: UI_COPY.todoInProgress,
  completed: UI_COPY.todoCompleted,
  cancelled: UI_COPY.todoCancelled,
};

function statusTone(status: TodoStatus) {
  switch (status) {
    case "in_progress":
      return {
        row: "border-sky-200/80 bg-sky-50/90 text-foreground",
        badge: "bg-sky-500/15 text-sky-700",
        icon: "text-sky-600",
      };
    case "completed":
      return {
        row: "border-emerald-200/70 bg-emerald-50/70 text-foreground/80",
        badge: "bg-emerald-500/15 text-emerald-700",
        icon: "text-emerald-600",
      };
    case "cancelled":
      return {
        row: "border-border/60 bg-muted/40 text-muted-foreground/70 line-through",
        badge: "bg-muted text-muted-foreground",
        icon: "text-muted-foreground",
      };
    default:
      return {
        row: "border-border/50 bg-card/80 text-foreground/90",
        badge: "bg-amber-500/12 text-amber-700",
        icon: "text-amber-500/80",
      };
  }
}

function StatusIcon({ status }: { status: TodoStatus }) {
  const tone = statusTone(status).icon;
  switch (status) {
    case "in_progress":
      return <LoaderCircle className={cn("size-3.5 shrink-0 animate-spin", tone)} aria-hidden />;
    case "completed":
      return <Check className={cn("size-3.5 shrink-0", tone)} strokeWidth={2.5} aria-hidden />;
    case "cancelled":
      return <X className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
    default:
      return <Circle className={cn("size-3.5 shrink-0", tone)} aria-hidden />;
  }
}

type PlanTodoListProps = {
  todos: TodoItem[];
  className?: string;
  /** Show empty waiting panel when plan_mode is on but todos have not arrived yet. */
  waiting?: boolean;
  /** Embed in right panel without chat-card chrome. */
  variant?: "card" | "panel";
};

export function PlanTodoList({
  todos,
  className,
  waiting = false,
  variant = "card",
}: PlanTodoListProps) {
  if (todos.length === 0 && !waiting) {
    if (variant === "panel") {
      return (
        <div
          className={cn(
            "flex h-full min-h-[12rem] flex-col items-center justify-center px-6 text-center",
            className,
          )}
          aria-label={UI_COPY.planButton}
        >
          <p className="text-sm font-medium text-foreground/80">
            {UI_COPY.planEmpty}
          </p>
          <p className="mt-2 max-w-[16rem] text-[13px] leading-relaxed text-muted-foreground">
            {UI_COPY.planEmptyHint}
          </p>
        </div>
      );
    }
    return null;
  }

  const done = todos.filter(
    (t) => t.status === "completed" || t.status === "cancelled",
  ).length;
  const total = todos.length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  const list =
    todos.length === 0 ? (
      <div className="flex min-h-[12rem] flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{UI_COPY.planWaiting}</p>
      </div>
    ) : (
      <ol className="space-y-1.5">
        {todos.map((todo) => {
          const tone = statusTone(todo.status);
          return (
            <li
              key={todo.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm",
                tone.row,
              )}
            >
              <StatusIcon status={todo.status} />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "mb-1 inline-flex rounded-full px-1.5 py-px text-[10px] font-medium leading-4",
                    tone.badge,
                  )}
                >
                  {STATUS_LABEL[todo.status]}
                </span>
                <p className="leading-snug">{todo.content}</p>
              </div>
            </li>
          );
        })}
      </ol>
    );

  const progressHeader =
    total > 0 ? (
      <div className="mb-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {UI_COPY.planProgress}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-400/90 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    ) : null;

  if (variant === "panel") {
    return (
      <div className={cn("min-w-0", className)} aria-label={UI_COPY.planButton}>
        {progressHeader}
        {list}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "animate-fade-rise rounded-2xl border border-border/70 bg-card p-3 shadow-sm",
        className,
      )}
      aria-label={UI_COPY.planButton}
    >
      <p className="mb-2 px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
        {UI_COPY.planButton}
      </p>
      {progressHeader}
      {list}
    </aside>
  );
}
