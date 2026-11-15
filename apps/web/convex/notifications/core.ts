import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedUser, getOptionalAuthenticatedAccess } from "../lib/access/auth";
import { getAccessibleProjectsById } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { EMPTY_PAGE } from "../lib/shared/pagination";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { getActiveOrganizationsByIds } from "../organizations/lib/organizationsRepo";
import { getUsersByIds } from "../users/lib/usersRepo";
import { errors } from "./errors";
import { isChannelEnabled } from "./lib/preferences";
import { listPreferencesByUser } from "./lib/notificationPreferencesRepo";
import {
  MARK_ALL_READ_BATCH,
  NOTIFICATION_RETENTION_MS,
  RETENTION_SWEEP_BATCH,
  TOAST_RECENT_LIMIT,
  TOAST_RECENT_SCAN_LIMIT,
  UNREAD_COUNT_CAP,
} from "./lib/constants";
import { notificationFeedItemValidator } from "./lib/validators";
import {
  deleteNotification,
  getNotificationById,
  listNotificationsOlderThan,
  markNotificationRead,
  markNotificationUnread,
  paginateNotificationsByUserInOrg,
  takeRecentByUserInOrg,
  takeUnreadByUserInOrg,
} from "./lib/notificationsRepo";

type FeedItem = Doc<"notifications"> & {
  orgSlug?: string;
  projectAlias?: string;
  actorAvatarUrl?: string;
};

/**
 * Enrich rows for rendering (docs/specs/notifications.md). Nothing is hidden: rows
 * the recipient can no longer view come back without orgSlug/projectAlias and render
 * as "No access". Everything else renders from the frozen snapshot — no task reads, so
 * the feed only recomputes when notifications, access, or avatars change.
 */
async function toFeedItems(
  ctx: QueryCtx,
  userId: Id<"users">,
  rows: Doc<"notifications">[]
): Promise<FeedItem[]> {
  // The link must match what its destination enforces: task rows deep-link to the task
  // view (TASK_VIEW), thread rows to thread detail (CLI_THREAD) — so a project viewer
  // keeps task links but gets "No access" thread rows.
  const idsForKind = (kind: Doc<"notifications">["subject"]["kind"]) => [
    ...new Set(rows.filter((row) => row.subject.kind === kind).map((row) => row.projectId)),
  ];
  const [taskProjectById, threadProjectById] = await Promise.all([
    getAccessibleProjectsById(ctx, userId, idsForKind("task"), ProjectPermission.TASK_VIEW),
    getAccessibleProjectsById(ctx, userId, idsForKind("thread"), ProjectPermission.CLI_THREAD),
  ]);
  const projectFor = (row: Doc<"notifications">) =>
    (row.subject.kind === "thread" ? threadProjectById : taskProjectById).get(row.projectId);

  const withOrg = await join(rows)
    .on((row) => projectFor(row)?.organizationId)
    .with((ids) => getActiveOrganizationsByIds(ctx, ids))
    .selectAll((row, org) => ({ row, org }));

  return join(withOrg)
    .on(({ row }) => row.actorUserId)
    .with((ids) => getUsersByIds(ctx, ids))
    .selectAll(({ row, org }, actor) => {
      const project = projectFor(row);
      return {
        ...row,
        ...(project && org ? { orgSlug: org.slug, projectAlias: project.alias } : {}),
        ...(actor?.avatarUrl !== undefined ? { actorAvatarUrl: actor.avatarUrl } : {}),
      };
    });
}

/**
 * Inbox feed for one organization, newest first. `unreadOnly` backs the UI's
 * all/unread switch; both variants paginate. Every read here is scoped to the
 * caller's rows, so `organizationId` can only narrow the caller's own feed —
 * no membership check needed (docs/specs/notifications.md).
 */
export const list = query({
  args: {
    organizationId: v.id("organizations"),
    unreadOnly: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(notificationFeedItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) {
      return EMPTY_PAGE;
    }
    const results = await paginateNotificationsByUserInOrg(
      ctx,
      auth.user._id,
      args.organizationId,
      args.unreadOnly ?? false,
      args.paginationOpts
    );
    return {
      ...results,
      page: await toFeedItems(ctx, auth.user._id, results.page),
    };
  },
});

/**
 * Toast channel feed (docs/specs/notifications.md): the newest few rows, enriched like
 * the inbox, minus types with `toast` disabled (the row still exists for the inbox).
 * The scan over-fetches so muted rows can't starve the window. `watermark` is the
 * newest row's creation time *before* filtering, so a muted row still advances the
 * client cursor and re-enabling its type can't replay it.
 */
export const recent = query({
  args: { organizationId: v.id("organizations") },
  returns: v.object({
    items: v.array(notificationFeedItemValidator),
    watermark: v.number(),
  }),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) {
      return { items: [], watermark: 0 };
    }
    const [rows, preferences] = await Promise.all([
      takeRecentByUserInOrg(ctx, auth.user._id, args.organizationId, TOAST_RECENT_SCAN_LIMIT),
      listPreferencesByUser(ctx, auth.user._id),
    ]);
    const toastable = rows
      .filter((row) => isChannelEnabled(preferences, row.type, "toast"))
      .slice(0, TOAST_RECENT_LIMIT);
    return {
      items: await toFeedItems(ctx, auth.user._id, toastable),
      watermark: rows[0]?._creationTime ?? 0,
    };
  },
});

/**
 * Unread badge count: one bounded indexed read, nothing joined — the list
 * shows every row (access lost or not), so the raw count always matches it.
 * Bounded by UNREAD_COUNT_CAP — the UI renders the cap as "99+".
 */
export const unreadCount = query({
  args: { organizationId: v.id("organizations") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) {
      return 0;
    }
    const unread = await takeUnreadByUserInOrg(ctx, auth.user._id, args.organizationId, UNREAD_COUNT_CAP);
    return unread.length;
  },
});

/** Mark one own notification read. Missing rows are a no-op (idempotent). */
export const markRead = mutation({
  args: { id: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const notification = await getNotificationById(ctx, args.id);
    if (!notification) {
      return null;
    }
    ensure(notification.userId).eq(user._id, errors.NOTIFICATION_NOT_FOUND);
    if (!notification.read) {
      await markNotificationRead(ctx, args.id);
    }
    return null;
  },
});

/** Mark one own notification unread again. Missing rows are a no-op. */
export const markUnread = mutation({
  args: { id: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const notification = await getNotificationById(ctx, args.id);
    if (!notification) {
      return null;
    }
    ensure(notification.userId).eq(user._id, errors.NOTIFICATION_NOT_FOUND);
    if (notification.read) {
      await markNotificationUnread(ctx, args.id);
    }
    return null;
  },
});

/**
 * Mark unread notifications of one user read, one bounded batch at a time.
 * The unread index is the cursor: marked rows fall out of the query, so a
 * full batch just re-takes until it drains. Same shape as retentionSweep.
 */
async function markAllAsReadBatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">
): Promise<void> {
  const unread = await takeUnreadByUserInOrg(ctx, userId, organizationId, MARK_ALL_READ_BATCH);
  for (const notification of unread) {
    await markNotificationRead(ctx, notification._id);
  }
  if (unread.length === MARK_ALL_READ_BATCH) {
    await ctx.scheduler.runAfter(0, internal.notifications.core.markAllAsReadSweep, {
      userId,
      organizationId,
    });
  }
}

/**
 * Mark every unread notification of the caller in one organization read —
 * scoped like the list it clears, so another org's badge stays untouched.
 * The first batch runs synchronously so the badge reacts instantly; a rare
 * overflow (>MARK_ALL_READ_BATCH unread) drains via scheduled sweeps, so the
 * flip is not atomic across batches — fine for notifications.
 */
export const markAllAsRead = mutation({
  args: { organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await markAllAsReadBatch(ctx, user._id, args.organizationId);
    return null;
  },
});

/** Background continuation of markAllAsRead; reschedules itself until drained. */
export const markAllAsReadSweep = internalMutation({
  args: { userId: v.id("users"), organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await markAllAsReadBatch(ctx, args.userId, args.organizationId);
    return null;
  },
});

/**
 * Daily cron target (convex/crons.ts): delete notifications older than the
 * retention window, read or not, in bounded batches. A full batch means more
 * may remain, so it reschedules itself immediately.
 */
export const retentionSweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
    const expired = await listNotificationsOlderThan(ctx, cutoff, RETENTION_SWEEP_BATCH);
    for (const row of expired) {
      await deleteNotification(ctx, row._id);
    }
    if (expired.length === RETENTION_SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.notifications.core.retentionSweep, {});
    }
    return null;
  },
});
