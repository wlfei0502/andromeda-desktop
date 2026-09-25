import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const BROWSER_MORE_MENU_LABEL = "browser-more-menu";
export const BROWSER_MORE_MENU_EVENT = "andromeda://browser-more-menu";
export const BROWSER_MORE_MENU_DISMISS_EVENT =
  "andromeda://browser-more-menu-dismiss";

export type BrowserMoreAction =
  | "screenshot"
  | "hardReload"
  | "copyUrl"
  | "bookmarkBar"
  | "clearHistory"
  | "clearCookies"
  | "clearCache";

export type BrowserMorePayload = {
  action: BrowserMoreAction;
  value?: boolean;
};

const MENU_WIDTH = 228;
const MENU_HEIGHT = 268;

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function buildMenuUrl(options: {
  hasPage: boolean;
  hasUrl: boolean;
  bookmarkBar: boolean;
}) {
  const url = new URL("browser-more-menu.html", window.location.href);
  url.search = "";
  url.hash = "";
  if (options.hasPage) url.searchParams.set("hasPage", "1");
  if (options.hasUrl) url.searchParams.set("hasUrl", "1");
  if (options.bookmarkBar) url.searchParams.set("bookmarkBar", "1");
  return url.toString();
}

export async function hideBrowserMoreMenu() {
  if (!isTauriRuntime()) return;
  const popup = await WebviewWindow.getByLabel(BROWSER_MORE_MENU_LABEL);
  await popup?.close().catch(() => {});
}

export async function openBrowserMoreMenu(options: {
  left: number;
  top: number;
  hasPage: boolean;
  hasUrl: boolean;
  bookmarkBar: boolean;
}) {
  if (!isTauriRuntime()) return;

  await hideBrowserMoreMenu();

  const win = getCurrentWindow();
  const factor = await win.scaleFactor();
  const innerPos = await win.innerPosition();
  const innerSize = await win.innerSize();
  const originX = innerPos.x / factor;
  const originY = innerPos.y / factor;
  const logicalW = innerSize.width / factor;
  const logicalH = innerSize.height / factor;

  let x = originX + options.left;
  let y = originY + options.top;
  const maxX = originX + logicalW - MENU_WIDTH - 8;
  const maxY = originY + logicalH - MENU_HEIGHT - 8;
  if (x > maxX) x = Math.max(originX + 8, maxX);
  if (y > maxY) y = Math.max(originY + 8, maxY);

  const popup = new WebviewWindow(BROWSER_MORE_MENU_LABEL, {
    url: buildMenuUrl(options),
    title: "",
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
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
      () => reject(new Error("browser more menu timeout")),
      10000,
    );
    popup.once("tauri://created", () => {
      window.clearTimeout(timer);
      resolve();
    });
    popup.once("tauri://error", (event) => {
      window.clearTimeout(timer);
      reject(event.payload ?? "browser more menu failed");
    });
  });
}

export async function listenBrowserMoreAction(
  handler: (payload: BrowserMorePayload) => void,
): Promise<UnlistenFn> {
  return listen<BrowserMorePayload>(BROWSER_MORE_MENU_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function listenBrowserMoreDismiss(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(BROWSER_MORE_MENU_DISMISS_EVENT, () => {
    handler();
  });
}

export { isTauriRuntime, MENU_WIDTH, MENU_HEIGHT };
