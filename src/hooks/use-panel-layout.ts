import { useCallback, useEffect, useRef, useState } from "react";
import { ensureWindowMinWidth, syncWindowMinWidth } from "@/lib/window-size";

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
  rightDefault: 320,
  /** Middle chat column — keep composer / messages from collapsing. */
  centerMin: 430,
} as const;

/** Right panel max from remaining space after centerMin (+ left if open). */
function rightMaxFor(
  containerWidth: number,
  layout: Pick<PanelLayoutState, "leftOpen" | "leftWidth">,
): number {
  const leftSpace = layout.leftOpen ? layout.leftWidth : 0;
  return Math.max(
    PANEL_LIMITS.rightMin,
    containerWidth - PANEL_LIMITS.centerMin - leftSpace,
  );
}

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
      rightWidth: Math.max(
        PANEL_LIMITS.rightMin,
        parsed.rightWidth ?? DEFAULT_LAYOUT.rightWidth,
      ),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Minimum content-row width to fit the given panel layout. */
export function requiredRowWidth(layout: PanelLayoutState): number {
  let width = PANEL_LIMITS.centerMin;
  if (layout.leftOpen) width += layout.leftWidth;
  if (layout.rightOpen) width += layout.rightWidth;
  return width;
}

function centerSpace(containerWidth: number, layout: PanelLayoutState) {
  return (
    containerWidth -
    (layout.leftOpen ? layout.leftWidth : 0) -
    (layout.rightOpen ? layout.rightWidth : 0)
  );
}

/**
 * When the window shrinks, shrink the right panel first, then close sides
 * (right, then left) so the middle region never drops below centerMin.
 */
function fitLayoutToWidth(
  containerWidth: number,
  prev: PanelLayoutState,
): PanelLayoutState {
  if (centerSpace(containerWidth, prev) >= PANEL_LIMITS.centerMin - 0.5) {
    return prev;
  }

  let next = prev;
  if (next.rightOpen) {
    const maxRight = rightMaxFor(containerWidth, next);
    if (maxRight >= PANEL_LIMITS.rightMin && next.rightWidth > maxRight) {
      next = { ...next, rightWidth: maxRight };
      if (centerSpace(containerWidth, next) >= PANEL_LIMITS.centerMin - 0.5) {
        return next;
      }
    }
    next = { ...next, rightOpen: false };
    if (centerSpace(containerWidth, next) >= PANEL_LIMITS.centerMin - 0.5) {
      return next;
    }
  }
  if (next.leftOpen) {
    next = { ...next, leftOpen: false };
  }
  return next;
}

export function usePanelLayout() {
  const [layout, setLayout] = useState<PanelLayoutState>(DEFAULT_LAYOUT);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** Skip auto-fit while a force-open is resizing the window. */
  const forceOpenLockRef = useRef(0);

  useEffect(() => {
    setLayout(readStored());
  }, []);

  // Absolute floor: window edges cannot shrink past the middle min width.
  useEffect(() => {
    void syncWindowMinWidth(PANEL_LIMITS.centerMin);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* ignore quota / private mode */
    }
  }, [layout]);

  // Window resize / left grow: collapse sides before crushing the center.
  useEffect(() => {
    if (containerWidth == null) return;
    if (forceOpenLockRef.current > 0) return;
    setLayout((prev) => fitLayoutToWidth(containerWidth, prev));
  }, [containerWidth, layout.leftWidth, layout.rightWidth]);

  const reportContainerWidth = useCallback((width: number) => {
    setContainerWidth(width);
    // Fit in the same frame as the resize observation so fixed panel widths
    // cannot briefly overflow and flash the native window background.
    if (forceOpenLockRef.current > 0) return;
    setLayout((prev) => fitLayoutToWidth(width, prev));
  }, []);

  const forceOpenPanels = useCallback(
    async (patch: Partial<Pick<PanelLayoutState, "leftOpen" | "rightOpen">>) => {
      const prev = layoutRef.current;
      const next: PanelLayoutState = { ...prev, ...patch };
      const needed = requiredRowWidth(next);

      forceOpenLockRef.current += 1;
      try {
        const applied = await ensureWindowMinWidth(needed);
        if (applied != null) {
          setContainerWidth((w) => (w == null ? applied : Math.max(w, applied)));
        } else {
          setContainerWidth((w) => (w == null ? needed : Math.max(w, needed)));
        }
        setLayout((p) => ({ ...p, ...patch }));
      } finally {
        window.setTimeout(() => {
          forceOpenLockRef.current = Math.max(0, forceOpenLockRef.current - 1);
        }, 120);
      }
    },
    [],
  );

  const toggleLeft = useCallback(() => {
    const prev = layoutRef.current;
    if (prev.leftOpen) {
      setLayout((p) => ({ ...p, leftOpen: false }));
      return;
    }
    void forceOpenPanels({ leftOpen: true });
  }, [forceOpenPanels]);

  const toggleRight = useCallback(() => {
    const prev = layoutRef.current;
    if (prev.rightOpen) {
      setLayout((p) => ({ ...p, rightOpen: false }));
      return;
    }
    void forceOpenPanels({ rightOpen: true });
  }, [forceOpenPanels]);

  const resizeLeftBy = useCallback(
    (delta: number) => {
      setLayout((prev) => {
        let max: number = PANEL_LIMITS.leftMax;
        if (containerWidth != null) {
          const rightSpace = prev.rightOpen ? prev.rightWidth : 0;
          max = Math.min(
            max,
            containerWidth - PANEL_LIMITS.centerMin - rightSpace,
          );
          max = Math.max(PANEL_LIMITS.leftMin, max);
        }
        const next = clamp(prev.leftWidth + delta, PANEL_LIMITS.leftMin, max);
        if (next === prev.leftWidth) return prev;
        return { ...prev, leftWidth: next };
      });
    },
    [containerWidth],
  );

  const resizeRightBy = useCallback(
    (delta: number) => {
      setLayout((prev) => {
        if (!prev.rightOpen) return prev;
        if (containerWidth == null) return prev;
        const max = rightMaxFor(containerWidth, prev);
        const next = clamp(prev.rightWidth + delta, PANEL_LIMITS.rightMin, max);
        if (next === prev.rightWidth) return prev;
        return { ...prev, rightWidth: next };
      });
    },
    [containerWidth],
  );

  const leftDragMax = (() => {
    let max: number = PANEL_LIMITS.leftMax;
    if (containerWidth != null) {
      const rightSpace = layout.rightOpen ? layout.rightWidth : 0;
      max = Math.min(
        max,
        containerWidth - PANEL_LIMITS.centerMin - rightSpace,
      );
    }
    return Math.max(PANEL_LIMITS.leftMin, max);
  })();

  const rightDragMax =
    containerWidth == null
      ? PANEL_LIMITS.rightMin
      : rightMaxFor(containerWidth, layout);

  return {
    layout,
    toggleLeft,
    toggleRight,
    resizeLeftBy,
    resizeRightBy,
    reportContainerWidth,
    leftDragMax,
    rightDragMax,
    forceOpenPanels,
  };
}
