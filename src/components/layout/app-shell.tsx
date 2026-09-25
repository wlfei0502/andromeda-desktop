import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelLeft, PanelRight } from "lucide-react";
import { AgentChat } from "@/components/chat/agent-chat";
import { UI_COPY } from "@/components/chat/ui-copy";
import { Button } from "@/components/ui/button";
import { filesFromPaths } from "@/lib/file-from-path";
import {
  markFileDropHandled,
  notifyFileDropPaths,
  notifyFileDropPhase,
  registerFileDropHandlers,
} from "@/lib/file-drop-bus";
import {
  parseGisFile,
  parseGisPaths,
  partitionDropFiles,
  partitionDropPaths,
} from "@/lib/gis-files";
import { dispatchToMapWebview } from "@/lib/map-bridge";
import { isTauriRuntime } from "@/lib/panel-add-menu";
import { cn } from "@/lib/utils";
import { PANEL_LIMITS, usePanelLayout } from "@/hooks/use-panel-layout";
import { PanelTabsProvider, usePanelTabsContext } from "./panel-tabs-context";
import { PanelSplitter } from "./panel-splitter";
import { RightPanel } from "./right-panel";

const COPY = {
  leftTitle: "\u5de6\u4fa7\u9762\u677f",
  placeholder: "\u5360\u4f4d\uff0c\u540e\u7eed\u63a5\u5165\u5185\u5bb9",
  toggleLeft: "\u5207\u6362\u5de6\u4fa7\u9762\u677f",
} as const;

function PanelPlaceholder({
  title,
  onClose,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
}) {
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
          <PanelLeft />
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

function AppShellInner() {
  const {
    layout,
    toggleLeft,
    toggleRight,
    resizeLeftBy,
    resizeRightBy,
    reportContainerWidth,
    leftDragMax,
    rightDragMax,
    forceOpenPanels,
  } = usePanelLayout();
  const { registerOpenRight, openFileTab, openRightPanel, ensureMapTab } =
    usePanelTabsContext();
  const rowRef = useRef<HTMLDivElement>(null);
  const [fileDragging, setFileDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const openFilesRef = useRef<(files: File[]) => void>(() => {});
  const openPathsRef = useRef<(paths: string[]) => void>(() => {});

  const openRight = useCallback(() => {
    void forceOpenPanels({ rightOpen: true });
  }, [forceOpenPanels]);

  // Bind during render so AgentChat effects can open the panel on first paint.
  registerOpenRight(openRight);

  const pushGisLayers = useCallback(
    async (
      layers: Array<{ name: string; geojson: import("@/lib/gis-files").GeoJsonFeatureCollection }>,
    ) => {
      if (layers.length === 0) return;
      await forceOpenPanels({ rightOpen: true });
      const tabId = ensureMapTab();
      if (!tabId) return;
      for (const layer of layers) {
        const id = `lyr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await dispatchToMapWebview(tabId, {
          type: "addLayer",
          id,
          name: layer.name,
          geojson: layer.geojson,
        });
      }
    },
    [ensureMapTab, forceOpenPanels],
  );

  const openDroppedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setDropError(null);
      const { gis, other } = partitionDropFiles(files);
      if (other.length > 0) {
        openRightPanel();
        for (const file of other) {
          openFileTab(file);
        }
      }
      if (gis.length > 0) {
        void (async () => {
          try {
            const layers = [];
            for (const file of gis) {
              layers.push(await parseGisFile(file));
            }
            await pushGisLayers(layers);
          } catch (err) {
            console.error(err);
            setDropError(
              err instanceof Error ? err.message : UI_COPY.gisDropFailed,
            );
          }
        })();
      }
    },
    [openFileTab, openRightPanel, pushGisLayers],
  );
  openFilesRef.current = openDroppedFiles;

  const openDroppedPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      setDropError(null);
      const { gis, other } = partitionDropPaths(paths);
      if (other.length > 0) {
        void filesFromPaths(other)
          .then((files) => {
            if (files.length === 0) {
              setDropError(UI_COPY.fileDropFailed);
              return;
            }
            openRightPanel();
            for (const file of files) openFileTab(file);
          })
          .catch((err) => {
            console.error(err);
            setDropError(UI_COPY.fileDropFailed);
          });
      }
      if (gis.length > 0) {
        void parseGisPaths(gis)
          .then((layers) => pushGisLayers(layers))
          .catch((err) => {
            console.error(err);
            setDropError(
              err instanceof Error ? err.message : UI_COPY.gisDropFailed,
            );
          });
      }
    },
    [openFileTab, openRightPanel, pushGisLayers],
  );
  openPathsRef.current = openDroppedPaths;

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

  useEffect(() => {
    if (!dropError) return;
    const timer = window.setTimeout(() => setDropError(null), 3200);
    return () => window.clearTimeout(timer);
  }, [dropError]);

  // Tauri emits drag-drop per webview. Main + window + child (map/browser) all
  // funnel through the file-drop bus so drops on overlay webviews still work.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const unregister = registerFileDropHandlers({
      onPhase: (phase) => {
        setFileDragging(phase === "enter" || phase === "over");
      },
      onDropPaths: (paths) => {
        setFileDragging(false);
        openPathsRef.current(paths);
      },
    });

    const attach = async (
      label: string,
      subscribe: () => Promise<() => void>,
    ) => {
      try {
        const unlisten = await subscribe();
        if (cancelled) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      } catch (err) {
        console.error(`listen ${label} drag-drop failed`, err);
      }
    };

    void attach("webview", async () =>
      getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          notifyFileDropPhase(payload.type);
          return;
        }
        if (payload.type === "leave") {
          notifyFileDropPhase("leave");
          return;
        }
        if (payload.type === "drop") {
          notifyFileDropPaths(payload.paths);
        }
      }),
    );

    void attach("window", async () =>
      getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          notifyFileDropPhase(payload.type);
          return;
        }
        if (payload.type === "leave") {
          notifyFileDropPhase("leave");
          return;
        }
        if (payload.type === "drop") {
          notifyFileDropPaths(payload.paths);
        }
      }),
    );

    return () => {
      cancelled = true;
      unregister();
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  function hasFilePayload(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  // Keep HTML5 handlers even in Tauri — some builds still deliver File objects.
  function handleDragEnter(event: DragEvent) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    setFileDragging(true);
  }

  function handleDragLeave(event: DragEvent) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    // Only clear when leaving the shell root.
    if (event.currentTarget === event.target) {
      setFileDragging(false);
    }
  }

  function handleDragOver(event: DragEvent) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent) {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    setFileDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    markFileDropHandled();
    openDroppedFiles(files);
  }

  return (
    <div
      ref={rowRef}
      className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {layout.leftOpen ? (
        <>
          <aside
            className="panel-side panel-side-left flex min-h-0 shrink flex-col border-r border-border/70 bg-sidebar/40"
            style={{
              width: layout.leftWidth,
              flex: "0 1 auto",
              minWidth: 0,
              maxWidth: PANEL_LIMITS.leftMax,
            }}
          >
            <PanelPlaceholder
              title={COPY.leftTitle}
              onClose={toggleLeft}
              closeLabel={COPY.toggleLeft}
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
        className="panel-center relative min-h-0 min-w-0 flex-1"
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
            aria-label={UI_COPY.toggleRight}
            title={UI_COPY.toggleRight}
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
            className="panel-side panel-side-right flex min-h-0 shrink flex-col border-l border-border/70 bg-sidebar/40"
            style={{
              width: layout.rightWidth,
              flex: "0 1 auto",
              minWidth: 0,
              maxWidth: rightDragMax,
            }}
          >
            <RightPanel onClose={toggleRight} />
          </aside>
        </>
      ) : null}

      {fileDragging ? (
        <div className="pointer-events-none absolute inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
          <div className="rounded-xl border border-dashed border-foreground/25 bg-card/90 px-6 py-4 text-sm text-foreground shadow-sm">
            {UI_COPY.fileDropHint}
          </div>
        </div>
      ) : null}

      {dropError ? (
        <div className="pointer-events-none absolute right-3 bottom-3 z-[201] rounded-md bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-white shadow-sm">
          {dropError}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  return (
    <PanelTabsProvider>
      <AppShellInner />
    </PanelTabsProvider>
  );
}
