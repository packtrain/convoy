import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getTaskCommentAttachmentById(
  ctx: Ctx,
  attachmentId: Id<"taskCommentAttachments">
): Promise<Doc<"taskCommentAttachments"> | null> {
  return ctx.db.get("taskCommentAttachments", attachmentId);
}

/** All attachments for a single comment, via the `by_comment` index. */
export async function listTaskCommentAttachmentsByComment(
  ctx: Ctx,
  commentId: Id<"taskComments">
): Promise<Doc<"taskCommentAttachments">[]> {
  return ctx.db
    .query("taskCommentAttachments")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .collect();
}

/**
 * Attachments for several comments at once. Returns one array per comment,
 * aligned by index with `commentIds`.
 */
export async function listTaskCommentAttachmentsByCommentIds(
  ctx: Ctx,
  commentIds: Id<"taskComments">[]
): Promise<Doc<"taskCommentAttachments">[][]> {
  return Promise.all(commentIds.map((commentId) => listTaskCommentAttachmentsByComment(ctx, commentId)));
}

/** First attachment referencing a storage id, via the `by_storageId` index. */
export async function findTaskCommentAttachmentByStorageId(
  ctx: Ctx,
  storageId: Id<"_storage">
): Promise<Doc<"taskCommentAttachments"> | null> {
  return ctx.db
    .query("taskCommentAttachments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
    .first();
}

/**
 * Insert a comment attachment, stamping `uploadedBy`/`uploadedAt` so callers
 * pass only the user-supplied props.
 */
export async function insertTaskCommentAttachment(
  ctx: MutationCtx,
  props: {
    commentId: Id<"taskComments">;
    storageId: Id<"_storage">;
    fileName: string;
    fileSize: number;
    contentType: string;
  },
  uploadedBy: Id<"users">
): Promise<Id<"taskCommentAttachments">> {
  return ctx.db.insert("taskCommentAttachments", {
    ...props,
    uploadedBy,
    uploadedAt: Date.now(),
  });
}

export async function deleteTaskCommentAttachment(ctx: MutationCtx, attachmentId: Id<"taskCommentAttachments">): Promise<void> {
  await ctx.db.delete("taskCommentAttachments", attachmentId);
}
