"use client";

import { useId } from "react";
import { Settings, Clock, CalendarPlus, ListChecks, PanelLeftClose, Share2 } from "lucide-react";
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
   * Opens the shared-threads view (OS-1576). Desktop sidebar only, like
   * multiselect; the mobile panel omits it.
   */
  onViewSharedThreads?: () => void;
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
  onViewSharedThreads,
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

        {(onEnableMultiSelect || onViewSharedThreads) && (
          <DropdownMenuSeparator />
        )}
        {onViewSharedThreads && (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={onViewSharedThreads}
          >
            <Share2 className="size-4" />
            Shared threads
          </DropdownMenuItem>
        )}
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
