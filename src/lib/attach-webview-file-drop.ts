import type { Webview } from "@tauri-apps/api/webview";
import {
  notifyFileDropPaths,
  notifyFileDropPhase,
} from "@/lib/file-drop-bus";

/** Forward OS file drops from a child WebView into the app drop bus. */
export async function attachWebviewFileDrop(
  webview: Webview,
): Promise<() => void> {
  return webview.onDragDropEvent((event) => {
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
  });
}
