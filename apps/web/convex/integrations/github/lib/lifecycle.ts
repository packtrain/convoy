import type { Doc } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { getStalestOpenPullRequest } from "./integrationPullRequestsRepo";
import { getRepositoryById, updateRepositorySync } from "./integrationRepositoriesRepo";
import { deactivateRepositoryLink, getActiveRepositoryLinkForRepository } from "./integrationRepositoryLinksRepo";

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

