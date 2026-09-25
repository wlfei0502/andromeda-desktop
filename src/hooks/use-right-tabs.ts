import { useCallback, useEffect, useState } from "react";

export type RightTabKind = "plan" | "file" | "terminal" | "browser" | "map";

export type RightTab = {
  id: string;
  kind: RightTabKind;
  title: string;
};

export type FileTabContent = {
  file: File | Blob;
  name: string;
};

const KIND_LABEL: Record<RightTabKind, string> = {
  plan: "\u4efb\u52a1\u8ba1\u5212",
  file: "\u6587\u4ef6",
  terminal: "\u7ec8\u7aef",
  browser: "\u6d4f\u89c8\u5668",
  map: "\u5730\u56fe",
};

export function rightTabKindLabel(kind: RightTabKind): string {
  return KIND_LABEL[kind];
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextTitle(kind: RightTabKind, tabs: RightTab[]): string {
  const base = KIND_LABEL[kind];
  const count = tabs.filter((tab) => tab.kind === kind).length;
  if (count === 0) return base;
  return `${base} ${count + 1}`;
}

function displayName(fileName: string) {
  const base = fileName.trim() || KIND_LABEL.file;
  return base.length > 24 ? `${base.slice(0, 21)}…` : base;
}

export function useRightTabs() {
  const [tabs, setTabs] = useState<RightTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<
    Record<string, FileTabContent>
  >({});

  useEffect(() => {
    if (tabs.length === 0) {
      if (activeId != null) setActiveId(null);
      return;
    }
    if (activeId && tabs.some((tab) => tab.id === activeId)) return;
    setActiveId(tabs[tabs.length - 1]?.id ?? null);
  }, [tabs, activeId]);

  const focusTab = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      if (index < 0) return prev;
      const next = prev.filter((tab) => tab.id !== id);
      setActiveId((current) => {
        if (current !== id) return current;
        return (next[index] ?? next[index - 1])?.id ?? null;
      });
      return next;
    });
    setFileContents((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const openTab = useCallback((kind: RightTabKind) => {
    if (kind === "plan" || kind === "map") {
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.kind === kind);
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const id = createId();
        setActiveId(id);
        return [...prev, { id, kind, title: KIND_LABEL[kind] }];
      });
      return;
    }

    const id = createId();
    setTabs((prev) => [...prev, { id, kind, title: nextTitle(kind, prev) }]);
    setActiveId(id);
  }, []);

  /** Ensure a single map tab exists and is focused; returns its id. */
  const ensureMapTab = useCallback((): string => {
    const existing = tabs.find((tab) => tab.kind === "map");
    if (existing) {
      setActiveId(existing.id);
      return existing.id;
    }
    const id = createId();
    setTabs((prev) => [...prev, { id, kind: "map", title: KIND_LABEL.map }]);
    setActiveId(id);
    return id;
  }, [tabs]);

  const setFileTabContent = useCallback((tabId: string, file: File | Blob, name: string) => {
    setFileContents((prev) => ({
      ...prev,
      [tabId]: { file, name },
    }));
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId && tab.kind === "file"
          ? { ...tab, title: displayName(name) }
          : tab,
      ),
    );
  }, []);

  /** Open a file tab; if a File is provided, preview it immediately. */
  const openFileTab = useCallback((file?: File) => {
    const id = createId();
    setTabs((prev) => [
      ...prev,
      {
        id,
        kind: "file",
        title: file ? displayName(file.name) : nextTitle("file", prev),
      },
    ]);
    if (file) {
      setFileContents((prev) => ({
        ...prev,
        [id]: { file, name: file.name },
      }));
    }
    setActiveId(id);
    return id;
  }, []);

  const ensurePlanTab = useCallback(() => {
    openTab("plan");
  }, [openTab]);

  return {
    tabs,
    activeId,
    activeTab: tabs.find((tab) => tab.id === activeId) ?? null,
    fileContents,
    openTab,
    openFileTab,
    setFileTabContent,
    closeTab,
    focusTab,
    ensurePlanTab,
    ensureMapTab,
  };
}
