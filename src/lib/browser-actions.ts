import { invoke } from "@tauri-apps/api/core";
import { browserWebviewLabel } from "@/components/browser/browser-webview-host";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function browserClearCookies(tabId: string) {
  if (!isTauriRuntime()) return;
  await invoke("browser_clear_data", {
    label: browserWebviewLabel(tabId),
    kind: "cookies",
  });
}

export async function browserClearCache(tabId: string) {
  if (!isTauriRuntime()) return;
  await invoke("browser_clear_data", {
    label: browserWebviewLabel(tabId),
    kind: "cache",
  });
}

/** Bypass HTTP cache and reload the current page (Ctrl+Shift+R style). */
export async function browserHardReload(tabId: string) {
  if (!isTauriRuntime()) return;
  await invoke("browser_hard_reload", {
    label: browserWebviewLabel(tabId),
  });
}

/** Capture page and copy image to the OS clipboard (handled in Rust). */
export async function browserTakeScreenshot(tabId: string) {
  if (!isTauriRuntime()) {
    throw new Error("screenshot requires Tauri");
  }
  await invoke("browser_screenshot", {
    label: browserWebviewLabel(tabId),
  });
}
