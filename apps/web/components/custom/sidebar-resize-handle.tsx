"use client";

import type { HTMLAttributes, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ResizeBounds } from "@/hooks/ui/use-resize-panel";
import { cn } from "@/lib/utils";

const SIDEBAR_RESIZE_STEP_PX = 16;
const SIDEBAR_RESIZE_LARGE_STEP_PX = 48;

interface SidebarResizeHandleProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onMouseDown" | "onKeyDown"> {
  ariaLabel: string;
  currentWidth: number;
  bounds: Pick<ResizeBounds, "min" | "max">;
  expandDirection: "left" | "right";
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeByStep: (delta: number, options?: { persist?: boolean }) => void;
}

export function SidebarResizeHandle({
  ariaLabel,
  currentWidth,
  bounds,
  expandDirection,
  onResizeMouseDown,
  onResizeByStep,
  className,
  ...props
}: SidebarResizeHandleProps) {
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isArrowLeft = event.key === "ArrowLeft";
    const isArrowRight = event.key === "ArrowRight";
    if (!isArrowLeft && !isArrowRight) {
      return;
    }

    event.preventDefault();
    const step = event.shiftKey
      ? SIDEBAR_RESIZE_LARGE_STEP_PX
      : SIDEBAR_RESIZE_STEP_PX;
    const expandKey = expandDirection === "left" ? "ArrowLeft" : "ArrowRight";
    const delta = event.key === expandKey ? step : -step;
    onResizeByStep(delta, { persist: true });
  };

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={Math.round(currentWidth)}
      tabIndex={0}
      onKeyDown={handleResizeKeyDown}
      onMouseDown={onResizeMouseDown}
      className={cn(
        "w-1 cursor-col-resize transition-colors hover:bg-muted active:bg-muted/80",
        className
      )}
      {...props}
    />
  );
}
