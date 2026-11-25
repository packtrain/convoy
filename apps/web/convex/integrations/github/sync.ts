import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { getProjectById } from "../../lib/accessRepo";
import { normalizedPullRequestValidator } from "../../lib/contracts/github";
import { GITHUB_HOST, MAX_SYNC_ATTEMPTS, PAGE_SIZE, readGithubAppConfig, syncRetryDelayMs } from "./lib/constants";
import { GithubError, githubFetch, isAccessLoss, mintRepositoryToken, repoPath, requireConfig } from "./lib/github";
import { list, normalizePullRequest } from "./lib/parsers";
import {
  getActiveRepositoryLinkForRepository,
  getRepositoryLinkById,
  paginateGithubRepositoryLinksByInstallation,
} from "./lib/integrationRepositoryLinksRepo";
import {
  getRepositoryById,
  paginateRepositories,
  paginateRepositoriesByProviderIdentity,
  updateRepositorySync,
} from "./lib/integrationRepositoriesRepo";
import { scheduleWatchEvaluations, startReconcile } from "./lib/lifecycle";
import { listWatchesForHead, listWatchesForPullRequest } from "./lib/integrationPullRequestWatchesRepo";
import { listPullRequestsAfterNumber, upsertPullRequest } from "./lib/integrationPullRequestsRepo";
import {
  syncContextValidator,
  syncJobValidator,
  toSyncContext,
  verifiedEventValidator,
  type SyncContext,
  type SyncJob,
  type SyncTarget,
} from "./lib/validators";

// Background sync (docs/specs/github-integration.md#sync-and-fencing): the
// repository lease, the worker that fetches under it, and webhook fan-out.
// The link generation rejects work that outlived a disconnect.

const LEASE_MS = 2 * 60 * 1000;
/** A lease whose recovery never ran (or one claimed before claim times were stored) is free after this. */
const LEASE_ABANDONED_MS = 10 * 60 * 1000;
const BUSY_RETRY_MS = 5 * 1000;
const jobArgs = syncJobValidator.fields;

/** The link and repository when the link still authorizes this generation's work. */
async function getLiveLink(
  ctx: QueryCtx | MutationCtx,
  repositoryLinkId: Id<"integrationRepositoryLinks">,
  generation: number
): Promise<{ link: Doc<"integrationRepositoryLinks">; repository: Doc<"integrationRepositories"> } | null> {
  const link = await getRepositoryLinkById(ctx, repositoryLinkId);
  if (!link || link.status !== "active" || link.generation !== generation) {
    return null;
  }
  const project = await getProjectById(ctx, link.projectId);
  const repository = await getRepositoryById(ctx, link.repositoryId);
  return project && !project.isDeleted && repository ? { link, repository } : null;
}

/**
 * Import pages and reconciliation passes are chains: only the job for the
 * repository's current page or pass continues, so a duplicate chain dies.
 */
function isCurrentTarget(repository: Doc<"integrationRepositories">, target: SyncTarget): boolean {
  if (target.kind === "import") return repository.importPage === target.page;
  if (target.kind === "reconcile") return repository.reconcileStartedAt === target.startedAt;
  if (target.kind === "history") return repository.historyRequest?.requestedAt === target.requestedAt;
  return true;
}

/** A history job that gives up frees the repository for the next Load more. */
async function releaseHistoryRequest(ctx: MutationCtx, repositoryId: Id<"integrationRepositories">, target: SyncTarget) {
  if (target.kind !== "history") return;
  const repository = await getRepositoryById(ctx, repositoryId);
  if (repository?.historyRequest?.requestedAt === target.requestedAt) {
    await updateRepositorySync(ctx, repositoryId, { historyRequest: undefined });
  }
}

export const getSyncContext = internalQuery({
  args: { repositoryLinkId: v.id("integrationRepositoryLinks"), generation: v.number() },
  returns: v.union(syncContextValidator, v.null()),
  handler: async (ctx, args) => {
    const live = await getLiveLink(ctx, args.repositoryLinkId, args.generation);
    return live ? toSyncContext(live.link, live.repository) : null;
  },
});

export const claimSync = internalMutation({
  args: jobArgs,
  returns: v.union(
    v.object({ kind: v.literal("acquired"), leaseToken: v.string(), context: syncContextValidator }),
    v.object({ kind: v.union(v.literal("busy"), v.literal("obsolete")) })
  ),
  handler: async (ctx, args) => {
    const live = await getLiveLink(ctx, args.repositoryLinkId, args.generation);
    if (!live || live.repository._id !== args.repositoryId || !isCurrentTarget(live.repository, args.target)) {
      await releaseHistoryRequest(ctx, args.repositoryId, args.target);
      return { kind: "obsolete" as const };
    }
    // Busy until commit or recoverSync clears the token, so a crashed job is always retried.
    const { leaseToken: heldToken, leaseClaimedAt } = live.repository;
    if (heldToken !== undefined && leaseClaimedAt !== undefined && Date.now() - leaseClaimedAt < LEASE_ABANDONED_MS) {
      // Keep the request, PR number included, for when the lease frees.
      await ctx.scheduler.runAfter(BUSY_RETRY_MS, internal.integrations.github.sync.syncRepository, args);
      return { kind: "busy" as const };
    }
    const leaseToken = crypto.randomUUID();
    await updateRepositorySync(ctx, args.repositoryId, { leaseToken, leaseClaimedAt: Date.now() });
    await ctx.scheduler.runAfter(LEASE_MS, internal.integrations.github.sync.recoverSync, { ...args, leaseToken });
    return { kind: "acquired" as const, leaseToken, context: toSyncContext(live.link, live.repository) };
  },
});

/** False when the job is out of attempts. */
async function scheduleRetry(ctx: MutationCtx, args: SyncJob, retryAfterMs = 0): Promise<boolean> {
  const attempt = (args.attempt ?? 1) + 1;
  if (attempt > MAX_SYNC_ATTEMPTS) {
    return false;
  }
  await ctx.scheduler.runAfter(Math.max(syncRetryDelayMs(attempt - 1), retryAfterMs), internal.integrations.github.sync.syncRepository, {
    repositoryId: args.repositoryId,
    repositoryLinkId: args.repositoryLinkId,
    generation: args.generation,
    target: args.target,
    attempt,
  });
  return true;
}

/** A worker that never committed (crash, timeout) loses its lease here and retries. */
export const recoverSync = internalMutation({
  args: { ...jobArgs, leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { leaseToken, ...job }) => {
    const repository = await getRepositoryById(ctx, job.repositoryId);
    if (!repository || repository.leaseToken !== leaseToken) {
      return null;
    }
    const retrying = Boolean(await getLiveLink(ctx, job.repositoryLinkId, job.generation)) && (await scheduleRetry(ctx, job));
    if (!retrying) await releaseHistoryRequest(ctx, job.repositoryId, job.target);
    await updateRepositorySync(ctx, job.repositoryId, {
      leaseToken: undefined, leaseClaimedAt: undefined,
      syncStatus: "error",
      error: retrying ? "Sync was interrupted. Retrying" : "Sync was interrupted",
    });
    return null;
  },
});

export const commitSync = internalMutation({
  args: {
    ...jobArgs,
    leaseToken: v.string(),
    pullRequests: v.array(normalizedPullRequestValidator),
    hasMore: v.boolean(),
    failure: v.optional(
      v.object({
        message: v.string(),
        retryable: v.boolean(),
        checkAccess: v.boolean(),
        retryAfterMs: v.optional(v.number()),
      })
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { leaseToken, pullRequests, hasMore, failure, ...job }) => {
    const repository = await getRepositoryById(ctx, job.repositoryId);
    if (!repository || repository.leaseToken !== leaseToken) {
      return false;
    }
    await updateRepositorySync(ctx, job.repositoryId, { leaseToken: undefined, leaseClaimedAt: undefined });
    if (!isCurrentTarget(repository, job.target) || !(await getLiveLink(ctx, job.repositoryLinkId, job.generation))) {
      await releaseHistoryRequest(ctx, job.repositoryId, job.target);
      return false;
    }
    if (failure) {
      await updateRepositorySync(ctx, job.repositoryId, { syncStatus: "error", error: failure.message });
      if (!(failure.retryable && (await scheduleRetry(ctx, job, failure.retryAfterMs)))) {
        await releaseHistoryRequest(ctx, job.repositoryId, job.target);
      }
      if (failure.checkAccess) {
        await ctx.scheduler.runAfter(0, internal.integrations.github.sync.confirmRepositoryAccess, {
          repositoryLinkId: job.repositoryLinkId,
          expectedGeneration: job.generation,
        });
      }
      return false;
    }
    const target = job.target;
    // A repository from before the counters starts at zero and backfills its existing rows in batches;
    // until then only rows the backfill already passed take deltas here.
    const backfillStarts = repository.openCount === undefined || repository.closedCount === undefined;
    const countedThrough = backfillStarts ? 0 : (repository.countedThroughNumber ?? Infinity);
    let openDelta = 0;
    let closedDelta = 0;
    // Closed history is imported only on request, so reconciliation adds closed PRs only once history
    // started; then it keeps every closed PR updated since the covered time stored.
    const insertClosed = target.kind !== "reconcile" || repository.history !== undefined;
    for (const pullRequest of pullRequests) {
      const result = await upsertPullRequest(ctx, job.repositoryId, pullRequest, { insertClosed });
      if (result.written && result.previousState !== pullRequest.state && pullRequest.number <= countedThrough) {
        const [from, to] = [result.previousState, pullRequest.state];
        if (from === "open") openDelta--;
        else if (from !== null) closedDelta--;
        if (to === "open") openDelta++;
        else closedDelta++;
      }
    }
    const counts = {
      openCount: (repository.openCount ?? 0) + openDelta,
      closedCount: (repository.closedCount ?? 0) + closedDelta,
      ...(backfillStarts ? { countedThroughNumber: 0 } : {}),
    };
    if (backfillStarts) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.sync.countPullRequests, { repositoryId: job.repositoryId });
    }
    const now = Date.now();
    const next = (nextTarget: SyncTarget) =>
      ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
        repositoryId: job.repositoryId,
        repositoryLinkId: job.repositoryLinkId,
        generation: job.generation,
        target: nextTarget,
      });
    // Recovery clears a refresh's error, but never an unfinished import's.
    const recovered = repository.importPage === undefined ? { syncStatus: "synced" as const, error: undefined } : {};
    if (target.kind === "pullRequest") {
      await updateRepositorySync(ctx, job.repositoryId, { ...counts, lastSuccessAt: now, ...recovered });
      return true;
    }
    if (target.kind === "history") {
      const covered = repository.history?.coveredThrough;
      // The window (this page and the one before) is newest updated first. Starting older than the
      // covered time, reopens shifted rows past it: step back a page and read again.
      const gap = target.page > 1 && covered !== undefined && (pullRequests[0]?.providerUpdatedAt ?? -Infinity) < covered;
      if (gap) {
        const page = target.page - 1;
        await updateRepositorySync(ctx, job.repositoryId, {
          ...counts,
          history: { nextPage: page, coveredThrough: covered, complete: false },
          historyRequest: { page, requestedAt: now },
        });
        await next({ kind: "history", page, requestedAt: now });
        return true;
      }
      // Contiguous with the covered rows, so the window's oldest row extends the coverage.
      const coveredThrough = Math.min(covered ?? Infinity, ...pullRequests.map((pr) => pr.providerUpdatedAt));
      await updateRepositorySync(ctx, job.repositoryId, {
        ...counts,
        history: { nextPage: target.page + 1, coveredThrough: Number.isFinite(coveredThrough) ? coveredThrough : 0, complete: !hasMore },
        historyRequest: undefined,
        lastSuccessAt: now,
        ...recovered,
      });
      return true;
    }
    if (target.kind === "reconcile") {
      // The open phase sees every open PR, so it can check the stored open count.
      const openSeen = target.phase === "open" ? (target.openSeen ?? 0) + pullRequests.length : undefined;
      if (hasMore) {
        await updateRepositorySync(ctx, job.repositoryId, counts);
        await next({ ...target, page: target.page + 1, openSeen });
      } else if (target.phase === "changed") {
        await updateRepositorySync(ctx, job.repositoryId, counts);
        await next({ ...target, phase: "open", page: 1 });
      } else {
        // A count that disagrees drifted (or raced a change mid-pass): recount it in batches.
        const drifted = countedThrough === Infinity && counts.openCount !== openSeen;
        await updateRepositorySync(ctx, job.repositoryId, {
          ...counts,
          ...(drifted ? { openCount: 0, closedCount: 0, countedThroughNumber: 0 } : {}),
          reconcileStartedAt: undefined,
          reconciledAt: target.startedAt,
          lastSuccessAt: now,
          ...recovered,
        });
        if (drifted) {
          await ctx.scheduler.runAfter(0, internal.integrations.github.sync.countPullRequests, { repositoryId: job.repositoryId });
        }
      }
      return true;
    }
    // Derived from the page, so a repeated or overlapping page never double counts.
    const importedCount = (target.page - 1) * PAGE_SIZE + pullRequests.length;
    if (hasMore) {
      const page = target.page + 1;
      await updateRepositorySync(ctx, job.repositoryId, { ...counts, syncStatus: "importing", importPage: page, importedCount, error: undefined });
      await next({ kind: "import", page });
    } else {
      await updateRepositorySync(ctx, job.repositoryId, {
        ...counts,
        syncStatus: "synced",
        importPage: undefined,
        importedCount,
        lastSuccessAt: now,
        error: undefined,
      });
    }
    return true;
  },
});

// --- Worker and webhook routing ---

function classifyFailure(error: unknown, message: string) {
  if (error instanceof GithubError) {
    const transient = error.rateLimited || error.status === null || error.status >= 500;
    return {
      message,
      retryable: transient,
      checkAccess: isAccessLoss(error),
      retryAfterMs: error.retryAfterMs ?? undefined,
    };
  }
  return { message, retryable: true, checkAccess: false };
}

async function fetchTarget(token: string, context: SyncContext, target: SyncTarget) {
  if (target.kind === "pullRequest") {
    const raw = await githubFetch(`${repoPath(context)}/pulls/${target.number}`, { token }).catch((error: unknown) => {
      if (error instanceof GithubError && error.status === 404) return null;
      throw error;
    });
    return { pullRequests: raw ? [normalizePullRequest(raw)] : [], hasMore: false };
  }
  if (target.kind === "history") {
    const page = async (number: number) =>
      list(
        await githubFetch(`${repoPath(context)}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${number}`, {
          token,
        })
      );
    // A closed PR reopened since the last page shifts the list up, moving rows onto the page before;
    // re-reading it catches up to 30 such moves, and the commit steps back past more.
    const [previous, raw] = await Promise.all([target.page > 1 ? page(target.page - 1) : [], page(target.page)]);
    return { pullRequests: [...previous, ...raw].map(normalizePullRequest), hasMore: raw.length === PAGE_SIZE };
  }
  if (target.kind === "reconcile" && target.phase === "changed") {
    const raw = list(
      await githubFetch(`${repoPath(context)}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${target.page}`, {
        token,
      })
    );
    const changed = raw.map(normalizePullRequest).filter((pr) => pr.providerUpdatedAt >= target.since);
    return { pullRequests: changed, hasMore: raw.length === PAGE_SIZE && changed.length === raw.length };
  }
  const raw = list(
    await githubFetch(`${repoPath(context)}/pulls?state=open&sort=created&direction=asc&per_page=${PAGE_SIZE}&page=${target.page}`, {
      token,
    })
  );
  // Page numbers skip a PR when an earlier one closes mid-traversal; the next pass's open phase finds it.
  return { pullRequests: raw.map(normalizePullRequest), hasMore: raw.length === PAGE_SIZE };
}

/** One import page, PR refresh, history page, or reconciliation page under the repository lease. */
export const syncRepository = internalAction({
  args: syncJobValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.integrations.github.sync.claimSync, args);
    if (claim.kind !== "acquired") {
      return null;
    }
    const commit = { ...args, leaseToken: claim.leaseToken };
    try {
      const config = requireConfig();
      const token = await mintRepositoryToken(config, claim.context.installationId, claim.context.providerRepositoryId);
      const fetched = await fetchTarget(token, claim.context, args.target);
      await ctx.runMutation(internal.integrations.github.sync.commitSync, { ...commit, ...fetched });
    } catch (error) {
      const message = error instanceof GithubError ? `GitHub sync failed: ${error.message}` : "GitHub sync failed";
      await ctx.runMutation(internal.integrations.github.sync.commitSync, {
        ...commit,
        pullRequests: [],
        hasMore: false,
        failure: classifyFailure(error, message),
      });
    }
    return null;
  },
});

/**
 * Revocation signals are hints: revoke only when GitHub confirms, for the
 * link's current generation, that the installation lost the repository.
 */
export const confirmRepositoryAccess = internalAction({
  args: { repositoryLinkId: v.id("integrationRepositoryLinks"), expectedGeneration: v.number(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.integrations.github.sync.getSyncContext, {
      repositoryLinkId: args.repositoryLinkId,
      generation: args.expectedGeneration,
    });
    const config = readGithubAppConfig();
    if (!context || !config) {
      return null;
    }
    try {
      await mintRepositoryToken(config, context.installationId, context.providerRepositoryId);
    } catch (error) {
      if (isAccessLoss(error)) {
        await ctx.runMutation(internal.integrations.github.core.revoke, {
          repositoryLinkId: args.repositoryLinkId,
          expectedGeneration: args.expectedGeneration,
        });
      } else if ((args.attempt ?? 1) < MAX_SYNC_ATTEMPTS) {
        const attempt = (args.attempt ?? 1) + 1;
        const waitMs = Math.max(syncRetryDelayMs(attempt - 1), error instanceof GithubError ? (error.retryAfterMs ?? 0) : 0);
        await ctx.scheduler.runAfter(waitMs, internal.integrations.github.sync.confirmRepositoryAccess, {
          ...args,
          attempt,
        });
      }
    }
    return null;
  },
});

/** Webhook fan-out: up to 30 targets per transaction, continuation scheduled atomically. */
export const fanOutWebhook = internalMutation({
  args: { event: verifiedEventValidator, cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event.github;
    const paginationOpts = { numItems: PAGE_SIZE, cursor: args.cursor ?? null };
    let next: { isDone: boolean; continueCursor: string };
    if (event.kind !== "accessChanged") {
      const result = await paginateRepositoriesByProviderIdentity(
        ctx,
        { provider: "github", host: GITHUB_HOST, providerRepositoryId: event.repositoryId },
        paginationOpts
      );
      for (const repository of result.page) {
        const link = await getActiveRepositoryLinkForRepository(ctx, repository._id);
        if (!link || link.github.installationId !== event.installationId) {
          continue;
        }
        if (event.kind === "checks") {
          // A fork's PR is found by its head alone; GitHub lists no PRs for it.
          const byNumber = await Promise.all(event.numbers.map((number) => listWatchesForPullRequest(ctx, repository._id, number)));
          await scheduleWatchEvaluations(ctx, [...byNumber.flat(), ...(await listWatchesForHead(ctx, repository._id, event.headSha))]);
          continue;
        }
        if (event.kind === "pullRequest") {
          await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
            repositoryId: repository._id,
            repositoryLinkId: link._id,
            generation: link.generation,
            target: { kind: "pullRequest", number: event.number },
          });
        }
        // A comment only moves the PR's update time, which the reconcile pass picks up, so it schedules no sync.
        await scheduleWatchEvaluations(ctx, await listWatchesForPullRequest(ctx, repository._id, event.number));
      }
      next = result;
    } else {
      const result = await paginateGithubRepositoryLinksByInstallation(ctx, event.installationId, paginationOpts);
      for (const link of result.page) {
        if (link.status === "active") {
          await ctx.scheduler.runAfter(0, internal.integrations.github.sync.confirmRepositoryAccess, {
            repositoryLinkId: link._id,
            expectedGeneration: link.generation,
          });
        }
      }
      next = result;
    }
    if (!next.isDone) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.sync.fanOutWebhook, { event: args.event, cursor: next.continueCursor });
    }
    return null;
  },
});

/** Counter backfill: adds the next 30 existing rows to the counts, then continues past them. */
export const countPullRequests = internalMutation({
  args: { repositoryId: v.id("integrationRepositories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const repository = await getRepositoryById(ctx, args.repositoryId);
    if (repository?.countedThroughNumber === undefined) {
      return null;
    }
    const rows = await listPullRequestsAfterNumber(ctx, repository._id, repository.countedThroughNumber, PAGE_SIZE);
    const open = rows.filter((row) => row.state === "open").length;
    const done = rows.length < PAGE_SIZE;
    await updateRepositorySync(ctx, repository._id, {
      openCount: (repository.openCount ?? 0) + open,
      closedCount: (repository.closedCount ?? 0) + rows.length - open,
      countedThroughNumber: done ? undefined : rows[rows.length - 1].number,
    });
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.sync.countPullRequests, args);
    }
    return null;
  },
});

/** A pass this old died without finishing (out of retries); the next tick starts over. */
const RECONCILE_STALE_MS = 60 * 60 * 1000;

/**
 * Cron repair for what webhooks miss (docs/specs/github-integration.md#reconciliation):
 * per repository with an active link, resume an unfinished import or start a
 * reconciliation pass. Visits 30 repositories per transaction.
 */
export const reconcile = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await paginateRepositories(ctx, { numItems: PAGE_SIZE, cursor: args.cursor ?? null });
    const now = Date.now();
    for (const repository of result.page) {
      const link = await getActiveRepositoryLinkForRepository(ctx, repository._id);
      if (!link) {
        continue;
      }
      if (repository.importPage !== undefined) {
        // A duplicate of a running import dies at its commit (isCurrentTarget).
        await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
          repositoryId: repository._id,
          repositoryLinkId: link._id,
          generation: link.generation,
          target: { kind: "import", page: repository.importPage },
        });
      } else if (repository.reconcileStartedAt === undefined || now - repository.reconcileStartedAt >= RECONCILE_STALE_MS) {
        await startReconcile(ctx, repository, link);
      }
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.sync.reconcile, { cursor: result.continueCursor });
    }
    return null;
  },
});
