"use client";

import type { ReactNode } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MOBILE_NAV_BAR_CLEARANCE } from "@/lib/mobile/constants";
import { cn } from "@/lib/utils";

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name; rendered sr-only so sheets keep their own visual header. */
  title: string;
  description: string;
  /** Stacks above an already-open sheet (vaul nested drawer). */
  nested?: boolean;
  /**
   * `scroll` (default) scrolls the whole sheet body. `fill` makes the body a
   * flex column whose child owns the scroll area — for content that needs a
   * pinned header/footer inside the sheet (e.g. the List picker's search row).
   */
  body?: "scroll" | "fill";
  children: ReactNode;
}

/**
 * Canonical bottom sheet for mobile chrome: a shadcn/vaul `Drawer` plus this app's
 * conventions — reaches the bottom of the screen under the floating nav bar, reserves
 * that bar's clearance as trailing scroll space, and keeps vertical drags inside the body
 * scrolling instead of closing (docs/specs/mobile-bottom-nav.md).
 */
export function MobileSheet({
  open,
  onClose,
  title,
  description,
  nested,
  body = "scroll",
  children,
}: MobileSheetProps) {
  return (
    <Drawer
      open={open}
      nested={nested}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DrawerContent className="max-h-[85dvh] data-[vaul-drawer-direction=bottom]:max-h-[85dvh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {/* The top handle stays the drag affordance; drags over the body scroll
            it (data-vaul-no-drag) instead of dragging the sheet closed. */}
        <div
          data-vaul-no-drag
          data-mobile-sheet-body={body}
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            body === "scroll" && "overflow-y-auto overscroll-contain"
          )}
          style={
            body === "scroll"
              ? { paddingBottom: MOBILE_NAV_BAR_CLEARANCE }
              : undefined
          }
        >
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
