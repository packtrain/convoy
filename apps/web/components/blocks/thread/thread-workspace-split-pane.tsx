"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS } from "@/lib/threads/constants";
import { ThreadDetailSidebarShell } from "./thread-detail-sidebar-shell";

interface ThreadWorkspaceSplitPaneProps {
  isSidebarOpen: boolean;
  onCloseSidebar: () => void;
  sidebarTitle?: string;
  sidebarHeader?: ReactNode;
  showSidebarHeader?: boolean;
  sidebarContent?: ReactNode;
  children: ReactNode;
}

export function ThreadWorkspaceSplitPane({
  isSidebarOpen,
  onCloseSidebar,
  sidebarTitle = "Thread sidebar",
  sidebarHeader,
  showSidebarHeader = true,
  sidebarContent,
  children,
}: ThreadWorkspaceSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    width: sidebarWidth,
    handleMouseDown,
    adjustWidthBy,
  } = useResizePanel(containerRef, {
    bounds: THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS,
  });

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-1 min-w-0 overflow-hidden"
    >
      {children}
      <ThreadDetailSidebarShell
        isOpen={isSidebarOpen}
        width={sidebarWidth}
        bounds={THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS}
        onClose={onCloseSidebar}
        onResizeMouseDown={handleMouseDown}
        onResizeByStep={adjustWidthBy}
        title={sidebarTitle}
        header={sidebarHeader}
        showHeader={showSidebarHeader}
      >
        {sidebarContent}
      </ThreadDetailSidebarShell>
    </div>
  );
}
