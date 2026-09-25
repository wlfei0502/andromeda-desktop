import {
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Grow the native window's inner width so the panel row can fit `minWidth`.
 * No-op in browser / when maximized / when already wide enough.
 * Returns the width applied (or current width), useful for optimistic layout.
 */
export async function ensureWindowMinWidth(minWidth: number): Promise<number | null> {
  if (!isTauriRuntime() || minWidth <= 0) return null;

  try {
    const win = getCurrentWindow();
    if (await win.isMaximized()) return null;

    const factor = await win.scaleFactor();
    const inner = await win.innerSize();
    const logical = inner.toLogical(factor);
    if (logical.width >= minWidth - 0.5) return logical.width;

    let target = minWidth;
    const monitor = await currentMonitor();
    if (monitor) {
      const work = monitor.workArea.size.toLogical(monitor.scaleFactor);
      target = Math.min(target, work.width);
    }

    if (target <= logical.width + 0.5) return logical.width;

    await win.setSize(new LogicalSize(target, logical.height));
    return target;
  } catch {
    return null;
  }
}

/**
 * Lock the OS window resize floor so the middle chat region cannot be
 * dragged narrower than `minWidth` via the window edges.
 */
export async function syncWindowMinWidth(minWidth: number): Promise<void> {
  if (!isTauriRuntime() || minWidth <= 0) return;
  try {
    const win = getCurrentWindow();
    let maxWidth: number | undefined;
    const monitor = await currentMonitor();
    if (monitor) {
      maxWidth = Math.floor(
        monitor.workArea.size.toLogical(monitor.scaleFactor).width,
      );
    }
    await win.setSizeConstraints({
      minWidth,
      ...(maxWidth != null ? { maxWidth } : {}),
    });

    // If a previous bug grew the window past the work area, pull it back.
    if (maxWidth != null) {
      const factor = await win.scaleFactor();
      const logical = (await win.innerSize()).toLogical(factor);
      if (logical.width > maxWidth + 0.5 && !(await win.isMaximized())) {
        await win.setSize(new LogicalSize(maxWidth, logical.height));
      }
    }
  } catch {
    /* browser / missing permission */
  }
}
