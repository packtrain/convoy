"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import type { ResizeBounds } from "@/hooks/ui/use-resize-panel";
import { cn } from "@/lib/utils";

interface ThreadDetailSidebarShellProps {
  isOpen: boolean;
  width: number;
  onClose: () => void;
  bounds: Pick<ResizeBounds, "min" | "max">;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeByStep: (delta: number, options?: { persist?: boolean }) => void;
  title?: string;
  header?: ReactNode;
  showHeader?: boolean;
  children: ReactNode;
  className?: string;
}

export function ThreadDetailSidebarShell({
  isOpen,
  width,
  onClose,
  bounds,
  onResizeMouseDown,
  onResizeByStep,
  title = "Thread sidebar",
  header,
  showHeader = true,
  children,
  className,
}: ThreadDetailSidebarShellProps) {
  const isMobile = useIsMobile();

  if (!isOpen) {
    return null;
  }

  const defaultHeader = (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
      <h2 className="truncate text-sm font-medium text-foreground">
        {title}
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close thread sidebar"
        className="cursor-pointer"
      >
        <X className="size-4" />
      </Button>
    </div>
  );

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
          data-testid="thread-detail-drawer"
          className={cn(
            "h-dvh w-screen max-w-none overflow-hidden rounded-none p-0 data-[vaul-drawer-direction=right]:w-screen data-[vaul-drawer-direction=right]:max-w-none data-[vaul-drawer-direction=right]:rounded-none data-[vaul-drawer-direction=right]:sm:max-w-none",
            className
          )}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>View and edit task details.</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {showHeader ? header ?? defaultHeader : null}
            <div
              data-testid="thread-detail-sidebar-body"
              className="min-h-0 flex-1 overflow-auto"
            >
              {children}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div
      data-testid="thread-detail-sidebar"
      className="relative h-full shrink-0"
      style={{ width: `${width}px` }}
    >
      <SidebarResizeHandle
        ariaLabel="Resize thread detail sidebar"
        currentWidth={width}
        bounds={bounds}
        expandDirection="left"
        onResizeMouseDown={onResizeMouseDown}
        onResizeByStep={onResizeByStep}
        className="absolute inset-y-0 left-0 z-10 -translate-x-1/2"
      />
      <aside
        aria-label={title}
        className={cn(
          "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background",
          className
        )}
      >
        {showHeader
          ? header ?? defaultHeader
          : null}
        <div
          data-testid="thread-detail-sidebar-body"
          className="min-h-0 flex-1 overflow-auto"
        >
          {children}
        </div>
      </aside>
    </div>
  );
}
