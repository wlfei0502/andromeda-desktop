import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Globe,
  ListTodo,
  Map,
  PanelRight,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { PlanTodoList } from "@/components/chat/plan-todo-list";
import { UI_COPY } from "@/components/chat/ui-copy";
import { Button } from "@/components/ui/button";
import {
  closeTerminalSession,
  LocalTerminal,
} from "@/components/terminal/local-terminal";
import { BrowserPanel } from "@/components/browser/browser-panel";
import { closeBrowserWebview } from "@/components/browser/browser-webview-host";
import { FilePanel } from "@/components/file/file-panel";
import { closeMapWebview, MapWebviewHost } from "@/components/map/map-webview-host";
import {
  rightTabKindLabel,
  type RightTabKind,
} from "@/hooks/use-right-tabs";
import {
  hideAddTabMenuOverlay,
  isTauriRuntime,
  listenAddTabMenuDismiss,
  listenAddTabMenuSelect,
  openAddTabMenuOverlay,
} from "@/lib/panel-add-menu";
import { cn } from "@/lib/utils";
import { usePanelTabsContext } from "./panel-tabs-context";

const DEFAULT_MAP_URL = "http://127.0.0.1:5174/";

const TAB_ICONS: Record<RightTabKind, typeof FileText> = {
  plan: ListTodo,
  file: FileText,
  terminal: SquareTerminal,
  browser: Globe,
  map: Map,
};

const ADD_ITEMS: {
  kind: RightTabKind;
  icon: typeof FileText;
}[] = (
  ["plan", "file", "terminal", "browser", "map"] as const
).map((kind) => ({ kind, icon: TAB_ICONS[kind] }));

type RightPanelProps = {
  onClose: () => void;
};

export function RightPanel({ onClose }: RightPanelProps) {
  const {
    tabs,
    activeId,
    activeTab,
    fileContents,
    openTab,
    setFileTabContent,
    closeTab,
    focusTab,
    plan,
  } = usePanelTabsContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [useNativeOverlay, setUseNativeOverlay] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const menuWidth = 176;
  const [mapUrl, setMapUrl] = useState(DEFAULT_MAP_URL);

  useEffect(() => {
    void invoke<{ map_url?: string }>("get_cloud_config")
      .then((cfg) => {
        const next = cfg?.map_url?.trim();
        if (next) setMapUrl(next.endsWith("/") ? next : `${next}/`);
      })
      .catch(() => {
        /* keep default */
      });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current || useNativeOverlay) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - menuWidth - 8;
    let left = rect.left;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    setMenuPos({ top: rect.bottom + 4, left });
  }, [menuOpen, useNativeOverlay]);

  useLayoutEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [tabs.length, activeId]);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!menuOpen || useNativeOverlay) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, useNativeOverlay]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unSelect: (() => void) | undefined;
    let unDismiss: (() => void) | undefined;

    void listenAddTabMenuSelect((kind) => {
      openTab(kind);
      setMenuOpen(false);
      setUseNativeOverlay(false);
      void hideAddTabMenuOverlay().catch(() => {});
    }).then((un) => {
      if (cancelled) un();
      else unSelect = un;
    });

    void listenAddTabMenuDismiss(() => {
      setMenuOpen(false);
      setUseNativeOverlay(false);
      void hideAddTabMenuOverlay().catch(() => {});
    }).then((un) => {
      if (cancelled) un();
      else unDismiss = un;
    });

    return () => {
      cancelled = true;
      unSelect?.();
      unDismiss?.();
      void hideAddTabMenuOverlay().catch(() => {});
    };
  }, [openTab]);

  function handleCloseTab(id: string) {
    const tab = tabs.find((item) => item.id === id);
    if (tab?.kind === "terminal") {
      void closeTerminalSession(id).catch(() => {});
    }
    if (tab?.kind === "map") {
      void closeMapWebview(id).catch(() => {});
    }
    if (tab?.kind === "browser") {
      void closeBrowserWebview(id).catch(() => {});
    }
    closeTab(id);
  }

  function handleAddClick() {
    if (menuOpen) {
      setMenuOpen(false);
      setUseNativeOverlay(false);
      void hideAddTabMenuOverlay().catch(() => {});
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const maxLeft = window.innerWidth - menuWidth - 8;
    let left = rect.left;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    const top = rect.bottom + 4;
    const hidePlan = tabs.some((tab) => tab.kind === "plan");

    // Cursor-style: float a transparent child WebView above map/browser surfaces.
    if (isTauriRuntime()) {
      setUseNativeOverlay(true);
      setMenuOpen(true);
      void openAddTabMenuOverlay({ left, top, hidePlan }).catch((err) => {
        console.error("add-tab overlay failed", err);
        setUseNativeOverlay(false);
        setMenuPos({ top, left });
      });
      return;
    }

    setUseNativeOverlay(false);
    setMenuPos({ top, left });
    setMenuOpen(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border/60 px-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          <div
            ref={tabsScrollRef}
            className="panel-tabs-scroll min-w-0 overflow-x-auto overflow-y-hidden"
            style={{ flex: "0 1 auto" }}
          >
            <div className="flex w-max items-center gap-0.5">
              {tabs.map((tab) => {
                const active = tab.id === activeId;
                const Icon = TAB_ICONS[tab.kind];
                const closeSurface = active
                  ? "bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))]"
                  : "bg-muted";
                const closeFade = active
                  ? "to-[color-mix(in_oklab,var(--foreground)_5%,var(--background))]"
                  : "to-muted";
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      "group relative flex h-7 max-w-[9.5rem] shrink-0 items-center rounded-sm text-xs transition-colors",
                      active
                        ? "bg-foreground/5 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => focusTab(tab.id)}
                      title={tab.title}
                      className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 overflow-hidden px-1.5 py-1 text-center"
                    >
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{tab.title}</span>
                    </button>
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-y-0 right-6 z-[1] w-3.5 bg-gradient-to-r from-transparent opacity-0 transition-opacity group-hover:opacity-100",
                        closeFade,
                      )}
                    />
                    <button
                      type="button"
                      aria-label={UI_COPY.tabClose}
                      title={UI_COPY.tabClose}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseTab(tab.id);
                      }}
                      className={cn(
                        "absolute inset-y-0 right-0 z-[1] inline-flex w-6 cursor-pointer items-center justify-center rounded-r-sm text-muted-foreground transition-[opacity,color] hover:text-foreground",
                        "opacity-0 group-hover:opacity-100",
                        closeSurface,
                      )}
                    >
                      <X className="size-3.5" strokeWidth={2.25} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            ref={triggerRef}
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={UI_COPY.tabAddAria}
            title={UI_COPY.tabAddTitle}
            onClick={handleAddClick}
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors",
              menuOpen
                ? "bg-muted text-foreground"
                : "hover:bg-muted/70 hover:text-foreground",
            )}
          >
            <Plus className="size-4" strokeWidth={2.25} aria-hidden />
          </button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={UI_COPY.toggleRight}
          title={UI_COPY.toggleRight}
          onClick={onClose}
          className="shrink-0 text-muted-foreground"
        >
          <PanelRight />
        </Button>
      </div>

      {menuOpen && !useNativeOverlay
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-[100] w-44 overflow-hidden rounded-lg border border-border/70 bg-card p-1 shadow-sm"
            >
              {ADD_ITEMS.filter(
                ({ kind }) =>
                  kind !== "plan" || !tabs.some((tab) => tab.kind === "plan"),
              ).map(({ kind, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    openTab(kind);
                    setMenuOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {rightTabKindLabel(kind)}
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f4f4f5]">
        {tabs.map((tab) => {
          if (tab.kind !== "file") return null;
          const isActive = tab.id === activeId;
          const content = fileContents[tab.id];
          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0",
                isActive ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={!isActive}
            >
              <FilePanel
                tabId={tab.id}
                active={isActive}
                file={content?.file ?? null}
                name={content?.name ?? null}
                onOpenFile={(file) => {
                  setFileTabContent(tab.id, file, file.name);
                }}
              />
            </div>
          );
        })}

        {tabs.map((tab) => {
          if (tab.kind !== "terminal") return null;
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0",
                isActive ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={!isActive}
            >
              <LocalTerminal sessionId={tab.id} active={isActive} />
            </div>
          );
        })}

        {tabs.map((tab) => {
          if (tab.kind !== "browser") return null;
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0",
                isActive ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={!isActive}
            >
              <BrowserPanel tabId={tab.id} active={isActive} />
            </div>
          );
        })}

        {tabs.map((tab) => {
          if (tab.kind !== "map") return null;
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0",
                isActive ? "z-10" : "pointer-events-none invisible z-0",
              )}
              aria-hidden={!isActive}
            >
              <MapWebviewHost tabId={tab.id} active={isActive} url={mapUrl} />
            </div>
          );
        })}

        {activeTab == null ? (
          <div className="relative z-0 flex h-full items-center justify-center bg-[#f4f4f5] p-4">
            <div className="flex w-full max-w-[9rem] flex-col gap-0.5">
              {ADD_ITEMS.map(({ kind, icon: Icon }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => openTab(kind)}
                  className="flex w-full cursor-pointer items-center justify-start gap-2 rounded-sm px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{rightTabKindLabel(kind)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : activeTab.kind === "plan" ? (
          <div className="relative z-10 h-full min-h-0 overflow-y-auto bg-background p-3">
            <PlanTodoList
              todos={plan.todos}
              waiting={plan.waiting}
              variant="panel"
              className="h-full"
            />
          </div>
        ) : activeTab.kind === "file" ||
          activeTab.kind === "terminal" ||
          activeTab.kind === "map" ||
          activeTab.kind === "browser" ? null : (
          <div className="relative z-10 flex h-full items-center justify-center bg-background p-4">
            <p className="max-w-[12rem] text-center text-sm leading-relaxed text-muted-foreground/80">
              {UI_COPY.tabPlaceholder}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
