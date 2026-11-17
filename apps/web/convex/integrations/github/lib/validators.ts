import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import { cliModelValidator, cliTypeValidator } from "../../../lib/contracts/validators";
import {
  guideStatusValidator,
  guideStepValidator,
  type NormalizedPullRequest,
  pullRequestStackValidator,
  pullRequestStateValidator,
  repositoryLinkStatusValidator,
  repositorySyncStatusValidator,
} from "../../../lib/contracts/github";

/**
 * What a sync job fetches: one page of the open-PR import, one PR, one page
 * of closed history, or one page of a reconciliation pass started at
 * `startedAt`. A pass reads the PRs updated since `since` (phase "changed"),
 * then every open PR (phase "open").
 */
export const syncTargetValidator = v.union(
  v.object({ kind: v.literal("import"), page: v.number() }),
  v.object({ kind: v.literal("pullRequest"), number: v.number() }),
  /** One page of closed history, newest updated first, as `historyRequest` asked for it. */
  v.object({ kind: v.literal("history"), page: v.number(), requestedAt: v.number() }),
  v.object({
    kind: v.literal("reconcile"),
    phase: v.union(v.literal("changed"), v.literal("open")),
    page: v.number(),
    since: v.number(),
    startedAt: v.number(),
    /** Open PRs the open phase has listed so far. */
    openSeen: v.optional(v.number()),
  })
);
export type SyncTarget = Infer<typeof syncTargetValidator>;

/** Arguments of every scheduled sync job; `generation` fences it to one link lifetime. */
export const syncJobValidator = v.object({
  repositoryId: v.id("integrationRepositories"),
  repositoryLinkId: v.id("integrationRepositoryLinks"),
  generation: v.number(),
  target: syncTargetValidator,
  attempt: v.optional(v.number()),
});
export type SyncJob = Infer<typeof syncJobValidator>;

/** A signature-verified webhook reduced to routing data; never the raw payload. */
export const verifiedEventValidator = v.object({
  provider: v.literal("github"),
  github: v.union(
    v.object({
      kind: v.literal("pullRequest"),
      installationId: v.number(),
      repositoryId: v.number(),
      number: v.number(),
    }),
    v.object({ kind: v.literal("accessChanged"), installationId: v.number() })
  ),
});
export type VerifiedEvent = Infer<typeof verifiedEventValidator>;

/** Live link context a sync or diff job needs; null once the link is obsolete. */
export const syncContextValidator = v.object({
  installationId: v.number(),
  providerRepositoryId: v.number(),
});
export type SyncContext = Infer<typeof syncContextValidator>;

export function toSyncContext(link: Doc<"integrationRepositoryLinks">, repository: Doc<"integrationRepositories">): SyncContext {
  return {
    installationId: link.github.installationId,
    providerRepositoryId: repository.providerRepositoryId,
  };
}

export const pullRequestSummaryValidator = v.object({
  _id: v.id("integrationPullRequests"),
  repositoryId: v.id("integrationRepositories"),
  number: v.number(),
  title: v.string(),
  author: v.string(),
  state: pullRequestStateValidator,
  draft: v.boolean(),
  labels: v.array(v.string()),
  headRef: v.string(),
  baseRef: v.string(),
  providerUpdatedAt: v.number(),
  stack: v.optional(pullRequestStackValidator),
  archived: v.boolean(),
  /** GitHub last reported conflicts with the base; unknown until a single-PR refresh. */
  conflicts: v.boolean(),
});
export type PullRequestSummary = Infer<typeof pullRequestSummaryValidator>;

export function toPullRequestSummary(row: Doc<"integrationPullRequests">): PullRequestSummary {
  return {
    _id: row._id,
    repositoryId: row.repositoryId,
    number: row.number,
    title: row.title,
    author: row.author,
    state: row.state,
    draft: row.draft,
    labels: row.labels,
    headRef: row.headRef,
    baseRef: row.baseRef,
    providerUpdatedAt: row.providerUpdatedAt,
    stack: row.stack,
    archived: row.archived === true,
    conflicts: row.state === "open" && row.conflicts === true,
  };
}

export const pullRequestDetailValidator = pullRequestSummaryValidator.extend({
  description: v.string(),
  headSha: v.string(),
  baseSha: v.string(),
  providerCreatedAt: v.number(),
  syncedAt: v.number(),
});

export function toPullRequestDetail(row: Doc<"integrationPullRequests">): Infer<typeof pullRequestDetailValidator> {
  return {
    ...toPullRequestSummary(row),
    description: row.description,
    headSha: row.headSha,
    baseSha: row.baseSha,
    providerCreatedAt: row.providerCreatedAt,
    syncedAt: row.syncedAt,
  };
}

/** The reader's PR when Convoy never stored it: read live from GitHub, never written. */
export const livePullRequestValidator = pullRequestDetailValidator.omit("_id", "syncedAt");
export type LivePullRequest = Infer<typeof livePullRequestValidator>;

export function toLivePullRequest(repositoryId: Id<"integrationRepositories">, pr: NormalizedPullRequest): LivePullRequest {
  return {
    repositoryId,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    state: pr.state,
    draft: pr.draft,
    labels: pr.labels,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    providerUpdatedAt: pr.providerUpdatedAt,
    stack: pr.stack,
    archived: pr.archived === true,
    conflicts: pr.state === "open" && pr.conflicts === true,
    description: pr.description,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    providerCreatedAt: pr.providerCreatedAt,
  };
}

/** A live search hit: GitHub's issue shape has no branches or revision. */
export const pullRequestSearchHitValidator = v.object({
  repositoryId: v.id("integrationRepositories"),
  number: v.number(),
  title: v.string(),
  author: v.string(),
  state: pullRequestStateValidator,
  draft: v.boolean(),
  labels: v.array(v.string()),
  providerCreatedAt: v.number(),
  providerUpdatedAt: v.number(),
});
export type PullRequestSearchHit = Infer<typeof pullRequestSearchHitValidator>;

export const connectionValidator = v.object({
  repositoryLinkId: v.id("integrationRepositoryLinks"),
  repositoryId: v.id("integrationRepositories"),
  status: repositoryLinkStatusValidator,
  accountLogin: v.string(),
  connectedAt: v.number(),
  deleteAfter: v.optional(v.number()),
  error: v.optional(v.string()),
  repository: v.object({
    providerRepositoryId: v.number(),
    owner: v.string(),
    name: v.string(),
    isPrivate: v.boolean(),
    htmlUrl: v.string(),
    syncStatus: repositorySyncStatusValidator,
    importedCount: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    error: v.optional(v.string()),
    openCount: v.number(),
    closedCount: v.number(),
    /** The counts are being backfilled, so they are not complete yet. */
    counting: v.boolean(),
    /** Closed history: some or every page imported, whether a page is on its way, and how far back it reaches. */
    history: v.object({ started: v.boolean(), complete: v.boolean(), loading: v.boolean(), coveredThrough: v.optional(v.number()) }),
  }),
});
export type Connection = Infer<typeof connectionValidator>;

export function toConnection(link: Doc<"integrationRepositoryLinks">, repository: Doc<"integrationRepositories">): Connection {
  return {
    repositoryLinkId: link._id,
    repositoryId: link.repositoryId,
    status: link.status,
    accountLogin: link.github.accountLogin,
    connectedAt: link.connectedAt,
    deleteAfter: link.deleteAfter,
    error: link.error,
    repository: {
      providerRepositoryId: repository.providerRepositoryId,
      owner: repository.owner,
      name: repository.name,
      isPrivate: repository.isPrivate,
      htmlUrl: repository.htmlUrl,
      syncStatus: repository.syncStatus,
      importedCount: repository.importedCount,
      lastSuccessAt: repository.lastSuccessAt,
      error: repository.error,
      openCount: repository.openCount ?? 0,
      closedCount: repository.closedCount ?? 0,
      counting: repository.openCount === undefined || repository.countedThroughNumber !== undefined,
      history: {
        started: repository.history !== undefined,
        complete: repository.history?.complete === true,
        loading: repository.historyRequest !== undefined,
        coveredThrough: repository.history?.coveredThrough,
      },
    },
  };
}

/** A repository the connecting admin can pick, verified against GitHub when connecting. */
export const verifiedRepositoryValidator = v.object({
  providerRepositoryId: v.number(),
  owner: v.string(),
  name: v.string(),
  isPrivate: v.boolean(),
  htmlUrl: v.string(),
  installationId: v.number(),
  accountLogin: v.string(),
});
export type VerifiedRepository = Infer<typeof verifiedRepositoryValidator>;

/** GitHub's check rollup states: any failure wins, then anything still running. */
export const githubCheckStateValidator = v.union(v.literal("success"), v.literal("failure"), v.literal("pending"));

/** The Overview's live GitHub reads (docs/specs/github-integration.md → PR reader). */
export const pullRequestOverviewValidator = v.object({
  headSha: v.string(),
  baseRef: v.string(),
  htmlUrl: v.string(),
  /** GitHub's `mergeable`: null while it recomputes after a push. */
  mergeable: v.union(v.literal("clean"), v.literal("conflicting"), v.literal("unknown")),
  /** Commits the base has that the head lacks; null when GitHub can't compare them. */
  behindBy: v.union(v.number(), v.null()),
  commitCount: v.number(),
  commits: v.array(v.object({ sha: v.string(), message: v.string(), author: v.string(), committedAt: v.number(), url: v.string() })),
  checks: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      state: githubCheckStateValidator,
      summary: v.string(),
      url: v.union(v.string(), v.null()),
      /** Convoy's own run (a Pull request check): the GitHub checks card hides it, Merge status counts it (OS-2401). */
      fromConvoy: v.boolean(),
    })
  ),
  reviews: v.array(
    v.object({
      id: v.number(),
      author: v.string(),
      authorAvatarUrl: v.union(v.string(), v.null()),
      state: v.union(v.literal("approved"), v.literal("changes_requested"), v.literal("commented"), v.literal("dismissed")),
      submittedAt: v.number(),
      body: v.string(),
      url: v.string(),
    })
  ),
  requestedReviewers: v.array(v.string()),
  comments: v.array(
    v.object({ id: v.number(), author: v.string(), authorAvatarUrl: v.union(v.string(), v.null()), body: v.string(), createdAt: v.number(), url: v.string() })
  ),
  /** Inline comments on the diff; `line` is where it was left, even once outdated. */
  reviewComments: v.array(
    v.object({
      id: v.number(),
      author: v.string(),
      authorAvatarUrl: v.union(v.string(), v.null()),
      body: v.string(),
      createdAt: v.number(),
      url: v.string(),
      path: v.string(),
      line: v.union(v.number(), v.null()),
      /** The commented lines from GitHub's diff hunk, numbered on the commented side. */
      quote: v.array(
        v.object({ kind: v.union(v.literal("add"), v.literal("del"), v.literal("context")), number: v.union(v.number(), v.null()), text: v.string() })
      ),
    })
  ),
  assignees: v.array(v.object({ login: v.string(), avatarUrl: v.union(v.string(), v.null()) })),
  milestone: v.union(v.object({ title: v.string(), url: v.string() }), v.null()),
});
export type PullRequestOverview = Infer<typeof pullRequestOverviewValidator>;

/** A Guide in the PR's Guide menu; the steps come from `guides.get`. */
export const guideSummaryValidator = v.object({
  _id: v.id("integrationPullRequestGuides"),
  status: guideStatusValidator,
  baseSha: v.string(),
  headSha: v.string(),
  cliType: cliTypeValidator,
  cliModel: v.optional(cliModelValidator),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  requester: v.object({ name: v.union(v.string(), v.null()), avatarUrl: v.union(v.string(), v.null()), isViewer: v.boolean() }),
  /** Only for the requester: the run is a private thread. */
  threadId: v.optional(v.id("cliThreads")),
  canDelete: v.boolean(),
});
export type GuideSummary = Infer<typeof guideSummaryValidator>;

export function toGuideSummary(
  row: Doc<"integrationPullRequestGuides">,
  requester: Doc<"users"> | null,
  viewer: { userId: Id<"users">; canManage: boolean }
): GuideSummary {
  const isViewer = row.requesterId === viewer.userId;
  return {
    _id: row._id,
    status: row.status,
    baseSha: row.baseSha,
    headSha: row.headSha,
    cliType: row.cliType,
    cliModel: row.cliModel,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    requester: { name: requester?.name ?? null, avatarUrl: requester?.avatarUrl ?? null, isViewer },
    threadId: isViewer ? row.threadId : undefined,
    canDelete: isViewer || viewer.canManage,
  };
}

export const guideDetailValidator = guideSummaryValidator.extend({ steps: v.array(guideStepValidator) });
export type GuideDetail = Infer<typeof guideDetailValidator>;
