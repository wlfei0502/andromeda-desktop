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
  const valueRef = useRef(value);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onDragRef = useRef(onDrag);
  valueRef.current = value;
  minRef.current = min;
  maxRef.current = max;
  onDragRef.current = onDrag;

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - lastXRef.current;
      const signed = side === "left" ? delta : -delta;
      const current = valueRef.current;
      const lo = minRef.current;
      const hi = maxRef.current;

      // At min/max: ignore further movement past the bound, but keep lastX
      // so reversing direction resumes smoothly without a jump.
      if ((signed < 0 && current <= lo) || (signed > 0 && current >= hi)) {
        lastXRef.current = event.clientX;
        return;
      }

      lastXRef.current = event.clientX;
      onDragRef.current(signed);
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
  }, [side]);

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
