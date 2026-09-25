import { BaseDirectory, exists, writeFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "@/lib/panel-add-menu";

function triggerBrowserDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

async function uniqueDownloadName(filename: string): Promise<string> {
  if (!(await exists(filename, { baseDir: BaseDirectory.Download }))) {
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 1; i < 200; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate, { baseDir: BaseDirectory.Download }))) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}${ext}`;
}

/** Save the already-loaded file without relying on WebView download / popup APIs. */
export async function saveViewerFile(
  file: File | Blob,
  filename: string,
): Promise<"browser" | "download-folder"> {
  if (isTauriRuntime()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const target = await uniqueDownloadName(filename || "download");
    await writeFile(target, bytes, { baseDir: BaseDirectory.Download });
    return "download-folder";
  }
  triggerBrowserDownload(file, filename || "download");
  return "browser";
}

/**
 * Acquire a print target during the user-gesture turn.
 * WebView2 often blocks `window.open`; a hidden iframe stays in-process and works.
 */
export function acquirePrintWindow(): {
  printWindow: Window;
  dispose: () => void;
} {
  const popup = window.open("", "_blank");
  if (popup) {
    return {
      printWindow: popup,
      dispose: () => {
        /* library owns popup lifecycle */
      },
    };
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  if (!printWindow) {
    iframe.remove();
    throw new Error("print frame unavailable");
  }

  printWindow.document.open();
  printWindow.document.write(
    "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
  );
  printWindow.document.close();

  return {
    printWindow,
    dispose: () => {
      window.setTimeout(() => iframe.remove(), 2500);
    },
  };
}
