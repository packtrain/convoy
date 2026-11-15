"use client";

import { Activity, ArrowDownWideNarrow, ListFilter, MessageSquare, MessageSquareMore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import { cn } from "@/lib/utils";

/**
 * The timeline's filter and sort controls (OS-1591, `docs/specs/task-timeline.md`).
 *
 * The source rows carry the icons the retired `Comments` / `Threads` / `All activity`
 * tabs used, so with all but one source off this reconstructs the tab it replaced —
 * which is what makes the timeline a strict superset.
 */

/** Ordered as the stream presents them, not as the validator declares them. */
const SOURCE_ROWS: Array<{
  key: keyof TimelineSources;
  label: string;
  icon: typeof MessageSquare;
}> = [
  { key: "comments", label: "Comments", icon: MessageSquare },
  { key: "threads", label: "Threads", icon: MessageSquareMore },
  { key: "activity", label: "Activity", icon: Activity },
];

const SORT_LABELS: Record<TimelineSortDirection, string> = {
  asc: "Oldest first",
  desc: "Newest first",
};

export function TimelineHeader({
  sources,
  sortDirection,
  onToggleSource,
  onSortDirectionChange,
  hasThreadSource,
}: {
  sources: TimelineSources;
  sortDirection: TimelineSortDirection;
  onToggleSource: (source: keyof TimelineSources, enabled: boolean) => void;
  onSortDirectionChange: (direction: TimelineSortDirection) => void;
  /**
   * False outside a project route, where thread rows cannot build an href. The
   * threads row is hidden rather than shown disabled — there is nothing the
   * viewer could do about it here.
   */
  hasThreadSource: boolean;
}) {
  const rows = hasThreadSource ? SOURCE_ROWS : SOURCE_ROWS.filter((row) => row.key !== "threads");

  // Only the sources the viewer can actually see count as "filtered": outside a
  // project route `sources.threads` may be stored off, and flagging the menu for
  // a source that isn't offered would mark it filtered with nothing to restore.
  const isFiltered = rows.some((row) => !sources[row.key]);

  return (
    <div className="flex items-center justify-between px-4 py-2">
      <h3 className="text-sm font-medium text-foreground">Activity</h3>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "cursor-pointer text-muted-foreground hover:text-foreground",
                // Without this a narrowed feed just looks short — the viewer has
                // no way to tell a quiet task from one they filtered.
                isFiltered && "bg-accent text-foreground"
              )}
              aria-label={isFiltered ? "Filter timeline (filtered)" : "Filter timeline"}
              title="Filter timeline"
            >
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            {rows.map(({ key, label, icon: Icon }) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={sources[key]}
                // Independent checkboxes, not a mode switch: a radio group
                // cannot express "comments + threads, activity off". All-off is
                // allowed and renders its own empty state.
                onCheckedChange={(checked) => onToggleSource(key, checked === true)}
                className="cursor-pointer"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                {label}
              </DropdownMenuCheckboxItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuLabel className="flex items-center gap-2">
              <ArrowDownWideNarrow className="size-3.5 shrink-0 text-muted-foreground" />
              Sort
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortDirection}
              onValueChange={(value) => onSortDirectionChange(value as TimelineSortDirection)}
            >
              {(Object.keys(SORT_LABELS) as TimelineSortDirection[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key} className="cursor-pointer">
                  {SORT_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
