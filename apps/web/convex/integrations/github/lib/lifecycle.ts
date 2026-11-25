import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { WATCH_EVALUATION_DELAY_MS, WATCH_EVALUATION_STALE_MS } from "./constants";
import { getStalestOpenPullRequest } from "./integrationPullRequestsRepo";
import { getRepositoryById, updateRepositorySync } from "./integrationRepositoriesRepo";
import { deactivateRepositoryLink, getActiveRepositoryLinkForRepository } from "./integrationRepositoryLinksRepo";
import { getThreadById, setThreadPullRequestChecksRunning } from "../../../cli/threads/lib/cliThreadsRepo";
import { deleteWatch, listWatchesForProjectRepository, patchWatch } from "./integrationPullRequestWatchesRepo";

/** A reconciliation pass reads PRs updated since this far before its start time, for clock skew between GitHub and Convoy. */
export const RECONCILE_MARGIN_MS = 5 * 60_000;

/**
 * Start a reconciliation pass under `link`: PRs changed since the last pass,
 * then every open PR. A new pass supersedes a running one.
 */
export async function startReconcile(
  ctx: MutationCtx,
  repository: Doc<"integrationRepositories">,
  link: Doc<"integrationRepositoryLinks">
): Promise<void> {
  const startedAt = Date.now();
  // Never reconciled: a close of any stored open PR updated it after its stored time, so start at the stalest.
  const since =
    (repository.reconciledAt ?? (await getStalestOpenPullRequest(ctx, repository._id))?.providerUpdatedAt ?? startedAt) -
    RECONCILE_MARGIN_MS;
  await updateRepositorySync(ctx, repository._id, { reconcileStartedAt: startedAt });
  await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
    repositoryId: repository._id,
    repositoryLinkId: link._id,
    generation: link.generation,
    target: { kind: "reconcile", phase: "changed", page: 1, since, startedAt },
  });
}

/** Hide the link's content, obsolete its jobs, and schedule the retention purge. */
export async function disconnectLink(ctx: MutationCtx, link: Doc<"integrationRepositoryLinks">, error?: string) {
  const { generation, deleteAfter } = await deactivateRepositoryLink(ctx, link, error);
  for (const watch of await listWatchesForProjectRepository(ctx, link.projectId, link.repositoryId)) await endWatch(ctx, watch);
  await ctx.scheduler.runAt(deleteAfter, internal.integrations.github.core.purge, { repositoryLinkId: link._id, generation });
  // An unfinished import dies with this link's generation; another project's link resumes it.
  const repository = await getRepositoryById(ctx, link.repositoryId);
  const heir = await getActiveRepositoryLinkForRepository(ctx, link.repositoryId);
  if (repository?.importPage !== undefined && heir) {
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
      repositoryId: repository._id,
      repositoryLinkId: heir._id,
      generation: heir.generation,
      target: { kind: "import", page: repository.importPage },
    });
  }
}

/** Ends a watch; its thread no longer counts as Running for the PR's checks. */
export async function endWatch(ctx: MutationCtx, watch: Doc<"integrationPullRequestWatches">): Promise<void> {
  await deleteWatch(ctx, watch._id);
  const thread = await getThreadById(ctx, watch.threadId);
  if (thread) await setThreadPullRequestChecksRunning(ctx, thread, false);
}

/** A push: the new head's checks are about to run, so the threads count as Running until an evaluation reads them. */
export async function markWatchesPushed(ctx: MutationCtx, watches: Doc<"integrationPullRequestWatches">[]): Promise<void> {
  for (const watch of watches) {
    const thread = await getThreadById(ctx, watch.threadId);
    if (thread) await setThreadPullRequestChecksRunning(ctx, thread, true);
  }
}

/** Schedule the watch's one evaluation at `at`; `at` is its token, so an earlier one still running is dropped. `idle` is the cron's. */
export async function scheduleWatchEvaluation(
  ctx: MutationCtx,
  watchId: Id<"integrationPullRequestWatches">,
  at: number,
  idle?: true
): Promise<void> {
  await patchWatch(ctx, watchId, { evaluateAt: at, eventDuringRead: undefined });
  await ctx.scheduler.runAt(at, internal.integrations.github.pullRequestWatches.evaluate, { watchId, evaluateAt: at, idle });
}

/**
 * Schedule an evaluation of each watch, unless one is on its way: an event
 * while it waits is covered by its read, and one during its read gets a follow-up.
 */
export async function scheduleWatchEvaluations(ctx: MutationCtx, watches: Doc<"integrationPullRequestWatches">[]): Promise<void> {
  const now = Date.now();
  const seen = new Set<string>();
  for (const watch of watches) {
    if (seen.has(watch._id)) continue;
    seen.add(watch._id);
    if (watch.evaluateAt !== undefined && watch.evaluateAt > now - WATCH_EVALUATION_STALE_MS) {
      if (watch.evaluateAt <= now && !watch.eventDuringRead) await patchWatch(ctx, watch._id, { eventDuringRead: true });
      continue;
    }
    await scheduleWatchEvaluation(ctx, watch._id, now + WATCH_EVALUATION_DELAY_MS);
  }
}
