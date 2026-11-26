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
        <FileTreeHeader levelWith="section" />
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}

const HEADER_LEVEL = {
  // Level with a 41px bg-card changes toolbar.
  toolbar: { row: "h-[41px] bg-card", button: "size-7" },
  // Level with the first diff file header (`PatchFileSection`: py-1.5 + size-6 actions + border).
  section: { row: "h-[37px]", button: "size-6" },
} as const;

/** The "Files" row atop every changed-files tree, sized to the row beside it. */
export function FileTreeHeader({ onClose, levelWith = "toolbar" }: { onClose?: () => void; levelWith?: keyof typeof HEADER_LEVEL }) {
  const level = HEADER_LEVEL[levelWith];
  return (
    <div className={cn("flex shrink-0 items-center justify-between border-b border-border px-3 text-xs font-medium", level.row)}>
      Files
      {onClose && (
        <Button variant="ghost" size="icon-sm" className={cn("cursor-pointer", level.button)} aria-label="Close files" onClick={onClose}>
          <X />
        </Button>
      )}
    </div>
  );
}
