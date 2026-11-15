"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { PanelLeftIcon } from "lucide-react";

import { LogoText } from "@/components/custom/logo/logo-text";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarBrand() {
  const { toggleSidebar } = useSidebar();

  return (
    <div className="flex h-7 w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <div className="flex min-w-0 flex-1 items-center group-data-[collapsible=icon]:hidden">
        <LogoText className="h-4.5 w-auto max-w-28 text-sidebar-foreground" />
      </div>
      <SidebarBrandToggle
        ariaLabel="Toggle sidebar"
        className="group-data-[collapsible=icon]:hidden"
        onClick={toggleSidebar}
      >
        <PanelLeftIcon className="size-4" />
      </SidebarBrandToggle>
      <SidebarBrandToggle
        ariaLabel="Open sidebar"
        className="relative hidden group-data-[collapsible=icon]:flex"
        onClick={toggleSidebar}
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 group-hover:opacity-0">
          <Image
            src="/apple-icon.png"
            alt=""
            aria-hidden="true"
            width={180}
            height={180}
            className="size-6 rounded-md"
            priority
          />
        </span>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <PanelLeftIcon className="size-4" />
        </span>
      </SidebarBrandToggle>
    </div>
  );
}

function SidebarBrandToggle({
  ariaLabel,
  className,
  children,
  onClick,
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-sidebar="trigger"
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/72 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring",
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
