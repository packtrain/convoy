import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** The caller's upload in this project, or null: someone else's never matches. */
export async function findOwnCommentFile(
  ctx: Ctx,
  { projectId, userId, storageId }: { projectId: Id<"projects">; userId: Id<"users">; storageId: Id<"_storage"> }
): Promise<Doc<"integrationCommentFiles"> | null> {
  const row = await ctx.db
    .query("integrationCommentFiles")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .unique();
  return row?.userId === userId && row.projectId === projectId ? row : null;
}

export async function insertCommentFile(ctx: MutationCtx, row: { projectId: Id<"projects">; userId: Id<"users">; storageId: Id<"_storage">; fileName: string; contentType: string }) {
  await ctx.db.insert("integrationCommentFiles", { ...row, createdAt: Date.now() });
}

/** Posted rows are never discarded. */
export async function markCommentFilePosted(ctx: MutationCtx, id: Id<"integrationCommentFiles">) {
  await ctx.db.patch("integrationCommentFiles", id, { postedAt: Date.now() });
}

export async function deleteCommentFile(ctx: MutationCtx, id: Id<"integrationCommentFiles">) {
  await ctx.db.delete("integrationCommentFiles", id);
}
