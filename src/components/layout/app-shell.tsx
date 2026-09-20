import { PanelLeft, PanelRight } from "lucide-react";
import { AgentChat } from "@/components/chat/agent-chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PANEL_LIMITS, usePanelLayout } from "@/hooks/use-panel-layout";
import { PanelSplitter } from "./panel-splitter";

const COPY = {
  leftTitle: "\u5de6\u4fa7\u9762\u677f",
  rightTitle: "\u53f3\u4fa7\u9762\u677f",
  placeholder: "\u5360\u4f4d\uff0c\u540e\u7eed\u63a5\u5165\u5185\u5bb9",
  toggleLeft: "\u5207\u6362\u5de6\u4fa7\u9762\u677f",
  toggleRight: "\u5207\u6362\u53f3\u4fa7\u9762\u677f",
} as const;

function PanelPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-3">
        <p className="truncate text-xs font-medium tracking-wide text-muted-foreground">
          {title}
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="max-w-[12rem] text-center text-sm leading-relaxed text-muted-foreground/80">
          {COPY.placeholder}
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const { layout, toggleLeft, toggleRight, resizeLeftBy, resizeRightBy } =
    usePanelLayout();

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="app-chrome flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={layout.leftOpen}
          aria-label={COPY.toggleLeft}
          title={COPY.toggleLeft}
          onClick={toggleLeft}
          className={cn(layout.leftOpen && "bg-muted text-foreground")}
        >
          <PanelLeft />
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <span className="font-heading text-sm font-semibold tracking-tight text-foreground/85">
            Andromeda
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={layout.rightOpen}
          aria-label={COPY.toggleRight}
          title={COPY.toggleRight}
          onClick={toggleRight}
          className={cn(layout.rightOpen && "bg-muted text-foreground")}
        >
          <PanelRight />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {layout.leftOpen ? (
          <>
            <aside
              className="panel-side panel-side-left flex min-h-0 shrink-0 flex-col border-r border-border/70 bg-sidebar/40"
              style={{
                width: layout.leftWidth,
                minWidth: PANEL_LIMITS.leftMin,
                maxWidth: PANEL_LIMITS.leftMax,
              }}
            >
              <PanelPlaceholder title={COPY.leftTitle} />
            </aside>
            <PanelSplitter
              side="left"
              min={PANEL_LIMITS.leftMin}
              max={PANEL_LIMITS.leftMax}
              value={layout.leftWidth}
              onDrag={resizeLeftBy}
            />
          </>
        ) : null}

        <main className="relative min-h-0 min-w-0 flex-1">
          <AgentChat />
        </main>

        {layout.rightOpen ? (
          <>
            <PanelSplitter
              side="right"
              min={PANEL_LIMITS.rightMin}
              max={PANEL_LIMITS.rightMax}
              value={layout.rightWidth}
              onDrag={resizeRightBy}
            />
            <aside
              className="panel-side panel-side-right flex min-h-0 shrink-0 flex-col border-l border-border/70 bg-sidebar/40"
              style={{
                width: layout.rightWidth,
                minWidth: PANEL_LIMITS.rightMin,
                maxWidth: PANEL_LIMITS.rightMax,
              }}
            >
              <PanelPlaceholder title={COPY.rightTitle} />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
