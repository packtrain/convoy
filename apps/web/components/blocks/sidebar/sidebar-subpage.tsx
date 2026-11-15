"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { AppLink, type RouteTarget } from "@/lib/navigation";
import type { SubpageNavigationItem } from "@/components/custom/subpage-navigation";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function SidebarSplitLayout({
  rail,
  subpage,
  split = true,
}: {
  rail: ReactNode;
  subpage: ReactNode;
  split?: boolean;
}) {
  return (
    <div className="flex size-full overflow-hidden">
      <div
        data-collapsible={split ? "icon" : undefined}
        className={cn(
          "group flex min-h-0 flex-col overflow-hidden",
          split
            ? "w-(--sidebar-width-icon) shrink-0 border-r border-sidebar-border transition-[width] duration-100 ease-linear motion-reduce:transition-none"
            : "w-full flex-1"
        )}
      >
        {rail}
      </div>
      {split && (
        <div className="flex min-w-0 flex-1 animate-in fade-in-0 slide-in-from-left-2 flex-col border-r border-sidebar-border duration-100 motion-reduce:animate-none">
          {subpage}
        </div>
      )}
    </div>
  );
}

export function SidebarSubpage({
  title,
  backHref,
  onBackClick,
  items,
}: {
  title: string;
  backHref: RouteTarget | string;
  onBackClick?: MouseEventHandler<HTMLAnchorElement>;
  items: SubpageNavigationItem[];
}) {
  return (
    <>
      <SidebarHeader className="gap-3 px-4 py-3">
        <div className="flex h-7 items-center gap-2">
          <AppLink
            href={backHref}
            aria-label={`Back from ${title}`}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring"
            onClick={onBackClick}
          >
            <ArrowLeft className="size-3.5" />
          </AppLink>
          <h2 className="truncate text-sm font-semibold text-sidebar-foreground">
            {title}
          </h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => {
                const Icon = item.icon;
                if (item.disabled) {
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        disabled
                        aria-disabled="true"
                        className="cursor-not-allowed"
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.isActive}
                      className={cn(
                        "cursor-pointer",
                        item.isActive && "font-medium"
                      )}
                    >
                      <AppLink href={item.href}>
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </AppLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}
