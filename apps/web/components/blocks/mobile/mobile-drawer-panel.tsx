"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MOBILE_NAV_BAR_CLEARANCE } from "@/lib/mobile/constants";

interface MobileDrawerPanelProps {
  open: boolean;
  onClose: () => void;
  compact?: boolean;
  flush?: boolean;
  children: ReactNode;
}

export function MobileDrawerPanel({
  open,
  onClose,
  compact,
  flush,
  children,
}: MobileDrawerPanelProps) {
  return (
    <>
      <div
        data-mobile-drawer-panel
        data-compact={compact ? "true" : "false"}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out md:hidden",
          open ? "translate-y-0" : "translate-y-full"
        )}
        style={compact ? undefined : { top: "0.5rem" }}
      >
        <div
          className={cn(
            "overflow-y-auto overflow-x-hidden overscroll-contain",
            !compact && "flex-1"
          )}
          style={flush ? undefined : { paddingBottom: MOBILE_NAV_BAR_CLEARANCE }}
        >
          {open && children}
        </div>
      </div>
    </>
  );
}
