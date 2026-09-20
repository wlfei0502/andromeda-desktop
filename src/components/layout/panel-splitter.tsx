import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type PanelSplitterProps = {
  side: "left" | "right";
  min: number;
  max: number;
  value: number;
  onDrag: (deltaX: number) => void;
  className?: string;
};

export function PanelSplitter({
  side,
  min,
  max,
  value,
  onDrag,
  className,
}: PanelSplitterProps) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - lastXRef.current;
      lastXRef.current = event.clientX;
      onDrag(side === "left" ? delta : -delta);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("panel-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onDrag, side]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label={side === "left" ? "Resize left panel" : "Resize right panel"}
      tabIndex={0}
      className={cn("panel-splitter", className)}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        lastXRef.current = event.clientX;
        document.body.classList.add("panel-resizing");
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onDrag(side === "left" ? -step : step);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onDrag(side === "left" ? step : -step);
        }
      }}
    />
  );
}
