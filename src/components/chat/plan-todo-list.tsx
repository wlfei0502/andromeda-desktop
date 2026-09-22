import type { TodoItem, TodoStatus } from "@/lib/cloud-events";
import { cn } from "@/lib/utils";
import { UI_COPY } from "./ui-copy";

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: UI_COPY.todoPending,
  in_progress: UI_COPY.todoInProgress,
  completed: UI_COPY.todoCompleted,
  cancelled: UI_COPY.todoCancelled,
};

function statusClass(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "border-foreground/25 bg-foreground/[0.06] text-foreground";
    case "completed":
      return "border-border bg-muted text-muted-foreground";
    case "cancelled":
      return "border-border bg-muted/60 text-muted-foreground/70 line-through";
    default:
      return "border-border/70 bg-card text-muted-foreground";
  }
}

type PlanTodoListProps = {
  todos: TodoItem[];
  className?: string;
  /** Show empty waiting panel when plan_mode is on but todos have not arrived yet. */
  waiting?: boolean;
};

export function PlanTodoList({ todos, className, waiting = false }: PlanTodoListProps) {
  if (todos.length === 0 && !waiting) return null;

  return (
    <aside
      className={cn(
        "animate-fade-rise rounded-2xl border border-border/70 bg-card p-3 shadow-sm",
        className,
      )}
      aria-label={UI_COPY.planButton}
    >
      <p className="mb-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {UI_COPY.planButton}
      </p>
      {todos.length === 0 ? (
        <p className="px-0.5 text-sm text-muted-foreground">{UI_COPY.planWaiting}</p>
      ) : (
        <ol className="space-y-1.5">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-2.5 py-2 text-sm",
                statusClass(todo.status),
              )}
            >
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {STATUS_LABEL[todo.status]}
              </span>
              <span className="min-w-0 flex-1 leading-snug">{todo.content}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
