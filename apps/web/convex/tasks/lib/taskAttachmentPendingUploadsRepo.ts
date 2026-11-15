import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** The caller's pending-upload row for a blob. Unique by construction: register no-ops on an owned row. */
export async function findOwnedTaskAttachmentPendingUpload(
  ctx: Ctx,
  userId: Id<"users">,
  storageId: Id<"_storage">
): Promise<Doc<"taskAttachmentPendingUploads"> | null> {
  const rows = await ctx.db
    .query("taskAttachmentPendingUploads")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .collect();
  return rows.find((row) => row.userId === userId) ?? null;
}

export async function insertTaskAttachmentPendingUpload(
  ctx: MutationCtx,
  props: { userId: Id<"users">; storageId: Id<"_storage"> }
): Promise<Id<"taskAttachmentPendingUploads">> {
  return ctx.db.insert("taskAttachmentPendingUploads", { ...props, createdAt: Date.now() });
}

export async function deleteTaskAttachmentPendingUpload(
  ctx: MutationCtx,
  rowId: Id<"taskAttachmentPendingUploads">
): Promise<void> {
  await ctx.db.delete("taskAttachmentPendingUploads", rowId);
}
