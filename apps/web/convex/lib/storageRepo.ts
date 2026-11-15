import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_ATTACHMENT_SIZE } from "./constants";

type Ctx = QueryCtx | MutationCtx;

/**
 * Cross-domain reads over every table that points at `_storage` (OS-1901).
 * Task and thread attachments keep separate pending tables, but the blob is
 * shared, so ownership and deletion decisions must see all of them.
 * Spec: docs/specs/task-attachments.md#storage-ownership-os-1901.
 */

// cliWorktreeOps: a worktree download's blob while its op row lives (OS-2050).
// checkResultFiles: check evidence outlives its thread (docs/specs/task-checks.md).
const REFERENCE_TABLES = [
  "taskAttachments",
  "taskCommentAttachments",
  "cliMessageAttachmentRefs",
  "cliWorktreeOps",
  "checkResultFiles",
] as const;
const PENDING_TABLES = ["taskAttachmentPendingUploads", "cliMessagePendingUploads"] as const;

async function anyRowByStorageId(
  ctx: Ctx,
  tables: readonly (typeof REFERENCE_TABLES[number] | typeof PENDING_TABLES[number])[],
  storageId: Id<"_storage">
): Promise<boolean> {
  const rows = await Promise.all(
    tables.map((table) =>
      ctx.db
        .query(table)
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first()
    )
  );
  return rows.some((row) => row !== null);
}

/** Stored size of a blob in bytes, or null when it no longer exists. */
export async function getStorageSize(ctx: Ctx, storageId: Id<"_storage">): Promise<number | null> {
  const blob = await ctx.db.system.get("_storage", storageId);
  return blob?.size ?? null;
}

/** Delete an unclaimed blob over the attachment cap; true when deleted (OS-1676). Never throws, so the delete commits. */
export async function deleteStorageIfOversized(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const size = await getStorageSize(ctx, storageId);
  if (size === null || size <= MAX_ATTACHMENT_SIZE) return false;
  await ctx.storage.delete(storageId);
  return true;
}

/** True when an attachment record in any family points at the blob. */
export async function isStorageReferenced(ctx: Ctx, storageId: Id<"_storage">): Promise<boolean> {
  return anyRowByStorageId(ctx, REFERENCE_TABLES, storageId);
}

/** True when the blob is referenced or registered as pending by anyone, in either family. */
export async function isStorageClaimed(ctx: Ctx, storageId: Id<"_storage">): Promise<boolean> {
  return anyRowByStorageId(ctx, [...REFERENCE_TABLES, ...PENDING_TABLES], storageId);
}

/** Delete the blob unless an attachment record in any family still points at it. */
export async function deleteStorageIfUnreferenced(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  if (await isStorageReferenced(ctx, storageId)) return;
  await ctx.storage.delete(storageId);
}
