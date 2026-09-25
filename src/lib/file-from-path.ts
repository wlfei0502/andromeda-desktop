import { readFile, stat } from "@tauri-apps/plugin-fs";

function fileNameFromPath(path: string) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "file";
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

/** Load a dropped OS path into a browser File for the flyfish viewer. */
export async function fileFromPath(path: string): Promise<File> {
  const info = await stat(path);
  if (info.isDirectory) {
    throw new Error(`skipped directory: ${path}`);
  }
  const bytes = await readFile(path);
  const name = fileNameFromPath(path);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: guessMime(name) });
}

export async function filesFromPaths(paths: string[]): Promise<File[]> {
  const files: File[] = [];
  const errors: string[] = [];
  for (const path of paths) {
    try {
      files.push(await fileFromPath(path));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${path}: ${message}`);
      console.error("failed to read dropped file", path, err);
    }
  }
  if (files.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return files;
}
