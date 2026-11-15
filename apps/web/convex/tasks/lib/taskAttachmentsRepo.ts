import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getTaskAttachmentById(
  ctx: Ctx,
  attachmentId: Id<"taskAttachments">
): Promise<Doc<"taskAttachments"> | null> {
  return ctx.db.get("taskAttachments", attachmentId);
}

/** All attachments for a task, via the `by_task` index. */
export async function listTaskAttachmentsByTaskId(
  ctx: Ctx,
  taskId: Id<"tasks">
): Promise<Doc<"taskAttachments">[]> {
  return ctx.db
    .query("taskAttachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
}

/**
 * Insert an attachment, stamping `uploadedBy`/`uploadedAt` so callers pass only
 * the user-supplied props.
 */
export async function insertTaskAttachment(
  ctx: MutationCtx,
  props: {
    taskId: Id<"tasks">;
    storageId: Id<"_storage">;
    fileName: string;
    fileSize: number;
    contentType: string;
  },
  uploadedBy: Id<"users">
): Promise<Id<"taskAttachments">> {
  return ctx.db.insert("taskAttachments", {
    ...props,
    uploadedBy,
    uploadedAt: Date.now(),
  });
}

/** Re-own an attachment. The stored file is untouched — only the row moves. */
export async function moveTaskAttachmentToTask(
  ctx: MutationCtx,
  attachmentId: Id<"taskAttachments">,
  taskId: Id<"tasks">
): Promise<void> {
  await ctx.db.patch("taskAttachments", attachmentId, { taskId });
}

export async function deleteTaskAttachment(
  ctx: MutationCtx,
  attachmentId: Id<"taskAttachments">
): Promise<void> {
  await ctx.db.delete("taskAttachments", attachmentId);
}
