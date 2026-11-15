import type { Infer } from "convex/values";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { eventTypeValidator, changeDetailsValidator } from "./activity/validators";

type Ctx = QueryCtx | MutationCtx;

type EventType = Infer<typeof eventTypeValidator>;
type ChangeDetails = Infer<typeof changeDetailsValidator>;

/**
 * Activity logs for a task, newest first, paginated via the
 * `by_task_and_createdAt` index.
 */
export async function paginateTaskActivityLogsByTask(
  ctx: Ctx,
  taskId: Id<"tasks">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"taskActivityLogs">>> {
  return ctx.db
    .query("taskActivityLogs")
    .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
    .order("desc")
    .paginate(paginationOpts);
}

/**
 * Newest-first page of a task's activity logs, resuming strictly after a
 * `(createdAt, _creationTime)` position. Backs the merged timeline's hand-rolled
 * cursor — a Convex cursor is per-table and cannot span a merge.
 *
 * Two index reads when resuming, because `createdAt` is not unique: the first
 * finishes the boundary millisecond (ordering on `_creationTime`, the index's
 * implicit final field), the second takes older rows. Both are index-only.
 */
export async function takeTaskActivityLogsByTaskBefore(
  ctx: Ctx,
  taskId: Id<"tasks">,
  before: { at: number; creationTime: number } | undefined,
  limit: number
): Promise<Doc<"taskActivityLogs">[]> {
  if (before === undefined) {
    return ctx.db
      .query("taskActivityLogs")
      .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(limit);
  }

  const boundaryRemainder = await ctx.db
    .query("taskActivityLogs")
    .withIndex("by_task_and_createdAt", (q) =>
      q.eq("taskId", taskId).eq("createdAt", before.at).lt("_creationTime", before.creationTime)
    )
    .order("desc")
    .take(limit);

  if (boundaryRemainder.length >= limit) {
    return boundaryRemainder;
  }

  const older = await ctx.db
    .query("taskActivityLogs")
    .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId).lt("createdAt", before.at))
    .order("desc")
    .take(limit - boundaryRemainder.length);

  return [...boundaryRemainder, ...older];
}

/** Newest activity row for a task, or null. Index-only read. */
export async function getNewestTaskActivityLog(
  ctx: Ctx,
  taskId: Id<"tasks">
): Promise<Doc<"taskActivityLogs"> | null> {
  return ctx.db
    .query("taskActivityLogs")
    .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", taskId))
    .order("desc")
    .first();
}

/**
 * Insert an activity log, stamping `createdAt` so callers pass only the
 * event props.
 */
export async function insertTaskActivityLog(
  ctx: MutationCtx,
  props: {
    taskId: Id<"tasks">;
    userId: Id<"users">;
    eventType: EventType;
    changeDetails?: ChangeDetails;
  }
): Promise<Id<"taskActivityLogs">> {
  return ctx.db.insert("taskActivityLogs", {
    taskId: props.taskId,
    userId: props.userId,
    eventType: props.eventType,
    changeDetails: props.changeDetails,
    createdAt: Date.now(),
  });
}
