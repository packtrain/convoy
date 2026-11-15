"use client";

import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { ARTIFACT_RESIZE_BOUNDS, RESIZE_BOUNDS } from "@/lib/tasks/constants";
import { cn } from "@/lib/utils";

type TaskSidebarOverlayStyle = CSSProperties & {
  "--task-sidebar-requested-width"?: string;
  "--task-overlay-width"?: string;
};

export interface TaskSidebarResizeControls {
  width: number;
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onStep: (delta: number, options?: { persist?: boolean }) => void;
}

interface TaskSidebarOverlayProps {
  sidebarOverlayRef: RefObject<HTMLDivElement | null>;
  sidebarContainerStyle: TaskSidebarOverlayStyle;
  isOpen: boolean;
  detailsResize: TaskSidebarResizeControls;
  /** Present while an artifact panel is open; adds a second handle for it. */
  artifactResize: TaskSidebarResizeControls | null;
  onClose: () => void;
  children: ReactNode;
}

export function TaskSidebarOverlay({
  sidebarOverlayRef,
  sidebarContainerStyle,
  isOpen,
  detailsResize,
  artifactResize,
  onClose,
  children,
}: TaskSidebarOverlayProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        direction="right"
      >
        <DrawerContent
          data-testid="task-detail-drawer"
          data-task-panel
          className="h-dvh w-screen max-w-none overflow-hidden rounded-none p-0 data-[vaul-drawer-direction=right]:w-screen data-[vaul-drawer-direction=right]:max-w-none data-[vaul-drawer-direction=right]:rounded-none data-[vaul-drawer-direction=right]:sm:max-w-none"
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>Task details</DrawerTitle>
            <DrawerDescription>View and edit task details.</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div
      ref={sidebarOverlayRef}
      style={sidebarContainerStyle}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex border-l border-border bg-background shadow-lg transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      {artifactResize ? (
        <SidebarResizeHandle
          ariaLabel="Resize artifact panel"
          currentWidth={artifactResize.width}
          bounds={ARTIFACT_RESIZE_BOUNDS}
          expandDirection="left"
          onResizeMouseDown={artifactResize.onMouseDown}
          onResizeByStep={artifactResize.onStep}
          className="-ml-1"
        />
      ) : (
        <SidebarResizeHandle
          ariaLabel="Resize task sidebar"
          currentWidth={detailsResize.width}
          bounds={RESIZE_BOUNDS}
          expandDirection="left"
          onResizeMouseDown={detailsResize.onMouseDown}
          onResizeByStep={detailsResize.onStep}
          className="-ml-1"
        />
      )}
      {artifactResize ? (
        // Second handle on the task-details panel's left edge (the boundary
        // between the artifact panel and the details content).
        <SidebarResizeHandle
          ariaLabel="Resize task sidebar"
          currentWidth={detailsResize.width}
          bounds={RESIZE_BOUNDS}
          expandDirection="left"
          onResizeMouseDown={detailsResize.onMouseDown}
          onResizeByStep={detailsResize.onStep}
          className="absolute inset-y-0 z-30 translate-x-1/2"
          style={{ right: "var(--task-sidebar-effective-width)" }}
        />
      ) : null}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
