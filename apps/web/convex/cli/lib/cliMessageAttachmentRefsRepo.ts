import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { CliMessageRole } from "../../lib/contracts/validators";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for `cliMessageAttachmentRefs` — a secondary table owned by the
 * cliMessages domain that records which storage blobs are referenced by a sent
 * message, so the pending-upload cleanup can tell attached blobs from abandoned
 * ones.
 */

/** The first attachment ref pointing at a storage blob, or null if none. */
export async function getAttachmentRefByStorageId(ctx: Ctx, storageId: Id<"_storage">): Promise<Doc<"cliMessageAttachmentRefs"> | null> {
  return ctx.db
    .query("cliMessageAttachmentRefs")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
}

/** All attachment refs recorded for a message. */
export async function listAttachmentRefsByMessage(
  ctx: Ctx,
  messageId: Id<"cliMessages">
): Promise<Doc<"cliMessageAttachmentRefs">[]> {
  return ctx.db
    .query("cliMessageAttachmentRefs")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .collect();
}

/** A thread's newest attachment refs on `role` messages first, at most `limit`. */
export async function listRecentAttachmentRefsByThreadAndRole(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  role: CliMessageRole,
  limit: number
): Promise<Doc<"cliMessageAttachmentRefs">[]> {
  return ctx.db
    .query("cliMessageAttachmentRefs")
    .withIndex("by_threadId_and_role", (q) => q.eq("threadId", threadId).eq("role", role))
    .order("desc")
    .take(limit);
}

/** Delete an attachment ref row. */
export async function deleteAttachmentRef(ctx: MutationCtx, refId: Id<"cliMessageAttachmentRefs">): Promise<void> {
  await ctx.db.delete("cliMessageAttachmentRefs", refId);
}

/** Insert an attachment ref, stamping `createdAt`. */
export async function insertAttachmentRef(
  ctx: MutationCtx,
  props: {
    messageId: Id<"cliMessages">;
    threadId: Id<"cliThreads">;
    storageId: Id<"_storage">;
    role: CliMessageRole;
  },
  now: number
): Promise<Id<"cliMessageAttachmentRefs">> {
  return ctx.db.insert("cliMessageAttachmentRefs", {
    ...props,
    createdAt: now,
  });
}
