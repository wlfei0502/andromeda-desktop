import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";

type LocalTerminalProps = {
  sessionId: string;
  className?: string;
  active?: boolean;
};

export function LocalTerminal({
  sessionId,
  className,
  active = true,
}: LocalTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: "#f4f4f5",
        foreground: "#18181b",
        cursor: "#18181b",
        selectionBackground: "#d4d4d8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;

    const fitAndResize = () => {
      if (disposed || !host.isConnected) return;
      try {
        fit.fit();
        void invoke("terminal_resize", {
          id: sessionId,
          cols: Math.max(term.cols, 2),
          rows: Math.max(term.rows, 2),
        }).catch(() => {});
      } catch {
        /* host may be hidden */
      }
    };

    requestAnimationFrame(() => {
      fitAndResize();
      void invoke("terminal_create", {
        id: sessionId,
        cols: Math.max(term.cols, 80),
        rows: Math.max(term.rows, 24),
      }).catch((err) => {
        if (!disposed) {
          term.writeln(`\r\n[terminal error] ${String(err)}`);
        }
      });
    });

    const dataDisp = term.onData((data) => {
      void invoke("terminal_write", { id: sessionId, data }).catch(() => {});
    });

    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    void listen<{ id: string; data: string }>("terminal://data", (event) => {
      if (event.payload.id !== sessionId) return;
      term.write(event.payload.data);
    }).then((fn) => {
      if (disposed) fn();
      else unlistenData = fn;
    });

    void listen<{ id: string }>("terminal://exit", (event) => {
      if (event.payload.id !== sessionId) return;
      term.writeln("\r\n[process exited]");
    }).then((fn) => {
      if (disposed) fn();
      else unlistenExit = fn;
    });

    const observer = new ResizeObserver(() => fitAndResize());
    observer.observe(host);
    window.addEventListener("resize", fitAndResize);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", fitAndResize);
      dataDisp.dispose();
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    const id = window.requestAnimationFrame(() => {
      try {
        fit.fit();
        void invoke("terminal_resize", {
          id: sessionId,
          cols: Math.max(term.cols, 2),
          rows: Math.max(term.rows, 2),
        }).catch(() => {});
        term.focus();
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [active, sessionId]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f4f4f5]",
        className,
      )}
    >
      <div
        ref={hostRef}
        className="local-terminal-host min-h-0 w-full flex-1 overflow-hidden p-2"
      />
    </div>
  );
}

export async function closeTerminalSession(sessionId: string) {
  await invoke("terminal_close", { id: sessionId });
}
