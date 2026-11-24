"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import { getLeftAnchoredWidth, type ResizeBounds, useResizePanel } from "@/hooks/ui/use-resize-panel";
import { THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { ThreadDetailSidebarShell } from "./thread-detail-sidebar-shell";

interface ThreadWorkspaceSplitPaneProps {
  isSidebarOpen: boolean;
  onCloseSidebar: () => void;
  sidebarTitle?: string;
  sidebarHeader?: ReactNode;
  showSidebarHeader?: boolean;
  sidebarContent?: ReactNode;
  sidebarSide?: "left" | "right";
  /** Width range and storage key; the thread sidebar's by default. */
  bounds?: ResizeBounds;
  children: ReactNode;
}

export function ThreadWorkspaceSplitPane({
  isSidebarOpen,
  onCloseSidebar,
  sidebarTitle = "Thread sidebar",
  sidebarHeader,
  showSidebarHeader = true,
  sidebarContent,
  sidebarSide = "right",
  bounds = THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS,
  children,
}: ThreadWorkspaceSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    width: sidebarWidth,
    handleMouseDown,
    adjustWidthBy,
  } = useResizePanel(containerRef, {
    bounds,
    getWidthFromPointer: sidebarSide === "left" ? getLeftAnchoredWidth : undefined,
  });

  const sidebar = (
    <ThreadDetailSidebarShell
      isOpen={isSidebarOpen}
      width={sidebarWidth}
      bounds={bounds}
      onClose={onCloseSidebar}
      onResizeMouseDown={handleMouseDown}
      onResizeByStep={adjustWidthBy}
      title={sidebarTitle}
      header={sidebarHeader}
      showHeader={showSidebarHeader}
      side={sidebarSide}
    >
      {sidebarContent}
    </ThreadDetailSidebarShell>
  );

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-1 min-w-0 overflow-hidden"
    >
      {sidebarSide === "left" && sidebar}
      {children}
      {sidebarSide === "right" && sidebar}
    </div>
  );
}
