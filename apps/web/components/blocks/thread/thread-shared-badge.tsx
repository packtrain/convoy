"use client";

import { Eye, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  ARCHIVED_TASK_LIST_ICON_CLASS,
  ARCHIVED_TASK_LIST_TRIGGER_CLASS,
} from "@/components/blocks/project/task-lists/task-list-identity";
import { copyThreadShareLink } from "@/lib/threads/share-link";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

// Sized and coloured to match the header's Archived pill — the app's existing "this view is in a
// special mode" affordance. The default Badge is `h-5`/`text-xs`, which reads as incidental
// metadata next to it. Colour comes from the shared constants so the two cannot drift.
const PILL_CLASS = cn(
  "h-7 gap-1.5 px-2.5 text-[0.8rem] leading-4 [&>svg]:size-3.5!",
  "border-transparent",
  ARCHIVED_TASK_LIST_TRIGGER_CLASS
);

/**
 * Says why the thread header looks the way it does (OS-1575):
 *
 * - **Viewer** — "Read-only". Without it the missing composer reads as a broken page.
 * - **Owner of a shared thread** — "Shared", and clicking copies the link.
 *
 * Nothing for the ordinary case (owner, not shared). The *list row* badge is a separate
 * surface (OS-1576).
 */
export function ThreadSharedBadge({
  threadId,
  readOnly,
  sharedAt,
  scope = "thread",
  organizationSlug,
  projectAlias,
}: {
  /** What the link points at: the thread, or the container of a shared group. */
  threadId: Id<"cliThreads">;
  /** The host's own `chat.isOwner === false`, so the two never disagree. */
  readOnly: boolean;
  sharedAt: number | undefined;
  /**
   * A group is shared as a unit (OS-1579), so every tab in it reads "Shared"
   * and copies the group's link — only the wording changes.
   */
  scope?: "thread" | "group";
  organizationSlug: string;
  projectAlias: string;
}) {
  if (readOnly) {
    return (
      <TooltipExt
        content={
          scope === "group"
            ? "Shared with you by the group's owner — you can watch but not reply"
            : "Shared with you by the thread owner — you can watch but not reply"
        }
      >
        {/* Re-pins hover to the resting colour: this pill is pure status, and
            the Archived trigger's hover shift would imply it is clickable. */}
        <Badge
          variant="outline"
          className={cn(
            PILL_CLASS,
            "self-center hover:bg-amber-50 dark:hover:bg-amber-950/40"
          )}
        >
          <Eye aria-hidden className={ARCHIVED_TASK_LIST_ICON_CLASS} />
          Read-only
        </Badge>
      </TooltipExt>
    );
  }

  if (sharedAt === undefined) {
    return null;
  }

  return (
    <TooltipExt
      content={
        scope === "group"
          ? "Anyone on this project can open this group — click to copy the link"
          : "Anyone on this project can open this thread — click to copy the link"
      }
    >
      {/* A real button, not a `role="button"` span: this is the header's only
          copy affordance, and a span takes focus without responding to
          Enter/Space. */}
      <Badge
        asChild
        variant="outline"
        className={cn(PILL_CLASS, "cursor-pointer self-center")}
      >
        <button
          type="button"
          onClick={() =>
            void copyThreadShareLink(organizationSlug, projectAlias, threadId, {
              success: "Link copied — anyone on this project can open it",
            })
          }
        >
          <Share2 aria-hidden className={ARCHIVED_TASK_LIST_ICON_CLASS} />
          Shared
        </button>
      </Badge>
    </TooltipExt>
  );
}
