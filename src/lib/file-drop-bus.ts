/** Shared file-drop bridge: main shell + child WebViews (map/browser). */

export type FileDropPhase = "enter" | "over" | "leave" | "drop";

export type FileDropHandlers = {
  onPhase?: (phase: Exclude<FileDropPhase, "drop">) => void;
  onDropPaths?: (paths: string[]) => void;
};

let handlers: FileDropHandlers = {};
let lastDropAt = 0;

export function registerFileDropHandlers(next: FileDropHandlers) {
  handlers = next;
  return () => {
    if (handlers === next) handlers = {};
  };
}

export function notifyFileDropPhase(phase: Exclude<FileDropPhase, "drop">) {
  handlers.onPhase?.(phase);
}

export function notifyFileDropPaths(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const now = Date.now();
  // Dedupe: window + main webview + child webview may all fire.
  if (now - lastDropAt < 400) return;
  lastDropAt = now;
  handlers.onDropPaths?.(unique);
}

export function markFileDropHandled() {
  lastDropAt = Date.now();
}
