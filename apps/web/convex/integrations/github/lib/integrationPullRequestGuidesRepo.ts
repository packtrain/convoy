import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { GuideStep } from "../../../lib/contracts/github";

type Ctx = QueryCtx | MutationCtx;

export async function getGuideById(ctx: Ctx, guideId: Id<"integrationPullRequestGuides">): Promise<Doc<"integrationPullRequestGuides"> | null> {
  return ctx.db.get("integrationPullRequestGuides", guideId);
}

export async function getGuideByThreadId(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"integrationPullRequestGuides"> | null> {
  return ctx.db
    .query("integrationPullRequestGuides")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .first();
}

/** The PR's newest Guides in the project, newest first. */
export async function listGuidesForPullRequest(
  ctx: Ctx,
  pullRequest: { projectId: Id<"projects">; repositoryId: Id<"integrationRepositories">; number: number },
  limit: number
): Promise<Doc<"integrationPullRequestGuides">[]> {
  return ctx.db
    .query("integrationPullRequestGuides")
    .withIndex("by_projectId_and_repositoryId_and_number_and_createdAt", (q) =>
      q.eq("projectId", pullRequest.projectId).eq("repositoryId", pullRequest.repositoryId).eq("number", pullRequest.number)
    )
    .order("desc")
    .take(limit);
}

export async function insertGuide(
  ctx: MutationCtx,
  guide: Omit<Doc<"integrationPullRequestGuides">, "_id" | "_creationTime">
): Promise<Id<"integrationPullRequestGuides">> {
  return ctx.db.insert("integrationPullRequestGuides", guide);
}

export async function completeGuide(ctx: MutationCtx, guideId: Id<"integrationPullRequestGuides">, steps: GuideStep[], now: number) {
  await ctx.db.insert("integrationPullRequestGuideSteps", { guideId, steps });
  await ctx.db.patch("integrationPullRequestGuides", guideId, { status: "ready", completedAt: now, failureReason: undefined });
}

/** A run error can be long; the menu row and the Failed state show a line or two. */
const FAILURE_REASON_MAX = 1000;

export async function failGuide(ctx: MutationCtx, guideId: Id<"integrationPullRequestGuides">, reason: string) {
  await ctx.db.patch("integrationPullRequestGuides", guideId, { status: "failed", failureReason: reason.slice(0, FAILURE_REASON_MAX) });
}

const GUIDE_RUN_ENDED_REASON = "The run ended before a guide was submitted.";

/** A Guide run's turn ended: a Guide still writing fails, with the run's error if it had one (docs/specs/github-integration.md → Guides). */
export async function settleGuideRun(ctx: MutationCtx, thread: Doc<"cliThreads">, runError: string | undefined) {
  if (!thread.pullRequestGuide) return;
  const guide = await getGuideByThreadId(ctx, thread._id);
  if (guide?.status === "writing") {
    await failGuide(ctx, guide._id, runError ?? GUIDE_RUN_ENDED_REASON);
  }
}

/** Retry: the same Guide, written again by `run`'s thread at the PR's current revision. */
export async function restartGuide(
  ctx: MutationCtx,
  guideId: Id<"integrationPullRequestGuides">,
  run: Pick<Doc<"integrationPullRequestGuides">, "threadId" | "baseSha" | "headSha" | "cliType" | "cliModel" | "createdAt">
) {
  await ctx.db.patch("integrationPullRequestGuides", guideId, { ...run, status: "writing", failureReason: undefined });
}

/** A ready Guide's steps; a writing one has none. */
export async function getGuideSteps(ctx: Ctx, guideId: Id<"integrationPullRequestGuides">): Promise<GuideStep[]> {
  const row = await ctx.db
    .query("integrationPullRequestGuideSteps")
    .withIndex("by_guideId", (q) => q.eq("guideId", guideId))
    .unique();
  return row?.steps ?? [];
}

/** Deletes a Guide and its steps. */
export async function deleteGuide(ctx: MutationCtx, guideId: Id<"integrationPullRequestGuides">) {
  const steps = await ctx.db
    .query("integrationPullRequestGuideSteps")
    .withIndex("by_guideId", (q) => q.eq("guideId", guideId))
    .unique();
  if (steps) await ctx.db.delete("integrationPullRequestGuideSteps", steps._id);
  await ctx.db.delete("integrationPullRequestGuides", guideId);
}

/** Deletes up to `limit` of the project's Guides on one repository; returns how many. */
export async function deleteGuidesBatch(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  repositoryId: Id<"integrationRepositories">,
  limit: number
): Promise<number> {
  const rows = await ctx.db
    .query("integrationPullRequestGuides")
    .withIndex("by_projectId_and_repositoryId_and_number_and_createdAt", (q) => q.eq("projectId", projectId).eq("repositoryId", repositoryId))
    .take(limit);
  for (const row of rows) {
    await deleteGuide(ctx, row._id);
  }
  return rows.length;
}
