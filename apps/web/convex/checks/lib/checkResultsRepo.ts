import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

// ponytail: a task's results past the newest 500 drop off; paginate if a task gets there.
const TASK_RESULT_LIMIT = 500;

export type CheckResultProps = Omit<Doc<"checkResults">, "_id" | "_creationTime" | "reportedAt">;

export async function getCheckResultById(ctx: Ctx, id: Id<"checkResults">): Promise<Doc<"checkResults"> | null> {
  return ctx.db.get("checkResults", id);
}

/** A task's results, newest first. */
export async function listCheckResultsByTask(ctx: Ctx, taskId: Id<"tasks">): Promise<Doc<"checkResults">[]> {
  return ctx.db
    .query("checkResults")
    .withIndex("by_taskId_and_reportedAt", (q) => q.eq("taskId", taskId))
    .order("desc")
    .take(TASK_RESULT_LIMIT);
}

// ponytail: the attach move and thread deletion rewrite every owned result in one transaction. One
// result per `--check` call keeps this far below Convex's write limit; batch through the scheduler if a thread nears it.
const ownedByThread = (ctx: Ctx, threadId: Id<"cliThreads">) =>
  ctx.db
    .query("checkResults")
    .withIndex("by_threadId_and_taskId_and_reportedAt", (q) => q.eq("threadId", threadId).eq("taskId", undefined))
    .order("desc");

/** Results reported on a thread while it had no task, newest first (OS-2293). */
export async function listCheckResultsOwnedByThread(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"checkResults">[]> {
  return ownedByThread(ctx, threadId).take(TASK_RESULT_LIMIT);
}

/** Attaching a task hands it the thread's results; newest-first reads make the newer one per Check current. */
export async function moveThreadCheckResultsToTask(ctx: MutationCtx, threadId: Id<"cliThreads">, taskId: Id<"tasks">): Promise<void> {
  for (const result of await ownedByThread(ctx, threadId).collect()) {
    await ctx.db.patch("checkResults", result._id, { taskId });
  }
}

/** Deleting a thread deletes the results it owns. Their blobs stay: the thread's message refs hold them. */
export async function deleteCheckResultsOwnedByThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  for (const result of await ownedByThread(ctx, threadId).collect()) {
    await deleteResultWithFiles(ctx, result._id);
  }
}

async function deleteResultWithFiles(ctx: MutationCtx, resultId: Id<"checkResults">): Promise<Id<"_storage">[]> {
  const files = await ctx.db
    .query("checkResultFiles")
    .withIndex("by_resultId", (q) => q.eq("resultId", resultId))
    .collect();
  for (const file of files) {
    await ctx.db.delete("checkResultFiles", file._id);
  }
  await ctx.db.delete("checkResults", resultId);
  return files.map((file) => file.storageId);
}

/** Inserts the result and one `checkResultFiles` row per blob, so storage cleanup keeps them. */
export async function insertCheckResult(ctx: MutationCtx, props: CheckResultProps): Promise<Id<"checkResults">> {
  const resultId = await ctx.db.insert("checkResults", { ...props, reportedAt: Date.now() });
  for (const file of props.files) {
    await ctx.db.insert("checkResultFiles", { resultId, storageId: file.storageId });
  }
  return resultId;
}

/** Deletes every result on the task with its file rows; returns the blobs they pointed at. */
export async function deleteCheckResultsByTask(ctx: MutationCtx, taskId: Id<"tasks">): Promise<Id<"_storage">[]> {
  const storageIds: Id<"_storage">[] = [];
  const results = await ctx.db
    .query("checkResults")
    .withIndex("by_taskId_and_reportedAt", (q) => q.eq("taskId", taskId))
    .collect();
  for (const result of results) {
    storageIds.push(...(await deleteResultWithFiles(ctx, result._id)));
  }
  return storageIds;
}
