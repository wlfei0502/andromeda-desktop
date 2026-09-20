import { useEffect, useRef } from "react";
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

function PanelPlaceholder({
  title,
  onClose,
  closeLabel,
  closeIcon,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  closeIcon: "left" | "right";
}) {
  const Icon = closeIcon === "left" ? PanelLeft : PanelRight;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
        <p className="min-w-0 flex-1 truncate px-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          {title}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className="shrink-0 text-muted-foreground"
        >
          <Icon />
        </Button>
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
  const {
    layout,
    toggleLeft,
    toggleRight,
    resizeLeftBy,
    resizeRightBy,
    reportContainerWidth,
    leftDragMax,
    rightDragMax,
  } = usePanelLayout();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null) reportContainerWidth(width);
    });
    observer.observe(row);
    reportContainerWidth(row.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [reportContainerWidth]);

  return (
    <div
      ref={rowRef}
      className="flex h-full min-h-0 min-w-0 overflow-hidden bg-background"
    >
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
            <PanelPlaceholder
              title={COPY.leftTitle}
              onClose={toggleLeft}
              closeLabel={COPY.toggleLeft}
              closeIcon="left"
            />
          </aside>
          <PanelSplitter
            side="left"
            min={PANEL_LIMITS.leftMin}
            max={leftDragMax}
            value={layout.leftWidth}
            onDrag={resizeLeftBy}
          />
        </>
      ) : null}

      <main
        className="panel-center relative min-h-0 flex-1"
        style={{ minWidth: PANEL_LIMITS.centerMin }}
      >
        {!layout.leftOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={COPY.toggleLeft}
            title={COPY.toggleLeft}
            onClick={toggleLeft}
            className={cn(
              "panel-float-toggle absolute top-2 left-2 z-30",
              "bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm",
              "hover:bg-muted hover:text-foreground",
            )}
          >
            <PanelLeft />
          </Button>
        ) : null}

        {!layout.rightOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={COPY.toggleRight}
            title={COPY.toggleRight}
            onClick={toggleRight}
            className={cn(
              "panel-float-toggle absolute top-2 right-2 z-30",
              "bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm",
              "hover:bg-muted hover:text-foreground",
            )}
          >
            <PanelRight />
          </Button>
        ) : null}

        <AgentChat />
      </main>

      {layout.rightOpen ? (
        <>
          <PanelSplitter
            side="right"
            min={PANEL_LIMITS.rightMin}
            max={rightDragMax}
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
            <PanelPlaceholder
              title={COPY.rightTitle}
              onClose={toggleRight}
              closeLabel={COPY.toggleRight}
              closeIcon="right"
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}
