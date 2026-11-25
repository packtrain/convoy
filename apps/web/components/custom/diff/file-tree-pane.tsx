"use client";

import type { ReactNode, RefObject } from "react";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { getLeftAnchoredWidth, useResizePanel } from "@/hooks/ui/use-resize-panel";
import { useFileTreeSide } from "@/lib/threads/changes-view-prefs";
import { THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { cn } from "@/lib/utils";

/** The resizable changed-files column inside `containerRef`'s flex row, on the side picked in Appearance. */
export function FileTreePane({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const left = useFileTreeSide() === "left";
  const { width, handleMouseDown, adjustWidthBy } = useResizePanel(containerRef, {
    bounds: THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS,
    getWidthFromPointer: left ? getLeftAnchoredWidth : undefined,
  });

  return (
    <div className={cn("relative max-w-[60%] shrink-0", left && "order-first")} style={{ width }}>
      <SidebarResizeHandle
        ariaLabel="Resize file tree"
        currentWidth={width}
        bounds={THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS}
        expandDirection={left ? "right" : "left"}
        onResizeMouseDown={handleMouseDown}
        onResizeByStep={adjustWidthBy}
        className={cn("absolute inset-y-0 z-20", left ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2")}
      />
      <aside
        aria-label="Changed files"
        className={cn("h-full overflow-auto border-border", left ? "border-r" : "border-l")}
      >
        {children}
      </aside>
    </div>
  );
}
