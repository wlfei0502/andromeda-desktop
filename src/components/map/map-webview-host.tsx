import { useEffect, useRef } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { attachWebviewFileDrop } from "@/lib/attach-webview-file-drop";
import { mapWebviewLabel } from "@/lib/map-bridge";
import { cn } from "@/lib/utils";

const DEFAULT_MAP_URL = "http://127.0.0.1:5174/";

type HostBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function measureHostBounds(host: HTMLElement, factor: number): HostBounds {
  const rect = host.getBoundingClientRect();
  return {
    x: Math.round(rect.left * factor),
    y: Math.round(rect.top * factor),
    width: Math.max(1, Math.round(rect.width * factor)),
    height: Math.max(1, Math.round(rect.height * factor)),
  };
}

function boundsKey(b: HostBounds) {
  return `${b.x},${b.y},${b.width},${b.height}`;
}

type MapWebviewHostProps = {
  tabId: string;
  active: boolean;
  url?: string;
  className?: string;
};

export function MapWebviewHost({
  tabId,
  active,
  url = DEFAULT_MAP_URL,
  className,
}: MapWebviewHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const label = mapWebviewLabel(tabId);
  const webviewRef = useRef<Webview | null>(null);
  const creatingRef = useRef(false);
  const activeRef = useRef(active);
  const lastBoundsKeyRef = useRef("");
  const scaleFactorRef = useRef(1);
  const syncingRef = useRef(false);
  const unDropRef = useRef<(() => void) | null>(null);
  activeRef.current = active;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    const win = getCurrentWindow();

    const refreshScale = async () => {
      scaleFactorRef.current = await win.scaleFactor();
    };

    const applyBounds = async (webview: Webview, force = false) => {
      const bounds = measureHostBounds(host, scaleFactorRef.current);
      const key = boundsKey(bounds);
      if (!force && key === lastBoundsKeyRef.current) return;
      if (syncingRef.current) return;
      syncingRef.current = true;
      lastBoundsKeyRef.current = key;
      try {
        await webview.setPosition(new PhysicalPosition(bounds.x, bounds.y));
        await webview.setSize(new PhysicalSize(bounds.width, bounds.height));
      } finally {
        syncingRef.current = false;
      }
    };

    const applyVisibility = async (webview: Webview) => {
      if (activeRef.current) {
        await applyBounds(webview, true);
        await webview.show();
      } else {
        await webview.hide();
      }
    };

    const ensureWebview = async () => {
      await refreshScale();
      if (cancelled) return;

      let webview = await Webview.getByLabel(label);
      if (!webview && !creatingRef.current) {
        creatingRef.current = true;
        try {
          const factor = scaleFactorRef.current;
          const bounds = measureHostBounds(host, factor);
          webview = new Webview(win, label, {
            url,
            x: Math.round(bounds.x / factor),
            y: Math.round(bounds.y / factor),
            width: Math.max(1, Math.round(bounds.width / factor)),
            height: Math.max(1, Math.round(bounds.height / factor)),
            focus: false,
            dragDropEnabled: true,
          });
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(
              () => reject(new Error("create webview timeout")),
              10000,
            );
            webview!.once("tauri://created", () => {
              window.clearTimeout(timer);
              resolve();
            });
            webview!.once("tauri://error", (event) => {
              window.clearTimeout(timer);
              reject(event.payload ?? "create webview failed");
            });
          });
        } finally {
          creatingRef.current = false;
        }
      }
      if (cancelled || !webview) return;
      webviewRef.current = webview;
      lastBoundsKeyRef.current = "";
      try {
        unDropRef.current?.();
        const unDrop = await attachWebviewFileDrop(webview);
        if (cancelled) {
          unDrop();
        } else {
          unDropRef.current = unDrop;
        }
      } catch (err) {
        console.error("map webview drag-drop listen failed", err);
      }
      await applyVisibility(webview);
      requestAnimationFrame(() => {
        if (cancelled || !webviewRef.current || !activeRef.current) return;
        void applyBounds(webviewRef.current, true).catch(() => {});
      });
    };

    void ensureWebview().catch((err) => {
      console.error("map webview failed", err);
    });

    let raf = 0;
    const tick = () => {
      const webview = webviewRef.current;
      if (webview && activeRef.current) {
        void applyBounds(webview).catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onWindowChange = () => {
      void refreshScale().then(() => {
        const webview = webviewRef.current;
        if (!webview || !activeRef.current) return;
        lastBoundsKeyRef.current = "";
        void applyBounds(webview, true).catch(() => {});
      });
    };
    window.addEventListener("resize", onWindowChange);
    const unSubResize = win.onResized(() => onWindowChange());
    const unSubScale = win.onScaleChanged(() => onWindowChange());

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onWindowChange);
      void unSubResize.then((un) => un()).catch(() => {});
      void unSubScale.then((un) => un()).catch(() => {});
      unDropRef.current?.();
      unDropRef.current = null;
    };
  }, [label, url]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    void (async () => {
      if (active) {
        const host = hostRef.current;
        if (host) {
          scaleFactorRef.current = await getCurrentWindow().scaleFactor();
          lastBoundsKeyRef.current = "";
          const bounds = measureHostBounds(host, scaleFactorRef.current);
          lastBoundsKeyRef.current = boundsKey(bounds);
          await webview.setPosition(new PhysicalPosition(bounds.x, bounds.y));
          await webview.setSize(
            new PhysicalSize(bounds.width, bounds.height),
          );
        }
        await webview.show();
      } else {
        await webview.hide();
      }
    })().catch(() => {});
  }, [active]);

  useEffect(() => {
    return () => {
      unDropRef.current?.();
      unDropRef.current = null;
      void Webview.getByLabel(label)
        .then((webview) => webview?.close())
        .catch(() => {});
      webviewRef.current = null;
    };
  }, [label]);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 h-full min-h-0 w-full bg-muted/30", className)}
      aria-label="map-browser-host"
    />
  );
}

export async function closeMapWebview(tabId: string) {
  const label = mapWebviewLabel(tabId);
  const webview = await Webview.getByLabel(label);
  await webview?.close();
}
