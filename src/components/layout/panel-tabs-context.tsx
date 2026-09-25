import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TodoItem } from "@/lib/cloud-events";
import {
  useRightTabs,
  type FileTabContent,
  type RightTabKind,
} from "@/hooks/use-right-tabs";

export type PlanPanelState = {
  todos: TodoItem[];
  planMode: boolean;
  waiting: boolean;
};

type PanelTabsContextValue = {
  tabs: ReturnType<typeof useRightTabs>["tabs"];
  activeId: string | null;
  activeTab: ReturnType<typeof useRightTabs>["activeTab"];
  fileContents: Record<string, FileTabContent>;
  openTab: (kind: RightTabKind) => void;
  openFileTab: (file?: File) => string;
  setFileTabContent: (tabId: string, file: File | Blob, name: string) => void;
  closeTab: (id: string) => void;
  focusTab: (id: string) => void;
  ensurePlanTab: () => void;
  ensureMapTab: () => string;
  plan: PlanPanelState;
  setPlan: (next: PlanPanelState) => void;
  requestPlanSurface: () => void;
  registerOpenRight: (fn: () => void) => void;
  openRightPanel: () => void;
};

const PanelTabsContext = createContext<PanelTabsContextValue | null>(null);

const EMPTY_PLAN: PlanPanelState = {
  todos: [],
  planMode: false,
  waiting: false,
};

export function PanelTabsProvider({ children }: { children: ReactNode }) {
  const {
    tabs,
    activeId,
    activeTab,
    fileContents,
    openTab,
    openFileTab,
    setFileTabContent,
    closeTab,
    focusTab,
    ensurePlanTab,
    ensureMapTab,
  } = useRightTabs();
  const [plan, setPlan] = useState<PlanPanelState>(EMPTY_PLAN);
  const openRightRef = useRef<() => void>(() => {});

  const registerOpenRight = useCallback((fn: () => void) => {
    openRightRef.current = fn;
  }, []);

  const openRightPanel = useCallback(() => {
    openRightRef.current();
  }, []);

  const requestPlanSurface = useCallback(() => {
    openRightRef.current();
    ensurePlanTab();
  }, [ensurePlanTab]);

  const value = useMemo<PanelTabsContextValue>(
    () => ({
      tabs,
      activeId,
      activeTab,
      fileContents,
      openTab,
      openFileTab,
      setFileTabContent,
      closeTab,
      focusTab,
      ensurePlanTab,
      ensureMapTab,
      plan,
      setPlan,
      requestPlanSurface,
      registerOpenRight,
      openRightPanel,
    }),
    [
      tabs,
      activeId,
      activeTab,
      fileContents,
      openTab,
      openFileTab,
      setFileTabContent,
      closeTab,
      focusTab,
      ensurePlanTab,
      ensureMapTab,
      plan,
      requestPlanSurface,
      registerOpenRight,
      openRightPanel,
    ],
  );

  return (
    <PanelTabsContext.Provider value={value}>
      {children}
    </PanelTabsContext.Provider>
  );
}

export function usePanelTabsContext() {
  const ctx = useContext(PanelTabsContext);
  if (!ctx) {
    throw new Error("usePanelTabsContext must be used within PanelTabsProvider");
  }
  return ctx;
}
