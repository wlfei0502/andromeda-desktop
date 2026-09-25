import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  Printer,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import FileViewer, {
  type FileViewerHandle,
  type ViewerState,
} from "@file-viewer/react";
import allPreset from "@file-viewer/preset-all";
import { UI_COPY } from "@/components/chat/ui-copy";
import { Button } from "@/components/ui/button";
import {
  acquirePrintWindow,
  saveViewerFile,
} from "@/lib/file-viewer-actions";
import {
  planViewerSource,
  type ViewerSourcePlan,
} from "@/lib/file-viewer-fallback";
import { cn } from "@/lib/utils";

const VIEWER_OPTIONS = {
  preset: allPreset,
  rendererMode: "replace" as const,
  theme: "light" as const,
  styleIsolation: "shadow" as const,
  // Built-in floating toolbar is clipped by panel overflow; use our bottom bar.
  toolbar: false as const,
};

const INITIAL_VIEWER_STATE: ViewerState = {
  loading: false,
  ready: false,
  error: null,
  lastEvent: null,
  lifecycle: null,
  availability: null,
  search: null,
  zoom: null,
  location: null,
  viewState: null,
};

type FilePanelProps = {
  tabId: string;
  active: boolean;
  file: File | Blob | null;
  name: string | null;
  onOpenFile: (file: File) => void;
};

type FileViewerPaneProps = {
  file: File | Blob;
  name: string;
};

function UnsupportedFallback({
  file,
  name,
  extension,
  onHint,
}: {
  file: File | Blob;
  name: string;
  extension: string;
  onHint: (message: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-background px-6">
      <div className="max-w-[18rem] space-y-2 text-center">
        <p className="text-sm font-medium text-foreground">
          {UI_COPY.fileUnsupportedTitle}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {extension} · {UI_COPY.fileUnsupportedHint}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void saveViewerFile(file, name)
            .then((where) => {
              onHint(
                where === "download-folder"
                  ? UI_COPY.fileDownloadSaved
                  : UI_COPY.fileDownload,
              );
            })
            .catch((err) => {
              console.error("file download failed", err);
              onHint(UI_COPY.fileDownloadFailed);
            });
        }}
      >
        <Download className="size-3.5" aria-hidden />
        {UI_COPY.fileDownload}
      </Button>
    </div>
  );
}

function FileViewerPane({ file, name }: FileViewerPaneProps) {
  const viewerRef = useRef<FileViewerHandle>(null);
  const [state, setState] = useState<ViewerState>(INITIAL_VIEWER_STATE);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [plan, setPlan] = useState<ViewerSourcePlan | null>(null);

  const availability = state.availability;
  const zoom = state.zoom;
  const canZoom = availability?.zoom ?? false;
  const canZoomIn = zoom?.canZoomIn ?? availability?.zoomIn ?? false;
  const canZoomOut = zoom?.canZoomOut ?? availability?.zoomOut ?? false;
  const canPrint = availability?.print ?? state.ready;
  const zoomLabel =
    zoom?.label ?? (zoom ? `${Math.round(zoom.scale * 100)}%` : "—");
  const textFallback = plan?.kind === "text-fallback";

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setState(INITIAL_VIEWER_STATE);
    void planViewerSource(file, name).then((next) => {
      if (!cancelled) setPlan(next);
    });
    return () => {
      cancelled = true;
    };
  }, [file, name]);

  useEffect(() => {
    if (!actionHint) return;
    const timer = window.setTimeout(() => setActionHint(null), 2800);
    return () => window.clearTimeout(timer);
  }, [actionHint]);

  const runZoom = useCallback((action: () => void | Promise<unknown>) => {
    void Promise.resolve(action()).catch((err) => {
      console.error("file viewer zoom failed", err);
    });
  }, []);

  const handleDownload = useCallback(() => {
    void saveViewerFile(file, name)
      .then((where) => {
        setActionHint(
          where === "download-folder"
            ? UI_COPY.fileDownloadSaved
            : UI_COPY.fileDownload,
        );
      })
      .catch((err) => {
        console.error("file download failed", err);
        setActionHint(UI_COPY.fileDownloadFailed);
      });
  }, [file, name]);

  const handlePrint = useCallback(() => {
    let dispose = () => {};
    try {
      // Must open during the click gesture; async open is blocked by WebView2.
      const target = acquirePrintWindow();
      dispose = target.dispose;
      void viewerRef.current
        ?.printRenderedHtml({ printWindow: target.printWindow })
        .catch((err) => {
          console.error("file print failed", err);
          setActionHint(UI_COPY.filePrintFailed);
        })
        .finally(() => {
          dispose();
        });
    } catch (err) {
      console.error("file print failed", err);
      setActionHint(UI_COPY.filePrintFailed);
      dispose();
    }
  }, []);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#f4f4f5]">
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        {plan == null ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            …
          </div>
        ) : plan.kind === "unsupported" ? (
          <UnsupportedFallback
            file={file}
            name={name}
            extension={plan.extension}
            onHint={setActionHint}
          />
        ) : (
          <FileViewer
            ref={viewerRef}
            className="file-viewer-host h-full w-full"
            file={file}
            name={plan.viewerName}
            options={VIEWER_OPTIONS}
            onStateChange={setState}
          />
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center gap-0.5 border-t border-border/50 bg-[#f4f4f5] px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={UI_COPY.fileZoomOut}
          title={UI_COPY.fileZoomOut}
          disabled={!canZoom || !canZoomOut}
          onClick={() => runZoom(() => viewerRef.current?.zoomOut())}
          className="text-muted-foreground"
        >
          <ZoomOut />
        </Button>
        <button
          type="button"
          title={UI_COPY.fileZoomReset}
          disabled={!canZoom || !(zoom?.canReset ?? availability?.zoomReset)}
          onClick={() => runZoom(() => viewerRef.current?.resetZoom())}
          className={cn(
            "min-w-[2.75rem] rounded-md px-1.5 py-1 text-center text-[11px] tabular-nums text-muted-foreground transition-colors",
            canZoom
              ? "cursor-pointer hover:bg-muted hover:text-foreground"
              : "cursor-default opacity-50",
          )}
        >
          {zoomLabel}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={UI_COPY.fileZoomIn}
          title={UI_COPY.fileZoomIn}
          disabled={!canZoom || !canZoomIn}
          onClick={() => runZoom(() => viewerRef.current?.zoomIn())}
          className="text-muted-foreground"
        >
          <ZoomIn />
        </Button>

        <div className="mx-1 h-4 w-px bg-border/70" aria-hidden />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={UI_COPY.fileDownload}
          title={UI_COPY.fileDownload}
          onClick={handleDownload}
          className="text-muted-foreground"
        >
          <Download />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={UI_COPY.filePrint}
          title={UI_COPY.filePrint}
          disabled={!canPrint || plan?.kind === "unsupported"}
          onClick={handlePrint}
          className="text-muted-foreground"
        >
          <Printer />
        </Button>

        <span className="min-w-0 flex-1 truncate px-2 text-right text-[11px] text-muted-foreground/80">
          {textFallback ? (
            <span className="mr-1.5 text-muted-foreground/60">
              {UI_COPY.fileTextFallbackHint}
            </span>
          ) : null}
          {name}
        </span>
      </div>

      {actionHint ? (
        <div className="pointer-events-none absolute right-3 bottom-12 z-20 rounded-md bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-white shadow-sm">
          {actionHint}
        </div>
      ) : null}
    </div>
  );
}

export function FilePanel({
  active,
  file,
  name,
  onOpenFile,
}: FilePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!active) return null;

  if (!file || !name) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-background px-6">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) onOpenFile(next);
            event.target.value = "";
          }}
        />
        <p className="max-w-[16rem] text-center text-sm text-muted-foreground">
          {UI_COPY.fileEmptyHint}
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity",
            "hover:opacity-90",
          )}
        >
          <FolderOpen className="size-4" aria-hidden />
          {UI_COPY.fileOpen}
        </button>
      </div>
    );
  }

  return <FileViewerPane file={file} name={name} />;
}
