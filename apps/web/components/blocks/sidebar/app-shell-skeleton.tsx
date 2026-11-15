"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { NavItemsSkeleton } from "./nav-section";

/** Org layout placeholder: the sidebar's brand and nav rows beside an empty inset. */
export function AppShellSkeleton() {
  return (
    <SidebarProvider aria-label="Loading workspace">
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-3 py-3.5">
          <div className="flex h-7 items-center px-2">
            <Skeleton className="h-4.5 w-24 rounded-sm" />
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-6 py-2">
          <NavItemsSkeleton count={4} />
          <NavItemsSkeleton count={3} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset />
    </SidebarProvider>
  );
}
