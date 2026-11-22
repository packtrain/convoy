"use client";

import { useId } from "react";
import { Settings, Clock, CalendarPlus, Layers, ListChecks, PanelLeftClose, Share2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THREAD_LIST_TOGGLE_HOTKEY } from "@/lib/browser/hotkeys";
import { MenuShortcut } from "@/components/blocks/tasks/task-action-menu-items";
import { Switch } from "@/components/ui/switch";
import type { ThreadSortBy } from "@/convex/lib/contracts/validators";
import type { ThreadSidebarView } from "@/lib/threads/hooks/use-sidebar-view-threads";

/** The views the settings menu opens, in menu order (OS-1576, OS-2513). */
export const THREAD_SIDEBAR_VIEWS: Record<
  ThreadSidebarView,
  { icon: LucideIcon; label: string; emptyTitle: string; emptyDescription: string }
> = {
  shared: {
    icon: Share2,
    label: "Shared threads",
    emptyTitle: "No shared threads",
    emptyDescription: "Threads you share with your project appear here.",
  },
  background: {
    icon: Layers,
    label: "Background threads",
    emptyTitle: "No background threads",
    emptyDescription: "Guide and checks runs you start on a pull request appear here.",
  },
};

const SORT_OPTIONS: {
  value: ThreadSortBy;
  label: string;
  icon: typeof Clock;
}[] = [
  { value: "lastActivity", label: "Last activity", icon: Clock },
  { value: "created", label: "Created", icon: CalendarPlus },
];

interface ThreadSidebarSettingsProps {
  sortBy: ThreadSortBy;
  compactLayout: boolean;
  groupDone: boolean;
  onSortByChange: (sortBy: ThreadSortBy) => void;
  onCompactLayoutChange: (compact: boolean) => void;
  onGroupDoneChange: (group: boolean) => void;
  /**
   * Enables the "Select multiple" entry (OS-1249). Only the desktop sidebar
   * provides it; the shared mobile panel omits it so mobile has no multiselect.
   */
  onEnableMultiSelect?: () => void;
  /**
   * Opens a separate view, Shared or Background threads. Desktop sidebar
   * only, like multiselect; the mobile panel omits it.
   */
  onOpenView?: (view: ThreadSidebarView) => void;
  /** Collapses the thread list (desktop only; the mobile panel omits it). */
  onHideList?: () => void;
}

export function ThreadSidebarSettings({
  sortBy,
  compactLayout,
  groupDone,
  onSortByChange,
  onCompactLayoutChange,
  onGroupDoneChange,
  onEnableMultiSelect,
  onOpenView,
  onHideList,
}: ThreadSidebarSettingsProps) {
  const compactLayoutId = useId();
  const groupDoneId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Thread list settings">
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onHideList && (
          <>
            <DropdownMenuItem className="cursor-pointer" onSelect={onHideList}>
              <PanelLeftClose className="size-4" />
              Hide thread list
              <MenuShortcut hotkey={THREAD_LIST_TOGGLE_HOTKEY} />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <label htmlFor={compactLayoutId} className="cursor-pointer">Compact layout</label>
          <Switch
            id={compactLayoutId}
            size="sm"
            checked={compactLayout}
            onCheckedChange={onCompactLayoutChange}
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          <label htmlFor={groupDoneId} className="cursor-pointer">Group done threads</label>
          <Switch
            id={groupDoneId}
            size="sm"
            checked={groupDone}
            onCheckedChange={onGroupDoneChange}
          />
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as ThreadSortBy)}
        >
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {(onEnableMultiSelect || onOpenView) && (
          <DropdownMenuSeparator />
        )}
        {onOpenView &&
          (Object.keys(THREAD_SIDEBAR_VIEWS) as ThreadSidebarView[]).map((view) => {
            const { icon: Icon, label } = THREAD_SIDEBAR_VIEWS[view];
            return (
              <DropdownMenuItem
                key={view}
                className="cursor-pointer"
                onSelect={() => onOpenView(view)}
              >
                <Icon className="size-4" />
                {label}
              </DropdownMenuItem>
            );
          })}
        {onEnableMultiSelect && (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={onEnableMultiSelect}
          >
            <ListChecks className="size-4" />
            Select multiple
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
