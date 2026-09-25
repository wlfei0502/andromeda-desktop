import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RightTabKind } from "@/hooks/use-right-tabs";

export const ADD_TAB_MENU_LABEL = "right-panel-add-menu";
export const ADD_TAB_MENU_SELECT_EVENT = "andromeda://right-panel-add-tab";
export const ADD_TAB_MENU_DISMISS_EVENT = "andromeda://right-panel-add-menu-dismiss";

export type AddTabMenuSelectPayload = {
  kind: RightTabKind;
};

const MENU_WIDTH = 176;
const MENU_ITEM_HEIGHT = 30;
const MENU_PADDING = 8;

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function menuHeight(hidePlan: boolean) {
  const count = hidePlan ? 4 : 5;
  return count * MENU_ITEM_HEIGHT + MENU_PADDING;
}

function buildMenuUrl(hidePlan: boolean) {
  const url = new URL("add-tab-menu.html", window.location.href);
  url.search = "";
  url.hash = "";
  if (hidePlan) url.searchParams.set("hidePlan", "1");
  return url.toString();
}

export async function hideAddTabMenuOverlay() {
  if (!isTauriRuntime()) return;
  const popup = await WebviewWindow.getByLabel(ADD_TAB_MENU_LABEL);
  await popup?.close().catch(() => {});
}

/** @deprecated use hideAddTabMenuOverlay */
export async function closeAddTabMenuOverlay() {
  await hideAddTabMenuOverlay();
}

/**
 * Owned opaque popup over the main window — does not hide map/browser webviews.
 * Uses a static HTML page so the menu paints immediately (no SPA boot flash).
 */
export async function openAddTabMenuOverlay(options: {
  left: number;
  top: number;
  hidePlan: boolean;
}) {
  if (!isTauriRuntime()) return;

  await hideAddTabMenuOverlay();

  const win = getCurrentWindow();
  const factor = await win.scaleFactor();
  const innerPos = await win.innerPosition();
  const innerSize = await win.innerSize();
  const originX = innerPos.x / factor;
  const originY = innerPos.y / factor;
  const logicalW = innerSize.width / factor;
  const logicalH = innerSize.height / factor;
  const height = menuHeight(options.hidePlan);

  let x = originX + options.left;
  let y = originY + options.top;
  const maxX = originX + logicalW - MENU_WIDTH - 8;
  const maxY = originY + logicalH - height - 8;
  if (x > maxX) x = Math.max(originX + 8, maxX);
  if (y > maxY) y = Math.max(originY + 8, maxY);

  const popup = new WebviewWindow(ADD_TAB_MENU_LABEL, {
    url: buildMenuUrl(options.hidePlan),
    title: "",
    width: MENU_WIDTH,
    height,
    x: Math.round(x),
    y: Math.round(y),
    resizable: false,
    maximizable: false,
    minimizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    focus: true,
    skipTaskbar: true,
    parent: win,
    visible: true,
    backgroundColor: [0, 0, 0, 0],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("add-tab menu popup timeout")),
      10000,
    );
    popup.once("tauri://created", () => {
      window.clearTimeout(timer);
      resolve();
    });
    popup.once("tauri://error", (event) => {
      window.clearTimeout(timer);
      reject(event.payload ?? "add-tab menu popup failed");
    });
  });
}

export async function emitAddTabMenuSelect(kind: RightTabKind) {
  await emit(ADD_TAB_MENU_SELECT_EVENT, { kind } satisfies AddTabMenuSelectPayload);
}

export async function emitAddTabMenuDismiss() {
  await emit(ADD_TAB_MENU_DISMISS_EVENT);
}

export async function listenAddTabMenuSelect(
  handler: (kind: RightTabKind) => void,
): Promise<UnlistenFn> {
  return listen<AddTabMenuSelectPayload>(ADD_TAB_MENU_SELECT_EVENT, (event) => {
    handler(event.payload.kind);
  });
}

export async function listenAddTabMenuDismiss(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(ADD_TAB_MENU_DISMISS_EVENT, () => {
    handler();
  });
}

export async function warmAddTabMenuOverlay() {
  /* static popup is created on demand */
}

export { isTauriRuntime };
