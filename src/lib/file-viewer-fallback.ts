import { DEFAULT_SUPPORTED_EXTENSIONS } from "@file-viewer/core";

export type ViewerSourcePlan =
  | { kind: "native"; viewerName: string }
  | { kind: "text-fallback"; viewerName: string }
  | { kind: "unsupported"; extension: string };

const SUPPORTED = new Set(
  DEFAULT_SUPPORTED_EXTENSIONS.map((ext) =>
    ext.replace(/^\./, "").toLowerCase(),
  ),
);

const TEXT_BASENAMES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".editorconfig",
  ".env",
  ".npmrc",
  ".nvmrc",
  ".yarnrc",
  ".prettierignore",
  ".eslintignore",
  ".dockerignore",
  ".htaccess",
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  "procfile",
  "license",
  "copying",
  "authors",
  "changelog",
]);

export function getFileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename;
  const match = /\.([^.]+)$/.exec(base);
  return match ? match[1].toLowerCase() : "";
}

function baseName(filename: string): string {
  return (filename.split(/[/\\]/).pop() || filename).toLowerCase();
}

function isKnownTextName(filename: string): boolean {
  const base = baseName(filename);
  if (TEXT_BASENAMES.has(base)) return true;
  if (base.startsWith(".env.")) return true;
  // Dotfiles without a second extension are usually plain config text.
  if (base.startsWith(".") && !base.slice(1).includes(".")) return true;
  return false;
}

async function looksLikeText(file: Blob, sampleBytes = 8192): Promise<boolean> {
  const buffer = new Uint8Array(await file.slice(0, sampleBytes).arrayBuffer());
  if (buffer.length === 0) return true;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    let printable = 0;
    for (const byte of buffer) {
      if (
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0d ||
        (byte >= 0x20 && byte <= 0x7e) ||
        byte >= 0x80
      ) {
        printable += 1;
      }
    }
    return printable / buffer.length >= 0.85;
  }
}

function asTextViewerName(filename: string): string {
  const lower = filename.toLowerCase();
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".log") ||
    lower.endsWith(".md")
  ) {
    return filename;
  }
  return `${filename}.txt`;
}

/** Decide how to preview a file when the native extension is missing from the matrix. */
export async function planViewerSource(
  file: Blob,
  filename: string,
): Promise<ViewerSourcePlan> {
  const extension = getFileExtension(filename);

  if (extension && SUPPORTED.has(extension)) {
    return { kind: "native", viewerName: filename };
  }

  if (isKnownTextName(filename) || (await looksLikeText(file))) {
    return { kind: "text-fallback", viewerName: asTextViewerName(filename) };
  }

  return {
    kind: "unsupported",
    extension: extension ? `.${extension}` : filename || "unknown",
  };
}
