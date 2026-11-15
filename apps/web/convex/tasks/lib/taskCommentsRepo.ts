import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getTaskCommentById(
  ctx: Ctx,
  commentId: Id<"taskComments">
): Promise<Doc<"taskComments"> | null> {
  return ctx.db.get("taskComments", commentId);
}

/**
 * Comments for a task, newest first, paginated via the
 * `by_task_and_createdAt` index.
 */
export async function paginateTaskCommentsByTask(
  ctx: Ctx,
  taskId: Id<"tasks">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"taskComments">>> {
  return ctx.db
    .query("taskComments")
    .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
    .order("desc")
    .paginate(paginationOpts);
}

/**
 * Newest-first page of a task's comments, resuming strictly after a
 * `(createdAt, _creationTime)` position. Backs the merged timeline's hand-rolled
 * cursor, with the two-read boundary handling `takeTaskActivityLogsByTaskBefore`
 * documents.
 */
export async function takeTaskCommentsByTaskBefore(
  ctx: Ctx,
  taskId: Id<"tasks">,
  before: { at: number; creationTime: number } | undefined,
  limit: number
): Promise<Doc<"taskComments">[]> {
  if (before === undefined) {
    return ctx.db
      .query("taskComments")
      .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(limit);
  }

  const boundaryRemainder = await ctx.db
    .query("taskComments")
    .withIndex("by_task_and_createdAt", (q) =>
      q.eq("taskId", taskId).eq("createdAt", before.at).lt("_creationTime", before.creationTime)
    )
    .order("desc")
    .take(limit);

  if (boundaryRemainder.length >= limit) {
    return boundaryRemainder;
  }

  const older = await ctx.db
    .query("taskComments")
    .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId).lt("createdAt", before.at))
    .order("desc")
    .take(limit - boundaryRemainder.length);

  return [...boundaryRemainder, ...older];
}

/**
 * Insert a comment, stamping `createdAt`/`updatedAt`/`isEdited` so callers pass
 * only the user-supplied props.
 */
export async function insertTaskComment(
  ctx: MutationCtx,
  props: { taskId: Id<"tasks">; content: string },
  authorId: Id<"users">
): Promise<Id<"taskComments">> {
  const now = Date.now();
  return ctx.db.insert("taskComments", {
    taskId: props.taskId,
    authorId,
    content: props.content,
    createdAt: now,
    updatedAt: now,
    isEdited: false,
  });
}

/**
 * Apply an author edit: replaces the content, stamps `updatedAt`, and marks the
 * comment edited so callers never repeat those fields.
 */
export async function updateTaskCommentContent(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
  content: string
): Promise<void> {
  await ctx.db.patch("taskComments", commentId, {
    content,
    updatedAt: Date.now(),
    isEdited: true,
  });
}

export async function deleteTaskComment(
  ctx: MutationCtx,
  commentId: Id<"taskComments">
): Promise<void> {
  await ctx.db.delete("taskComments", commentId);
}
