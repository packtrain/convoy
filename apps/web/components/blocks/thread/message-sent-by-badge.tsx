"use client";

import { CornerDownLeft } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { AppLink } from "@/lib/navigation/app-link";
import { appRoute } from "@/lib/navigation/routes";

const LABEL = "Sent by another thread's agent. Click to open";

interface MessageSentByBadgeProps {
  /** The thread whose agent posted this message (`sentBy.threadId`). */
  threadId: Id<"cliThreads">;
  organizationSlug: string;
  projectAlias: string;
}

/**
 * "Another agent sent this" (OS-1631). The link is optimistic — a deleted sender
 * lands on the thread route's own not-found, which beats a read per message.
 * `sentBy` is same-project by construction, so the current slugs address it.
 */
export function MessageSentByBadge({
  threadId,
  organizationSlug,
  projectAlias,
}: MessageSentByBadgeProps) {
  return (
    <AppLink
      href={appRoute.projectThreadDetail(organizationSlug, projectAlias, String(threadId))}
      // Negative margin keeps the icon-only hit target comfortable without
      // growing the footer row.
      className="-m-1 flex cursor-pointer items-center p-1 text-muted-foreground hover:text-foreground"
      aria-label={LABEL}
      title={LABEL}
    >
      <CornerDownLeft className="size-3.5" />
    </AppLink>
  );
}
