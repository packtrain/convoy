import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type Ctx = QueryCtx | MutationCtx;
type Watch = Doc<"integrationPullRequestWatches">;

export async function getWatchById(ctx: Ctx, watchId: Id<"integrationPullRequestWatches">): Promise<Watch | null> {
  return ctx.db.get("integrationPullRequestWatches", watchId);
}

/** A thread has at most one watch, on its Attached pull request. */
export async function getWatchByThreadId(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Watch | null> {
  return ctx.db
    .query("integrationPullRequestWatches")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .first();
}

// Both lists are bounded by WATCHES_PER_PULL_REQUEST_MAX, which `start` enforces, per PR at that head.

/** The watches on one PR, across the organization's projects. */
export async function listWatchesForPullRequest(ctx: Ctx, repositoryId: Id<"integrationRepositories">, number: number): Promise<Watch[]> {
  const watches: Watch[] = [];
  for await (const watch of ctx.db
    .query("integrationPullRequestWatches")
    .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", number))) {
    watches.push(watch);
  }
  return watches;
}

/** The watches whose PR was last seen at `headSha`: how a fork's check event finds its PR. */
export async function listWatchesForHead(ctx: Ctx, repositoryId: Id<"integrationRepositories">, headSha: string): Promise<Watch[]> {
  const watches: Watch[] = [];
  for await (const watch of ctx.db
    .query("integrationPullRequestWatches")
    .withIndex("by_repositoryId_and_headSha", (q) => q.eq("repositoryId", repositoryId).eq("headSha", headSha))) {
    watches.push(watch);
  }
  return watches;
}

/** The watches no evaluation finished since `before`, oldest first: the cron's page. */
export async function paginateWatchesEvaluatedBefore(ctx: Ctx, before: number, paginationOpts: { numItems: number; cursor: string | null }) {
  return ctx.db
    .query("integrationPullRequestWatches")
    .withIndex("by_evaluatedAt", (q) => q.lt("evaluatedAt", before))
    .paginate(paginationOpts);
}

export async function insertWatch(ctx: MutationCtx, watch: Omit<Watch, "_id" | "_creationTime">): Promise<Id<"integrationPullRequestWatches">> {
  return ctx.db.insert("integrationPullRequestWatches", watch);
}

export async function patchWatch(
  ctx: MutationCtx,
  watchId: Id<"integrationPullRequestWatches">,
  patch: Partial<
    Pick<Watch, "headSha" | "failedChecks" | "passedReported" | "finishOwed" | "conflicts" | "evaluateAt" | "eventDuringRead" | "evaluatedAt" | "readFailures" | "mergeableRecheck" | "seenThrough" | "seenIds" | "commentOnlyWakes">
  >
): Promise<void> {
  await ctx.db.patch("integrationPullRequestWatches", watchId, patch);
}

export async function deleteWatch(ctx: MutationCtx, watchId: Id<"integrationPullRequestWatches">): Promise<void> {
  await ctx.db.delete("integrationPullRequestWatches", watchId);
}

/** Ends a thread's watch: Done, deleted, or unwatched. */
export async function deleteWatchForThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  const watch = await getWatchByThreadId(ctx, threadId);
  if (watch) await deleteWatch(ctx, watch._id);
}

/** Ends a project's watches in one repository when its link goes. */
export async function deleteWatchesForProjectRepository(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  repositoryId: Id<"integrationRepositories">
): Promise<void> {
  // ponytail: scans the repository's watches across its projects; few threads watch at once.
  for await (const watch of ctx.db.query("integrationPullRequestWatches").withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId))) {
    if (watch.projectId === projectId) await deleteWatch(ctx, watch._id);
  }
}
