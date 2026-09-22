import { useEffect, useRef } from "react";
import { Bot, ListTodo, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { UI_COPY } from "./ui-copy";

type ComposerAttachButtonProps = {
  open: boolean;
  active?: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ComposerAttachButton({
  open,
  active = false,
  disabled = false,
  onOpenChange,
}: ComposerAttachButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={UI_COPY.attachAria}
      title={UI_COPY.attachTitle}
      onClick={() => onOpenChange(!open)}
      data-composer-attach-trigger=""
      className={cn(
        "inline-flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors",
        open || active
          ? "bg-muted text-foreground"
          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
    </button>
  );
}

type ComposerAttachPanelProps = {
  open: boolean;
  planMode: boolean;
  subagents: boolean;
  onOpenChange: (open: boolean) => void;
  onTogglePlan: () => void;
  onToggleSubagents: () => void;
};

export function ComposerAttachPanel({
  open,
  planMode,
  subagents,
  onOpenChange,
  onTogglePlan,
  onToggleSubagents,
}: ComposerAttachPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (
        (event.target as Element | null)?.closest?.(
          "[data-composer-attach-trigger]",
        )
      ) {
        return;
      }
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="menu"
      className="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-border/70 bg-card"
    >
      <div className="p-1.5">
        <MenuItem
          active={planMode}
          iconClassName="text-yellow-500"
          Icon={ListTodo}
          label={UI_COPY.planButton}
          description={UI_COPY.planDesc}
          onToggle={onTogglePlan}
        />
        <MenuItem
          active={subagents}
          iconClassName="text-violet-500"
          Icon={Bot}
          label={UI_COPY.subagentsButton}
          description={UI_COPY.subagentsDesc}
          onToggle={onToggleSubagents}
        />
      </div>
    </div>
  );
}

function MenuItem({
  active,
  iconClassName,
  Icon,
  label,
  description,
  onToggle,
}: {
  active: boolean;
  iconClassName: string;
  Icon: typeof ListTodo;
  label: string;
  description: string;
  onToggle: () => void;
}) {
  return (
    <div
      role="menuitemcheckbox"
      aria-checked={active}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors",
        active ? "bg-muted/70" : "hover:bg-muted/50",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 leading-tight">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
          {description}
        </span>
      </div>
      <Switch
        checked={active}
        onCheckedChange={() => onToggle()}
        aria-label={label}
      />
    </div>
  );
}
