const STORAGE_KEY = "andromeda.browser.bookmarks.v1";
const MAX_BOOKMARKS = 50;

export type BrowserBookmark = {
  url: string;
  title?: string;
  savedAt: number;
};

function readRaw(): BrowserBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BrowserBookmark[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.url === "string");
  } catch {
    return [];
  }
}

function writeRaw(items: BrowserBookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota */
  }
}

export function loadBrowserBookmarks(): BrowserBookmark[] {
  return readRaw().sort((a, b) => b.savedAt - a.savedAt);
}

export function isBrowserBookmarked(url: string): boolean {
  return readRaw().some((item) => item.url === url);
}

export function toggleBrowserBookmark(
  url: string,
  title?: string,
): BrowserBookmark[] {
  const existing = readRaw();
  const found = existing.some((item) => item.url === url);
  const next = found
    ? existing.filter((item) => item.url !== url)
    : [{ url, title, savedAt: Date.now() }, ...existing].slice(0, MAX_BOOKMARKS);
  writeRaw(next);
  return next.sort((a, b) => b.savedAt - a.savedAt);
}
