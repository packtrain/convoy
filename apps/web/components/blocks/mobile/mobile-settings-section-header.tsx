"use client";

import { ChevronDown } from "lucide-react";
import type { SubpageNavigationItem } from "@/components/custom/subpage-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppLink } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface MobileSettingsSectionHeaderProps {
  title: string;
  items: SubpageNavigationItem[];
  className?: string;
}

/**
 * Mobile-only settings section switcher: the current section name rendered as
 * a tappable page title that opens the section list (spec:
 * docs/specs/mobile-bottom-nav.md). Desktop keeps the split sub-sidebar.
 */
export function MobileSettingsSectionHeader({
  title,
  items,
  className,
}: MobileSettingsSectionHeaderProps) {
  return (
    <div className={cn("md:hidden", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch settings section"
            className="flex cursor-pointer items-center gap-1.5 text-2xl font-semibold tracking-tight text-foreground"
          >
            <span className="truncate">{title}</span>
            <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {items.map((item) => {
            const Icon = item.icon;

            if (item.disabled) {
              return (
                <DropdownMenuItem key={item.id} disabled>
                  <Icon className="size-4 text-muted-foreground" />
                  {item.label}
                </DropdownMenuItem>
              );
            }

            return (
              <DropdownMenuItem key={item.id} asChild>
                <AppLink
                  href={item.href}
                  aria-current={item.isActive ? "page" : undefined}
                  className={cn(item.isActive && "bg-muted font-medium")}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {item.label}
                </AppLink>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
