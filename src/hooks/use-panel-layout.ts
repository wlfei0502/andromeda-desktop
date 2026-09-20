import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "andromeda.panel-layout.v1";

export type PanelLayoutState = {
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
};

export const PANEL_LIMITS = {
  leftMin: 180,
  leftMax: 420,
  leftDefault: 260,
  rightMin: 220,
  rightMax: 520,
  rightDefault: 320,
} as const;

const DEFAULT_LAYOUT: PanelLayoutState = {
  leftOpen: true,
  rightOpen: true,
  leftWidth: PANEL_LIMITS.leftDefault,
  rightWidth: PANEL_LIMITS.rightDefault,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStored(): PanelLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    return {
      leftOpen: parsed.leftOpen ?? DEFAULT_LAYOUT.leftOpen,
      rightOpen: parsed.rightOpen ?? DEFAULT_LAYOUT.rightOpen,
      leftWidth: clamp(
        parsed.leftWidth ?? DEFAULT_LAYOUT.leftWidth,
        PANEL_LIMITS.leftMin,
        PANEL_LIMITS.leftMax,
      ),
      rightWidth: clamp(
        parsed.rightWidth ?? DEFAULT_LAYOUT.rightWidth,
        PANEL_LIMITS.rightMin,
        PANEL_LIMITS.rightMax,
      ),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function usePanelLayout() {
  const [layout, setLayout] = useState<PanelLayoutState>(DEFAULT_LAYOUT);

  useEffect(() => {
    setLayout(readStored());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* ignore quota / private mode */
    }
  }, [layout]);

  const toggleLeft = useCallback(() => {
    setLayout((prev) => ({ ...prev, leftOpen: !prev.leftOpen }));
  }, []);

  const toggleRight = useCallback(() => {
    setLayout((prev) => ({ ...prev, rightOpen: !prev.rightOpen }));
  }, []);

  const resizeLeftBy = useCallback((delta: number) => {
    setLayout((prev) => ({
      ...prev,
      leftWidth: clamp(
        prev.leftWidth + delta,
        PANEL_LIMITS.leftMin,
        PANEL_LIMITS.leftMax,
      ),
    }));
  }, []);

  const resizeRightBy = useCallback((delta: number) => {
    setLayout((prev) => ({
      ...prev,
      rightWidth: clamp(
        prev.rightWidth + delta,
        PANEL_LIMITS.rightMin,
        PANEL_LIMITS.rightMax,
      ),
    }));
  }, []);

  return {
    layout,
    toggleLeft,
    toggleRight,
    resizeLeftBy,
    resizeRightBy,
  };
}
