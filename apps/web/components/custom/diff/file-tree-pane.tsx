"use client";

import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        className={cn("flex h-full flex-col border-border", left ? "border-r" : "border-l")}
      >
        <FileTreeHeader />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}

/** The "Files" row atop every changed-files tree; 41px and bg-card to match the changes toolbar. */
export function FileTreeHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-card px-3 text-xs font-medium">
      Files
      {onClose && (
        <Button variant="ghost" size="icon-sm" className="cursor-pointer" aria-label="Close files" onClick={onClose}>
          <X />
        </Button>
      )}
    </div>
  );
}
