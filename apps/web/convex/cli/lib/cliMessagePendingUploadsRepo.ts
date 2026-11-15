import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for `cliMessagePendingUploads` — a secondary table owned by the
 * cliMessages domain that tracks storage blobs uploaded by a user before they
 * are referenced by a sent message, so abandoned blobs can be cleaned up.
 */

/** All pending-upload rows pointing at a storage blob (across users/projects). */
export async function listPendingUploadsByStorageId(ctx: Ctx, storageId: Id<"_storage">): Promise<Doc<"cliMessagePendingUploads">[]> {
  return ctx.db
    .query("cliMessagePendingUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .collect();
}

/** Oldest pending-upload rows created before `cutoff`, for the retention sweep. */
export async function listPendingUploadsOlderThan(ctx: Ctx, cutoff: number, limit: number): Promise<Doc<"cliMessagePendingUploads">[]> {
  return ctx.db
    .query("cliMessagePendingUploads")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
    .take(limit);
}

/** Insert a pending-upload ownership row, stamping `createdAt`. */
export async function insertPendingUpload(
  ctx: MutationCtx,
  props: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    storageId: Id<"_storage">;
  },
  now: number
): Promise<Id<"cliMessagePendingUploads">> {
  return ctx.db.insert("cliMessagePendingUploads", {
    ...props,
    createdAt: now,
  });
}

/** Refresh a pending-upload row's `createdAt` (keeps it from aging out). */
export async function touchPendingUpload(ctx: MutationCtx, rowId: Id<"cliMessagePendingUploads">, now: number): Promise<void> {
  await ctx.db.patch("cliMessagePendingUploads", rowId, { createdAt: now });
}

export async function deletePendingUpload(ctx: MutationCtx, rowId: Id<"cliMessagePendingUploads">): Promise<void> {
  await ctx.db.delete("cliMessagePendingUploads", rowId);
}
