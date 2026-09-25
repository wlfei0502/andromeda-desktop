import { useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  Globe,
  RefreshCw,
  SquareArrowOutUpRight,
  Star,
  X,
} from "lucide-react";
import {
  isBrowserBookmarked,
  loadBrowserBookmarks,
  toggleBrowserBookmark,
  type BrowserBookmark,
} from "@/lib/browser-bookmarks";
import {
  browserClearCache,
  browserClearCookies,
  browserHardReload,
  browserTakeScreenshot,
} from "@/lib/browser-actions";
import {
  hideBrowserMoreMenu,
  isTauriRuntime as isTauriMenuRuntime,
  listenBrowserMoreAction,
  listenBrowserMoreDismiss,
  openBrowserMoreMenu,
  type BrowserMorePayload,
} from "@/lib/browser-more-menu";
import {
  clearBrowserRecents,
  loadBrowserRecents,
  normalizeBrowserInput,
  pushBrowserRecent,
  type BrowserRecent,
} from "@/lib/browser-recents";
import { UI_COPY } from "@/components/chat/ui-copy";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BrowserWebviewHost } from "./browser-webview-host";

const BOOKMARK_BAR_KEY = "andromeda.browser.bookmarkBar.v1";

type BrowserPanelProps = {
  tabId: string;
  active: boolean;
};

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function loadBookmarkBarVisible(): boolean {
  try {
    const raw = localStorage.getItem(BOOKMARK_BAR_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function saveBookmarkBarVisible(visible: boolean) {
  try {
    localStorage.setItem(BOOKMARK_BAR_KEY, visible ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function BrowserPanel({ tabId, active }: BrowserPanelProps) {
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const fallbackMenuRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [recents, setRecents] = useState<BrowserRecent[]>(() =>
    loadBrowserRecents(),
  );
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>(() =>
    loadBrowserBookmarks(),
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showBookmarkBar, setShowBookmarkBar] = useState(() =>
    loadBookmarkBarVisible(),
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const currentUrl = historyIndex >= 0 ? (history[historyIndex] ?? null) : null;
  const canBack = historyIndex > 0;
  const canForward = historyIndex >= 0 && historyIndex < history.length - 1;
  const actionUrl = currentUrl ?? normalizeBrowserInput(draft);
  const bookmarked = actionUrl ? isBrowserBookmarked(actionUrl) : false;

  const stateRef = useRef({
    tabId,
    currentUrl,
    actionUrl,
    showBookmarkBar,
    moreOpen,
  });
  stateRef.current = {
    tabId,
    currentUrl,
    actionUrl,
    showBookmarkBar,
    moreOpen,
  };

  function closeMoreMenu() {
    setMoreOpen(false);
    void hideBrowserMoreMenu().catch(() => {});
  }

  function handleMoreAction(payload: BrowserMorePayload) {
    const snap = stateRef.current;
    switch (payload.action) {
      case "screenshot":
        closeMoreMenu();
        if (snap.currentUrl) {
          // Let the more-menu popup finish closing before capture.
          window.setTimeout(() => {
            void browserTakeScreenshot(snap.tabId)
              .then(() => {
                setStatusMessage(UI_COPY.browserScreenshotCopied);
                window.setTimeout(() => setStatusMessage(null), 1800);
              })
              .catch((err) => {
                console.error("screenshot failed", err);
                setStatusMessage(UI_COPY.browserScreenshotFailed);
                window.setTimeout(() => setStatusMessage(null), 2200);
              });
          }, 120);
        }
        break;
      case "hardReload":
        closeMoreMenu();
        if (snap.currentUrl) {
          void browserHardReload(snap.tabId).catch((err) => {
            console.error("hard reload failed", err);
            // Fallback: remount child webview if CDP reload is unavailable.
            setReloadToken((n) => n + 1);
          });
        }
        break;
      case "copyUrl":
        if (snap.actionUrl) {
          void navigator.clipboard.writeText(snap.actionUrl).catch(() => {});
        }
        closeMoreMenu();
        break;
      case "bookmarkBar": {
        const next =
          typeof payload.value === "boolean"
            ? payload.value
            : !snap.showBookmarkBar;
        setShowBookmarkBar(next);
        saveBookmarkBarVisible(next);
        break;
      }
      case "clearHistory":
        setRecents(clearBrowserRecents());
        setHistory([]);
        setHistoryIndex(-1);
        setDraft("");
        closeMoreMenu();
        break;
      case "clearCookies":
        closeMoreMenu();
        if (snap.currentUrl) {
          void browserClearCookies(snap.tabId)
            .then(() => setReloadToken((n) => n + 1))
            .catch((err) => {
              console.error("clear cookies failed", err);
              setReloadToken((n) => n + 1);
            });
        }
        break;
      case "clearCache":
        closeMoreMenu();
        if (snap.currentUrl) {
          void browserClearCache(snap.tabId)
            .then(() => setReloadToken((n) => n + 1))
            .catch((err) => {
              console.error("clear cache failed", err);
              setReloadToken((n) => n + 1);
            });
        }
        break;
    }
  }

  const handleMoreActionRef = useRef(handleMoreAction);
  handleMoreActionRef.current = handleMoreAction;

  useEffect(() => {
    if (!active) return;
    setRecents(loadBrowserRecents());
    setBookmarks(loadBrowserBookmarks());
  }, [active]);

  useEffect(() => {
    if (!active && moreOpen) {
      setMoreOpen(false);
      void hideBrowserMoreMenu().catch(() => {});
    }
  }, [active, moreOpen]);

  useEffect(() => {
    let unAction: (() => void) | undefined;
    let unDismiss: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const offAction = await listenBrowserMoreAction((payload) => {
        handleMoreActionRef.current(payload);
      });
      const offDismiss = await listenBrowserMoreDismiss(() => {
        setMoreOpen(false);
        void hideBrowserMoreMenu().catch(() => {});
      });
      if (cancelled) {
        offAction();
        offDismiss();
        return;
      }
      unAction = offAction;
      unDismiss = offDismiss;
    })();

    return () => {
      cancelled = true;
      unAction?.();
      unDismiss?.();
      void hideBrowserMoreMenu().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!moreOpen || isTauriMenuRuntime()) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (fallbackMenuRef.current?.contains(target)) return;
      if (moreTriggerRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function navigateTo(raw: string) {
    const url = normalizeBrowserInput(raw);
    if (!url) return;
    setDraft(url);
    const base = historyIndex >= 0 ? history.slice(0, historyIndex + 1) : [];
    const next = [...base, url];
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setRecents(pushBrowserRecent(url));
  }

  function goBack() {
    if (!canBack) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setDraft(history[nextIndex] ?? "");
  }

  function goForward() {
    if (!canForward) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setDraft(history[nextIndex] ?? "");
  }

  function reload() {
    if (!currentUrl) return;
    setReloadToken((n) => n + 1);
  }

  function toggleBookmark() {
    if (!actionUrl) return;
    setBookmarks(toggleBrowserBookmark(actionUrl));
  }

  async function openExternal() {
    if (!actionUrl) return;
    try {
      if (isTauriRuntime()) {
        await openUrl(actionUrl);
      } else {
        window.open(actionUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("open external failed", err);
    }
  }

  async function toggleMoreMenu() {
    if (moreOpen) {
      closeMoreMenu();
      return;
    }
    const trigger = moreTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = rect.right - 228;
    const top = rect.bottom + 4;

    if (isTauriMenuRuntime()) {
      setMoreOpen(true);
      try {
        await openBrowserMoreMenu({
          left,
          top,
          hasPage: Boolean(currentUrl),
          hasUrl: Boolean(actionUrl),
          bookmarkBar: showBookmarkBar,
        });
      } catch (err) {
        console.error("open browser more menu failed", err);
        setMoreOpen(false);
      }
      return;
    }
    setMoreOpen(true);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#f4f4f5]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <ToolbarIconButton
          label={UI_COPY.browserBack}
          disabled={!canBack}
          onClick={goBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={UI_COPY.browserForward}
          disabled={!canForward}
          onClick={goForward}
        >
          <ArrowRight className="size-3.5" aria-hidden />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={UI_COPY.browserReload}
          disabled={!currentUrl}
          onClick={reload}
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </ToolbarIconButton>
        <ToolbarIconButton
          label={
            bookmarked
              ? UI_COPY.browserRemoveBookmark
              : UI_COPY.browserAddBookmark
          }
          disabled={!actionUrl}
          onClick={toggleBookmark}
          active={bookmarked}
          accent
        >
          <Star
            className={cn("size-3.5", bookmarked && "fill-current")}
            aria-hidden
          />
        </ToolbarIconButton>

        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigateTo(draft);
          }}
        >
          <div className="relative">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={UI_COPY.browserAddressPlaceholder}
              spellCheck={false}
              className={cn(
                "h-7 w-full rounded-full border-0 bg-[#e4e4e7] py-0 pr-7 pl-3 text-xs text-foreground outline-none",
                "placeholder:text-muted-foreground/70",
                "focus-visible:ring-1 focus-visible:ring-ring/40",
              )}
            />
            {draft.trim().length > 0 ? (
              <button
                type="button"
                aria-label={UI_COPY.browserClearAddress}
                title={UI_COPY.browserClearAddress}
                onClick={() => setDraft("")}
                className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2.25} aria-hidden />
              </button>
            ) : null}
          </div>
        </form>

        <div className="relative">
          <ToolbarIconButton
            ref={moreTriggerRef}
            label={UI_COPY.browserMore}
            active={moreOpen}
            onClick={() => {
              void toggleMoreMenu();
            }}
          >
            <Ellipsis className="size-3.5" aria-hidden />
          </ToolbarIconButton>

          {moreOpen && !isTauriMenuRuntime() ? (
            <div
              ref={fallbackMenuRef}
              role="menu"
              className="absolute top-[calc(100%+4px)] right-0 z-50 w-[228px] overflow-hidden rounded-[10px] border border-black/8 bg-white p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
            >
              <FallbackMenu
                hasPage={Boolean(currentUrl)}
                hasUrl={Boolean(actionUrl)}
                bookmarkBar={showBookmarkBar}
                onAction={handleMoreAction}
              />
            </div>
          ) : null}
        </div>

        <ToolbarIconButton
          label={UI_COPY.browserOpenExternal}
          disabled={!actionUrl}
          onClick={() => {
            void openExternal();
          }}
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden />
        </ToolbarIconButton>
      </div>

      {showBookmarkBar ? (
        <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 bg-[#ececee] px-2">
          {bookmarks.length === 0 ? (
            <span className="px-1 text-[11px] text-muted-foreground/70">
              {UI_COPY.browserBookmarksEmpty}
            </span>
          ) : (
            bookmarks.map((item) => (
              <button
                key={item.url}
                type="button"
                title={item.url}
                onClick={() => navigateTo(item.url)}
                className="inline-flex max-w-[160px] shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground"
              >
                <Globe className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{item.title || item.url}</span>
              </button>
            ))
          )}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {currentUrl ? (
          <BrowserWebviewHost
            key={`${currentUrl}::${reloadToken}`}
            tabId={tabId}
            url={currentUrl}
            active={active}
          />
        ) : (
          <div className="flex h-full justify-center overflow-y-auto px-6 py-12">
            <div className="flex w-full max-w-md flex-col gap-8">
              <LinkSection
                title={UI_COPY.browserRecents}
                empty={UI_COPY.browserRecentsEmpty}
                items={recents.map((item) => ({
                  key: `rc-${item.url}-${item.visitedAt}`,
                  url: item.url,
                }))}
                onOpen={navigateTo}
              />
            </div>
          </div>
        )}
      </div>
      {statusMessage ? (
        <div className="pointer-events-none absolute right-3 bottom-3 z-20 rounded-md bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-white shadow-sm">
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}

function FallbackMenu({
  hasPage,
  hasUrl,
  bookmarkBar,
  onAction,
}: {
  hasPage: boolean;
  hasUrl: boolean;
  bookmarkBar: boolean;
  onAction: (payload: BrowserMorePayload) => void;
}) {
  return (
    <>
      <FallbackItem
        label={UI_COPY.browserScreenshot}
        disabled={!hasPage}
        onClick={() => onAction({ action: "screenshot" })}
      />
      <div className="mx-1.5 my-1 h-px bg-black/8" role="separator" />
      <FallbackItem
        label={UI_COPY.browserHardReload}
        disabled={!hasPage}
        onClick={() => onAction({ action: "hardReload" })}
      />
      <FallbackItem
        label={UI_COPY.browserCopyUrl}
        disabled={!hasUrl}
        onClick={() => onAction({ action: "copyUrl" })}
      />
      <div className="mx-1.5 my-1 h-px bg-black/8" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={bookmarkBar}
        onClick={() =>
          onAction({ action: "bookmarkBar", value: !bookmarkBar })
        }
        className="flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 text-[13px] text-zinc-700 transition-colors hover:bg-black/5 hover:text-zinc-900"
      >
        <span>{UI_COPY.browserShowBookmarkBar}</span>
        <Switch
          checked={bookmarkBar}
          onCheckedChange={(checked) =>
            onAction({ action: "bookmarkBar", value: checked })
          }
          className="h-4 w-7 data-[state=checked]:bg-[#34c759] data-[state=unchecked]:bg-zinc-300"
        />
      </button>
      <div className="mx-1.5 my-1 h-px bg-black/8" role="separator" />
      <FallbackItem
        label={UI_COPY.browserClearHistory}
        onClick={() => onAction({ action: "clearHistory" })}
      />
      <FallbackItem
        label={UI_COPY.browserClearCookies}
        disabled={!hasPage}
        onClick={() => onAction({ action: "clearCookies" })}
      />
      <FallbackItem
        label={UI_COPY.browserClearCache}
        disabled={!hasPage}
        onClick={() => onAction({ action: "clearCache" })}
      />
    </>
  );
}

function FallbackItem({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13px] transition-colors",
        disabled
          ? "cursor-default text-zinc-400"
          : "cursor-pointer text-zinc-700 hover:bg-black/5 hover:text-zinc-900",
      )}
    >
      {label}
    </button>
  );
}

function LinkSection({
  title,
  empty,
  items,
  onOpen,
}: {
  title: string;
  empty: string;
  items: { key: string; url: string }[];
  onOpen: (url: string) => void;
}) {
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onOpen(item.url)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors hover:bg-muted"
              >
                <Globe
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 truncate">{item.url}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolbarIconButton({
  label,
  disabled,
  onClick,
  active,
  accent,
  children,
  ref,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  active?: boolean;
  accent?: boolean;
  children: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
        disabled
          ? "cursor-default text-muted-foreground opacity-35"
          : accent && active
            ? "cursor-pointer text-amber-500 hover:bg-black/5"
            : active
              ? "cursor-pointer bg-black/5 text-foreground"
              : "cursor-pointer text-muted-foreground hover:bg-black/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
