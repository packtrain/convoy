"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { appRoute, useNavigation, useNavigationLocation } from "@/lib/navigation";
import { CLI_TYPE_MAP, isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { claimNotificationDelivery } from "@/lib/notifications/delivery-storage";
import { playNotificationSound } from "@/lib/notifications/sound";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { assertNever } from "@/lib/type-guards";

type ToastFeedItem = FunctionReturnType<typeof api.notifications.core.recent>["items"][number];

/**
 * Toast headline. Task rows are plain "{actor} {verb}"; thread rows swap the
 * runtime name for its icon and dim the verb, so the thread title below is what
 * the eye lands on. A Project agent's own name still shows — the icon only
 * stands in for the generic runtime label.
 */
export function toastTitle(item: ToastFeedItem): React.ReactNode {
  const actorName = item.snapshot.actorName ?? "Someone";
  const cliType = item.snapshot.threadCliType;
  if (item.subject.kind !== "thread" || !isCliType(cliType)) {
    return `${actorName} ${toastVerb(item)}`;
  }
  // Runtimes without a registered icon (e.g. "other") keep the plain text form.
  const icon = renderCliIcon(cliType, "size-4 shrink-0");
  if (icon === null) {
    return `${actorName} ${toastVerb(item)}`;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {icon}
      {actorName === CLI_TYPE_MAP[cliType] ? null : <span className="truncate">{actorName}</span>}
      <span className="truncate text-muted-foreground">{toastVerb(item)}</span>
    </span>
  );
}

/** Plain-text verb with the task ref folded in, e.g. "moved OS-12 to Done". */
function toastVerb(item: ToastFeedItem): string {
  // Task events always snapshot a ref; the fallback is TS-only.
  const ref = item.snapshot.taskRef ?? "a task";
  switch (item.type) {
    case "task.created":
      return `created ${ref}`;
    case "task.status_changed":
      return item.snapshot.newStatus ? `moved ${ref} to ${item.snapshot.newStatus}` : `changed status of ${ref}`;
    case "task.completed":
      return item.snapshot.newStatus === "Canceled" ? `canceled ${ref}` : `completed ${ref}`;
    case "task.assignee_changed":
      return `reassigned ${ref}`;
    case "task.deleted":
      return `deleted ${ref}`;
    case "task.archived":
      return `archived ${ref}`;
    case "task.comment_added":
      return `commented on ${ref}`;
    case "thread.completed":
      return "finished a run";
    case "thread.failed":
      return "failed";
    case "thread.waiting_input":
      return "is waiting for your input";
    default:
      return assertNever(item.type);
  }
}

/**
 * How late a row may still be delivered. Past this it is history, not news: the
 * inbox has it (OS-1754).
 *
 * ponytail: the client clock decides, so a machine running minutes fast delivers
 * nothing. Two minutes swallows ordinary skew; if a real clock ever drifts that
 * far, detect the sleep from a monotonic heartbeat instead.
 */
export const MAX_DELIVERY_AGE_MS = 2 * 60_000;

/**
 * Rows newer than the cursor, oldest first so toasts stack in order. Rows a
 * user already read (readAt set, e.g. on another device) are skipped; rows
 * born read (toast-only: inApp off, no readAt) still toast — the toast is
 * their only delivery. Rows past `MAX_DELIVERY_AGE_MS` are dropped: the cursor
 * is per-tab, so a tab frozen since this morning would otherwise deliver every
 * row since as a burst the moment it thaws.
 */
export function freshToastItems<T extends { read: boolean; readAt?: number; _creationTime: number }>(
  items: T[],
  cursor: number,
  now: number
): T[] {
  return items
    .filter(
      (item) =>
        (!item.read || item.readAt === undefined) &&
        item._creationTime > cursor &&
        now - item._creationTime <= MAX_DELIVERY_AGE_MS
    )
    .reverse();
}

/**
 * Toast notification channel (docs/specs/notifications.md): renders nothing, watches the
 * reactive `recent` feed and fires a sonner toast per notification created after mount.
 * Rows present at mount are inbox backlog; unviewable rows are skipped. The org shell
 * keys this by org id, so a switch remounts it and the cursor re-snaps to the new
 * watermark instead of toasting that org's backlog.
 */
export function NotificationToasts() {
  const { organizationId } = useCurrentOrgProject();
  const feed = useQuery(api.notifications.core.recent, { organizationId });
  const { push } = useNavigation();
  const { pathname } = useNavigationLocation();
  const cursorRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (feed === undefined) {
      return;
    }
    // The cursor follows the server watermark, which covers toast-muted rows
    // too — re-enabling a muted type must not replay its old rows as toasts.
    if (cursorRef.current === null) {
      cursorRef.current = feed.watermark;
      return;
    }
    for (const item of freshToastItems(feed.items, cursorRef.current, Date.now())) {
      if (item.orgSlug === undefined || item.projectAlias === undefined) {
        continue;
      }
      const target =
        item.subject.kind === "thread"
          ? appRoute.projectThreadDetail(item.orgSlug, item.projectAlias, item.subject.id)
          : appRoute.projectTask(item.orgSlug, item.projectAlias, item.snapshot.taskRef ?? "");
      // The user is already looking at that thread — the reply is on screen.
      // A visible tab consumes the row, or a frozen sibling replays it on wake;
      // a hidden one leaves it for the tab the user is actually in.
      if (item.subject.kind === "thread" && pathname === target.pathname) {
        if (document.visibilityState === "visible") {
          claimNotificationDelivery("toast", item._id);
          claimNotificationDelivery("sound", item._id);
        }
        continue;
      }
      // Claimed once per row across tabs, so a tab frozen mid-run cannot replay
      // it on wake (OS-1754). The sound claims separately, below.
      if (claimNotificationDelivery("toast", item._id)) {
        toast(toastTitle(item), {
          id: item._id,
          description:
            item.subject.kind === "thread" ? (
              <>
                <span className="block truncate font-medium text-foreground">{item.snapshot.threadTitle}</span>
                {item.snapshot.threadMessage !== undefined && (
                  <span className="mt-0.5 line-clamp-2 block text-muted-foreground">{item.snapshot.threadMessage}</span>
                )}
              </>
            ) : (
              item.snapshot.taskTitle
            ),
          action: { label: "View", onClick: () => push(target) },
        });
      }
      // Agent runs only: an open thread already skipped above, so it stays
      // silent (OS-1754).
      if (item.subject.kind === "thread") {
        playNotificationSound(item.type, item._id);
      }
    }
    cursorRef.current = Math.max(cursorRef.current, feed.watermark);
  }, [feed, push, pathname]);

  return null;
}
