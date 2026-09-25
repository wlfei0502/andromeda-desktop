const STORAGE_KEY = "andromeda.browser.recents.v1";
const MAX_RECENTS = 20;

export type BrowserRecent = {
  url: string;
  title?: string;
  visitedAt: number;
};

function readRaw(): BrowserRecent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BrowserRecent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.url === "string");
  } catch {
    return [];
  }
}

export function loadBrowserRecents(): BrowserRecent[] {
  return readRaw().sort((a, b) => b.visitedAt - a.visitedAt);
}

export function pushBrowserRecent(url: string, title?: string): BrowserRecent[] {
  const now = Date.now();
  const next = [
    { url, title, visitedAt: now },
    ...readRaw().filter((item) => item.url !== url),
  ].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function clearBrowserRecents(): BrowserRecent[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

/** Turn address-bar input into a navigable URL, or null if empty. */
export function normalizeBrowserInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;

  const looksLikeHost =
    /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(text) ||
    /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(text);

  if (looksLikeHost) return `https://${text}`;

  return `https://www.baidu.com/s?wd=${encodeURIComponent(text)}`;
}
