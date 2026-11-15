import type { PaginationOptions, PaginationResult } from "convex/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { NotificationType } from "../../lib/contracts/notifications";

type Ctx = QueryCtx | MutationCtx;

/**
 * `organizationId` is optional in the schema (legacy rows) but required here:
 * every read is org-scoped, so a row written without one is invisible forever.
 */
export async function insertNotification(
  ctx: MutationCtx,
  row: Omit<Doc<"notifications">, "_id" | "_creationTime"> & { organizationId: Id<"organizations"> }
): Promise<Id<"notifications">> {
  return await ctx.db.insert("notifications", row);
}

export async function getNotificationById(
  ctx: Ctx,
  id: Id<"notifications">
): Promise<Doc<"notifications"> | null> {
  return await ctx.db.get("notifications", id);
}

/** Coalescing lookup: unread notifications for one (recipient, type, subject). */
export async function listUnreadByUserTypeAndSubject(
  ctx: Ctx,
  userId: Id<"users">,
  type: NotificationType,
  subjectId: Id<"tasks"> | Id<"cliThreads">
): Promise<Doc<"notifications">[]> {
  return await ctx.db
    .query("notifications")
    .withIndex("by_user_and_type_and_subjectId_and_read", (q) =>
      q.eq("userId", userId).eq("type", type).eq("subject.id", subjectId).eq("read", false)
    )
    .collect();
}

/** Newest rows regardless of read state (toast channel) — bounded by `limit`. */
export async function takeRecentByUserInOrg(
  ctx: Ctx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  limit: number
): Promise<Doc<"notifications">[]> {
  return await ctx.db
    .query("notifications")
    .withIndex("by_user_and_org", (q) => q.eq("userId", userId).eq("organizationId", organizationId))
    .order("desc")
    .take(limit);
}

/** Bounded unread read (badge count, mark-all batches) — never scans past `limit` rows. */
export async function takeUnreadByUserInOrg(
  ctx: Ctx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  limit: number
): Promise<Doc<"notifications">[]> {
  return await ctx.db
    .query("notifications")
    .withIndex("by_user_and_org_and_read", (q) =>
      q.eq("userId", userId).eq("organizationId", organizationId).eq("read", false)
    )
    .take(limit);
}

/** Newest first; unreadOnly switches to the read-flag index. */
export async function paginateNotificationsByUserInOrg(
  ctx: Ctx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
  unreadOnly: boolean,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"notifications">>> {
  if (unreadOnly) {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_and_org_and_read", (q) =>
        q.eq("userId", userId).eq("organizationId", organizationId).eq("read", false)
      )
      .order("desc")
      .paginate(paginationOpts);
  }
  return await ctx.db
    .query("notifications")
    .withIndex("by_user_and_org", (q) => q.eq("userId", userId).eq("organizationId", organizationId))
    .order("desc")
    .paginate(paginationOpts);
}

export async function markNotificationRead(ctx: MutationCtx, id: Id<"notifications">): Promise<void> {
  await ctx.db.patch("notifications", id, { read: true, readAt: Date.now() });
}

export async function markNotificationUnread(ctx: MutationCtx, id: Id<"notifications">): Promise<void> {
  await ctx.db.patch("notifications", id, { read: false, readAt: undefined });
}

export async function listNotificationsOlderThan(
  ctx: Ctx,
  cutoff: number,
  limit: number
): Promise<Doc<"notifications">[]> {
  return await ctx.db
    .query("notifications")
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
    .take(limit);
}

export async function deleteNotification(ctx: MutationCtx, id: Id<"notifications">): Promise<void> {
  await ctx.db.delete("notifications", id);
}
