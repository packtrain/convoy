"use client";

import { Share2 } from "lucide-react";
import { ARCHIVED_TASK_LIST_ICON_CLASS } from "@/components/blocks/project/task-lists/task-list-identity";
import { cn } from "@/lib/utils";

/**
 * Icon-only marker for a thread row shared read-only with the project (OS-1576). Follows
 * `ThreadPrBadge`'s placement and its two concessions:
 *
 * `pointer-events-auto` opts back out of the row body's `pointer-events-none`, without
 * which hit-testing skips the badge and `title` — the only thing explaining the glyph —
 * never fires. It costs the same ~14px dead zone in the overlay link the PR badge pays.
 *
 * `role="img"` is what carries `aria-label`: ARIA ignores the label on a role-less
 * element, and the icon is `aria-hidden`, so without it the badge has no accessible name.
 *
 * Colour comes from the same constant as the header's Shared pill so the two cannot drift.
 */
export function ThreadSharedRowBadge({ className }: { className?: string }) {
  return (
    <span
      role="img"
      title="Shared with project"
      aria-label="Shared with project"
      className={cn(
        "pointer-events-auto inline-flex shrink-0 items-center",
        ARCHIVED_TASK_LIST_ICON_CLASS,
        className
      )}
    >
      <Share2 aria-hidden className="size-3.5" />
    </span>
  );
}
