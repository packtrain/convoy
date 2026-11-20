import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { action, internalQuery, mutation, query, type ActionCtx, type QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getOptionalAuthenticatedAccess } from "../../lib/access/auth";
import { authorizeProjectAccess } from "../../lib/access/permissions";
import { taskSummaryValidator, toTaskSummary, type TaskSummary } from "../../lib/contracts/taskSummaries";
import { getActiveProjectByAlias, getProjectById } from "../../projects/lib/projectsRepo";
import { findTaskByRefNumber } from "../../tasks/lib/tasksRepo";
import { errors } from "./errors";
import { GithubError, githubFetch, githubGraphql, isAccessLoss, mintRepositoryToken, repoPath, requireConfig, toUserError } from "./lib/github";
import { PAGE_SIZE } from "./lib/constants";
import {
  DIFF_MAX_FILES,
  list as asList,
  normalizeDiffFiles,
  normalizeMergeability,
  normalizeOverview,
  normalizePullRequest,
  normalizeSearchHit,
  num,
  record,
  str,
} from "./lib/parsers";
import { findLinkedPullRequest, getPullRequestByNumber, listStackPullRequests, paginatePullRequests } from "./lib/integrationPullRequestsRepo";
import { getRepositoryById, updateRepositorySync } from "./lib/integrationRepositoriesRepo";
import { getReadableRepositoryLink, getReadableRepositoryLinks } from "./lib/permissions";
import {
  livePullRequestValidator,
  mergeabilityValidator,
  pullRequestDetailValidator,
  pullRequestOverviewValidator,
  pullRequestSearchHitValidator,
  pullRequestSummaryValidator,
  syncContextValidator,
  type Mergeability,
  type PullRequestOverview,
  type PullRequestSearchHit,
  type SyncContext,
  toLivePullRequest,
  toPullRequestDetail,
  toPullRequestSummary,
  toSyncContext,
} from "./lib/validators";

// Stored PR reads. Every read needs project membership and the project's own active link.

/** The project's active links and their repositories, or the one `repositoryId` names. */
async function readableRepositories(ctx: QueryCtx, projectId: Id<"projects">, repositoryId: string | undefined) {
  const links = (await getReadableRepositoryLinks(ctx, projectId)) ?? [];
  const scoped = [];
  for (const link of links) {
    if (repositoryId !== undefined && link.repositoryId !== repositoryId) continue;
    const repository = await getRepositoryById(ctx, link.repositoryId);
    if (repository) scoped.push({ link, repository });
  }
  return scoped;
}

/** Closed rows updated before this may be missing; a repository without history covers nothing yet. */
function historyFloor(repository: Doc<"integrationRepositories">): number {
  if (repository.history?.complete) return -Infinity;
  return repository.history?.coveredThrough ?? Infinity;
}

/**
 * The project's stored PRs across its connected repositories, or one of them
 * when `repositoryId` is set. Closed rows stop at the least-covered
 * repository's history, so a partly imported one leaves no gap in the order.
 */
export const list = query({
  args: {
    projectId: v.id("projects"),
    tab: v.union(v.literal("open"), v.literal("closed")),
    /** From a URL, so any string; only the project's own connected repositories match. */
    repositoryId: v.optional(v.string()),
    sort: v.union(v.literal("updated"), v.literal("created")),
    order: v.union(v.literal("asc"), v.literal("desc")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(pullRequestSummaryValidator),
  handler: async (ctx, { projectId, repositoryId, paginationOpts, ...options }) => {
    const scoped = await readableRepositories(ctx, projectId, repositoryId);
    const floor = options.tab === "closed" ? Math.max(-Infinity, ...scoped.map(({ repository }) => historyFloor(repository))) : -Infinity;
    if (floor === Infinity) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const repositoryIds = scoped.map(({ repository }) => repository._id);
    const result = await paginatePullRequests(
      ctx,
      repositoryIds,
      { ...options, updatedSince: floor === -Infinity ? undefined : floor },
      paginationOpts
    );
    return { ...result, page: result.page.map(toPullRequestSummary) };
  },
});

/** A history request older than this died without releasing itself; the next one replaces it. */
const HISTORY_REQUEST_STALE_MS = 15 * 60 * 1000;

/**
 * Import closed history: the newest page of every repository in scope that
 * has none, and with `more`, the next page of those holding the list back.
 * One page per repository per call; a page already on its way is not asked for again.
 */
export const loadHistory = mutation({
  args: { projectId: v.id("projects"), repositoryId: v.optional(v.string()), more: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { projectId, repositoryId, more }) => {
    const scoped = await readableRepositories(ctx, projectId, repositoryId);
    const floor = Math.max(-Infinity, ...scoped.map(({ repository }) => historyFloor(repository)));
    const now = Date.now();
    for (const { link, repository } of scoped) {
      const own = historyFloor(repository);
      const wanted = own === Infinity || (more && own === floor && own !== -Infinity);
      const pending = repository.historyRequest !== undefined && now - repository.historyRequest.requestedAt < HISTORY_REQUEST_STALE_MS;
      if (!wanted || pending) continue;
      const page = repository.history?.nextPage ?? 1;
      await updateRepositorySync(ctx, repository._id, { historyRequest: { page, requestedAt: now } });
      await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
        repositoryId: repository._id,
        repositoryLinkId: link._id,
        generation: link.generation,
        target: { kind: "history", page, requestedAt: now },
      });
    }
    return null;
  },
});

export const get = query({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: v.union(v.null(), v.object({ pullRequest: v.union(pullRequestDetailValidator, v.null()) })),
  handler: async (ctx, args) => {
    const link = await getReadableRepositoryLink(ctx, args.projectId, args.repositoryId);
    if (!link) {
      return null;
    }
    const row = await getPullRequestByNumber(ctx, link.repositoryId, args.number);
    return { pullRequest: row ? toPullRequestDetail(row) : null };
  },
});

/** An Attached pull request's stored row, matched by name in the project's connected repositories; null outside them. */
export const getAttached = query({
  args: { projectId: v.id("projects"), owner: v.string(), name: v.string(), number: v.number() },
  returns: v.union(pullRequestSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const links = await getReadableRepositoryLinks(ctx, args.projectId);
    const row = links ? await findLinkedPullRequest(ctx, links, args) : null;
    return row ? toPullRequestSummary(row) : null;
  },
});

/** The stored Layers of one stack in a connected repository, bottom first. */
export const stack = query({
  args: { projectId: v.id("projects"), repositoryId: v.string(), stackId: v.number() },
  returns: v.array(pullRequestSummaryValidator),
  handler: async (ctx, args) => {
    const link = await getReadableRepositoryLink(ctx, args.projectId, args.repositoryId);
    return link ? (await listStackPullRequests(ctx, link.repositoryId, args.stackId)).map(toPullRequestSummary) : [];
  },
});

const MAX_TASK_REFS = 10;
// A project alias (as in REF_QUERY_REGEX) and a number, not inside a longer word or number.
const TASK_REF_PATTERN = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,4})-(\d+)(?![0-9])/g;

/** Refs in the PR's title, branch, and labels, upper-cased; never its description (spec: Pull requests and Tasks). */
function taskRefsIn(pr: { title: string; headRef: string; labels: string[] }): { alias: string; refNumber: number }[] {
  const refs = new Map<string, { alias: string; refNumber: number }>();
  for (const value of [pr.title, pr.headRef, ...pr.labels]) {
    for (const [, alias, digits] of value.matchAll(TASK_REF_PATTERN)) {
      const ref = { alias: alias.toUpperCase(), refNumber: Number(digits) };
      refs.set(`${ref.alias}-${ref.refNumber}`, ref);
    }
  }
  return [...refs.values()].slice(0, MAX_TASK_REFS);
}

/** Tasks in the organization whose ref the PR names, each only if the caller can open it. Matched live, never stored. */
export const referencedTasks = query({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: v.array(taskSummaryValidator),
  handler: async (ctx, args) => {
    const link = await getReadableRepositoryLink(ctx, args.projectId, args.repositoryId);
    const row = link ? await getPullRequestByNumber(ctx, link.repositoryId, args.number) : null;
    const auth = row ? await getOptionalAuthenticatedAccess(ctx) : null;
    const project = auth ? await getProjectById(ctx, args.projectId) : null;
    if (!row || !auth || !project) {
      return [];
    }
    const tasks: TaskSummary[] = [];
    for (const { alias, refNumber } of taskRefsIn(row)) {
      const target = await getActiveProjectByAlias(ctx, project.organizationId, alias);
      if (!target || !(await authorizeProjectAccess(ctx, auth.principal, target, ProjectPermission.TASK_VIEW))) continue;
      const task =
        (await findTaskByRefNumber(ctx, target._id, false, refNumber)) ?? (await findTaskByRefNumber(ctx, target._id, true, refNumber));
      if (task) tasks.push(toTaskSummary(task, target));
    }
    return tasks;
  },
});

const readableContextValidator = v.object({
  organizationId: v.id("organizations"),
  repositoryId: v.id("integrationRepositories"),
  repositoryLinkId: v.id("integrationRepositoryLinks"),
  generation: v.number(),
  context: syncContextValidator,
  /** As stored; GitHub's GraphQL follows a rename. */
  owner: v.string(),
  name: v.string(),
  /** The stored row's revision and mergeability, to spot a missed event. */
  stored: v.union(v.object({ baseSha: v.string(), headSha: v.string(), conflicts: v.optional(v.boolean()) }), v.null()),
});
type ReadableContext = Infer<typeof readableContextValidator>;

/** For live reads: the caller's readable link context, rechecked around each fetch. */
export const getReadableContext = internalQuery({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: v.union(readableContextValidator, v.null()),
  handler: async (ctx, args) => {
    const link = await getReadableRepositoryLink(ctx, args.projectId, args.repositoryId);
    const repository = link ? await getRepositoryById(ctx, link.repositoryId) : null;
    if (!link || !repository) {
      return null;
    }
    const row = await getPullRequestByNumber(ctx, link.repositoryId, args.number);
    return {
      organizationId: link.organizationId,
      repositoryId: link.repositoryId,
      repositoryLinkId: link._id,
      generation: link.generation,
      context: toSyncContext(link, repository),
      owner: repository.owner,
      name: repository.name,
      stored: row ? { baseSha: row.baseSha, headSha: row.headSha, conflicts: row.conflicts } : null,
    };
  },
});

// --- Live reads ---

type ReadArgs = { projectId: Id<"projects">; repositoryId: string; number: number };

/**
 * Runs `read` with a repository-scoped token, then rechecks access, since it
 * may have been removed while GitHub answered. A token GitHub refuses
 * schedules the access check a missed webhook would have.
 */
async function readLive<T>(
  ctx: ActionCtx,
  args: ReadArgs,
  read: (token: string, context: SyncContext) => Promise<T>,
  notFound: string
): Promise<{ result: T; live: ReadableContext }> {
  const config = requireConfig();
  const readable = async () => {
    const result = await ctx.runQuery(internal.integrations.github.pullRequests.getReadableContext, args);
    if (!result) throw new ConvexError(errors.NOT_CONNECTED);
    return result;
  };
  const live = await readable();
  let token: string;
  try {
    token = await mintRepositoryToken(config, live.context.installationId, live.context.providerRepositoryId);
  } catch (error) {
    if (!isAccessLoss(error)) throw toUserError(error);
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.confirmRepositoryAccess, {
      repositoryLinkId: live.repositoryLinkId,
      expectedGeneration: live.generation,
    });
    throw new ConvexError(errors.NOT_CONNECTED);
  }
  const result = await read(token, live.context).catch((error: unknown) => {
    throw toUserError(error, notFound);
  });
  if ((await readable()).generation !== live.generation) throw new ConvexError(errors.NOT_CONNECTED);
  return { result, live };
}

/** The stored row missed an event; repair it in the background. */
async function scheduleRefresh(ctx: ActionCtx, live: ReadableContext, number: number) {
  await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
    repositoryId: live.repositoryId,
    repositoryLinkId: live.repositoryLinkId,
    generation: live.generation,
    target: { kind: "pullRequest", number },
  });
}

const diffFileStatusValidator = v.union(v.literal("added"), v.literal("removed"), v.literal("modified"), v.literal("renamed"));

const diffFileValidator = v.object({
  path: v.string(),
  previousPath: v.optional(v.string()),
  status: diffFileStatusValidator,
  additions: v.number(),
  deletions: v.number(),
  sha: v.optional(v.string()),
  patch: v.optional(v.string()),
});

const diffValidator = v.object({
  /** The PR at this revision, for a reader with no stored row. */
  pullRequest: livePullRequestValidator,
  baseSha: v.string(),
  headSha: v.string(),
  htmlUrl: v.string(),
  changedFiles: v.number(),
  partial: v.boolean(),
  files: v.array(diffFileValidator),
});

export const readDiff = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: diffValidator,
  handler: async (ctx, args): Promise<Infer<typeof diffValidator>> => {
    const { result, live } = await readLive(ctx, args, (token, context) => readRevision(token, context, args.number), errors.PULL_REQUEST_NOT_FOUND);
    const { pullRequest, ...diff } = result;
    // Only a stored row is repaired: browsing a PR Convoy never stored writes nothing.
    if (live.stored && (live.stored.baseSha !== diff.baseSha || live.stored.headSha !== diff.headSha)) {
      await scheduleRefresh(ctx, live, args.number);
    }
    return { ...diff, pullRequest: toLivePullRequest(live.repositoryId, pullRequest) };
  },
});

/** One consistent revision: the PR is read before and after its files, retried once on a push. */
async function readRevision(
  token: string,
  context: SyncContext,
  number: number
): Promise<Omit<Infer<typeof diffValidator>, "pullRequest"> & { pullRequest: ReturnType<typeof normalizePullRequest> }> {
  const auth = { token };
  const prPath = `${repoPath(context)}/pulls/${number}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = record(await githubFetch(prPath, auth));
    const rawFiles = asList(await githubFetch(`${prPath}/files?per_page=${DIFF_MAX_FILES}`, auth));
    const after = record(await githubFetch(prPath, auth));
    const [baseSha, headSha] = [str(record(before.base).sha), str(record(before.head).sha)];
    if (baseSha !== str(record(after.base).sha) || headSha !== str(record(after.head).sha)) {
      continue;
    }
    const { files, omitted } = normalizeDiffFiles(rawFiles);
    const changedFiles = num(before.changed_files);
    return {
      pullRequest: normalizePullRequest(after),
      baseSha,
      headSha,
      htmlUrl: str(before.html_url),
      changedFiles,
      partial: omitted || files.length < changedFiles,
      files,
    };
  }
  throw new ConvexError(errors.PULL_REQUEST_CHANGED);
}

/**
 * The Overview's GitHub data for the displayed diff's head: commits, checks,
 * reviews, comments, mergeability, and how far the base moved.
 */
export const readOverview = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number(), baseSha: v.string(), headSha: v.string() },
  returns: pullRequestOverviewValidator,
  handler: async (ctx, { baseSha, headSha, ...args }): Promise<PullRequestOverview> => {
    const { result: overview, live } = await readLive(
      ctx,
      args,
      (token, context) => readOverviewFrom(token, context, args.number, { baseSha, headSha }, requireConfig().appId),
      errors.PULL_REQUEST_NOT_FOUND
    );
    await repairConflictsMark(ctx, live, args.number, overview);
    return overview;
  },
});

/** The displayed revision's mergeability, from one PR read; null once the PR moved past that revision. */
export const readMergeability = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number(), baseSha: v.string(), headSha: v.string() },
  returns: v.union(mergeabilityValidator, v.null()),
  handler: async (ctx, { baseSha, headSha, ...args }): Promise<Mergeability | null> => {
    const { result: pr, live } = await readLive(
      ctx,
      args,
      async (token, context) => record(await githubFetch(`${repoPath(context)}/pulls/${args.number}`, { token })),
      errors.PULL_REQUEST_NOT_FOUND
    );
    if (str(record(pr.head).sha) !== headSha || str(record(pr.base).sha) !== baseSha) return null;
    const mergeability = normalizeMergeability(pr);
    await repairConflictsMark(ctx, live, args.number, mergeability);
    return mergeability;
  },
});

/** The list's Conflicts mark comes from the stored row; GitHub sends no event when mergeability settles. */
async function repairConflictsMark(ctx: ActionCtx, live: ReadableContext, number: number, { mergeable }: Mergeability) {
  const conflicts = mergeable === "unknown" ? undefined : mergeable === "conflicting";
  if (live.stored && conflicts !== undefined && live.stored.conflicts !== conflicts) await scheduleRefresh(ctx, live, number);
}

/** A compare GitHub can't answer (the base branch was deleted) leaves behind-by unknown. */
async function compareOrNull(path: string, auth: { token: string }): Promise<unknown> {
  return githubFetch(path, auth).catch((error: unknown) => {
    if (error instanceof GithubError && (error.status === 404 || error.status === 422)) return null;
    throw error;
  });
}

/** GraphQL's PR node: the repository's merge settings (through the PR, so a rename can't matter) and its review threads. GitHub refusing leaves them unknown. */
async function pullRequestNode(token: string, pullRequestId: string): Promise<unknown> {
  const query = `query($id: ID!) { node(id: $id) { ... on PullRequest {
    repository { mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge }
    reviewThreads(first: 100) { nodes { isResolved isOutdated path line originalLine comments(first: 1) { nodes { author { login } body } } } }
  } } }`;
  try {
    return record(record(await githubGraphql(token, query, { id: pullRequestId })).node);
  } catch (error) {
    if (error instanceof GithubError && !error.rateLimited) return null;
    throw error;
  }
}

// ponytail: first 100 commits, reviews, comments, review threads, and checks; page them when PRs outgrow that.
// A push or base change before or during the read would mix revisions, so the PR must stay at the diff's revision.
async function readOverviewFrom(
  token: string,
  context: SyncContext,
  number: number,
  { baseSha, headSha }: { baseSha: string; headSha: string },
  appId: string
): Promise<PullRequestOverview> {
  const auth = { token };
  const base = repoPath(context);
  const readPr = async () => {
    const pr = record(await githubFetch(`${base}/pulls/${number}`, auth));
    if (str(record(pr.head).sha) !== headSha || str(record(pr.base).sha) !== baseSha) throw new ConvexError(errors.PULL_REQUEST_CHANGED);
    return pr;
  };
  const pr = await readPr();
  const [commits, reviews, comments, reviewComments, checkRuns, status, compare, node] = await Promise.all([
    githubFetch(`${base}/pulls/${number}/commits?per_page=100`, auth),
    githubFetch(`${base}/pulls/${number}/reviews?per_page=100`, auth),
    githubFetch(`${base}/issues/${number}/comments?per_page=100`, auth),
    githubFetch(`${base}/pulls/${number}/comments?per_page=100`, auth),
    githubFetch(`${base}/commits/${headSha}/check-runs?per_page=100`, auth),
    githubFetch(`${base}/commits/${headSha}/status?per_page=100`, auth),
    compareOrNull(`${base}/compare/${baseSha}...${headSha}?per_page=1`, auth),
    pullRequestNode(token, str(pr.node_id)),
  ]);
  await readPr();
  return normalizeOverview(appId, { pr, commits, reviews, comments, reviewComments, checkRuns, status, compare, node });
}

/** Contents API limit for base64 bodies; larger files come back without content. */
const FILE_MAX_BYTES = 1024 * 1024;

const fileContentsValidator = v.union(
  v.object({ kind: v.literal("text"), contents: v.string() }),
  v.object({ kind: v.literal("binary") }),
  v.object({ kind: v.literal("tooLarge") })
);

/** A changed file's whole contents at one revision (`ref` is the diff's head SHA, or its base SHA for a deleted file). */
export const readFile = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number(), path: v.string(), ref: v.string() },
  returns: fileContentsValidator,
  handler: async (ctx, { path, ref, ...args }): Promise<Infer<typeof fileContentsValidator>> => {
    const { result } = await readLive(
      ctx,
      args,
      async (token, context) => {
        const encoded = path.split("/").map(encodeURIComponent).join("/");
        return record(await githubFetch(`${repoPath(context)}/contents/${encoded}?ref=${encodeURIComponent(ref)}`, { token }));
      },
      errors.FILE_NOT_FOUND
    );
    if (result.type !== "file") throw new ConvexError(errors.FILE_NOT_FOUND);
    if (num(result.size) > FILE_MAX_BYTES || result.encoding !== "base64") return { kind: "tooLarge" };
    const bytes = Uint8Array.from(atob(str(result.content).replace(/\s/g, "")), (char) => char.charCodeAt(0));
    // Git's own heuristic: a NUL byte means binary.
    if (bytes.includes(0)) return { kind: "binary" };
    return { kind: "text", contents: new TextDecoder().decode(bytes) };
  },
});

// --- Live search ---

const searchScopeValidator = v.array(
  v.object({
    repositoryId: v.id("integrationRepositories"),
    generation: v.number(),
    installationId: v.number(),
    providerRepositoryId: v.number(),
    /** owner/name as GitHub spells it. */
    fullName: v.string(),
  })
);
type SearchScope = Infer<typeof searchScopeValidator>[number];

/** The repositories a search may cover: the caller's readable links in the project. */
export const getSearchScope = internalQuery({
  args: { projectId: v.id("projects"), repositoryId: v.optional(v.string()) },
  returns: searchScopeValidator,
  handler: async (ctx, args) =>
    (await readableRepositories(ctx, args.projectId, args.repositoryId)).map(({ link, repository }) => ({
      repositoryId: repository._id,
      generation: link.generation,
      installationId: link.github.installationId,
      providerRepositoryId: repository.providerRepositoryId,
      fullName: `${repository.owner}/${repository.name}`,
    })),
});

/** Repositories per search request; their `repo:` qualifiers OR together. */
const SEARCH_REPOSITORIES_PER_REQUEST = 10;
/** Requests per search page, bounding the fan-out of a project with many repositories. */
const SEARCH_MAX_REQUESTS = 5;
/** GitHub's search API returns at most this many results per query. */
const SEARCH_RESULT_CAP = 1000;
const SEARCH_MAX_QUERY_LENGTH = 256;

/** Each word quoted, so the member's text can't add qualifiers or operators that widen the scope. */
function searchTerms(query: string): string {
  return query
    .slice(0, SEARCH_MAX_QUERY_LENGTH)
    .split(/\s+/)
    .map((word) => word.replace(/["\\]/g, ""))
    .filter(Boolean)
    .map((word) => `"${word}"`)
    .join(" ");
}

const searchResultValidator = v.object({
  pullRequests: v.array(pullRequestSearchHitValidator),
  hasMore: v.boolean(),
  /** GitHub timed out or has more hits than it returns, so narrow by repository or date. */
  incomplete: v.boolean(),
  /** Repositories past the fan-out bound, left out of this search. */
  omittedRepositories: v.number(),
  failures: v.array(v.object({ repositories: v.array(v.string()), message: v.string() })),
});
type SearchResult = Infer<typeof searchResultValidator>;

type SearchAnswer =
  | { repositories: SearchScope[]; hits: ReturnType<typeof normalizeSearchHit>[]; total: number; incomplete: boolean }
  | { repositories: SearchScope[]; failure: string };

/**
 * Live GitHub search across the project's connected repositories (all states),
 * one request per installation and up to 10 repositories. Writes nothing;
 * every hit is checked against the repositories still connected after GitHub answers.
 */
export const search = action({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    repositoryId: v.optional(v.string()),
    sort: v.union(v.literal("updated"), v.literal("created")),
    order: v.union(v.literal("asc"), v.literal("desc")),
    page: v.number(),
  },
  returns: searchResultValidator,
  handler: async (ctx, { projectId, repositoryId, query, sort, order, ...args }): Promise<SearchResult> => {
    const terms = searchTerms(query);
    const scope = terms ? await ctx.runQuery(internal.integrations.github.pullRequests.getSearchScope, { projectId, repositoryId }) : [];
    if (!scope.length) {
      return { pullRequests: [], hasMore: false, incomplete: false, omittedRepositories: 0, failures: [] };
    }
    const config = requireConfig();
    const page = Math.max(1, Math.floor(args.page));
    const byInstallation = Map.groupBy(scope, (repository) => repository.installationId);
    const sources = [...byInstallation.values()].flatMap((repositories) =>
      Array.from({ length: Math.ceil(repositories.length / SEARCH_REPOSITORIES_PER_REQUEST) }, (_, index) =>
        repositories.slice(index * SEARCH_REPOSITORIES_PER_REQUEST, (index + 1) * SEARCH_REPOSITORIES_PER_REQUEST)
      )
    );
    const answers = await Promise.all(
      sources.slice(0, SEARCH_MAX_REQUESTS).map(async (repositories): Promise<SearchAnswer> => {
        try {
          const token = await mintRepositoryToken(config, repositories[0].installationId, ...repositories.map((r) => r.providerRepositoryId));
          const q = `is:pr ${repositories.map((r) => `repo:${r.fullName}`).join(" ")} ${terms}`;
          const params = new URLSearchParams({ q, sort, order, per_page: String(PAGE_SIZE), page: String(page) });
          const body = record(await githubFetch(`/search/issues?${params}`, { token }));
          return { repositories, hits: asList(body.items).map(normalizeSearchHit), total: num(body.total_count), incomplete: body.incomplete_results === true };
        } catch (error) {
          const userError = toUserError(error);
          return { repositories, failure: userError instanceof ConvexError ? String(userError.data) : errors.GITHUB_UNAVAILABLE };
        }
      })
    );
    // Access may have changed while GitHub answered; a hit counts only for a repository its own request covered.
    const still = new Map(
      (await ctx.runQuery(internal.integrations.github.pullRequests.getSearchScope, { projectId, repositoryId })).map((r) => [
        r.fullName.toLowerCase(),
        r,
      ])
    );
    const pullRequests: PullRequestSearchHit[] = [];
    for (const answer of answers) {
      if ("failure" in answer) continue;
      for (const { fullName, ...hit } of answer.hits) {
        const repository = still.get(fullName);
        const asked = repository && answer.repositories.some((r) => r.repositoryId === repository.repositoryId && r.generation === repository.generation);
        if (repository && asked) pullRequests.push({ ...hit, repositoryId: repository.repositoryId });
      }
    }
    // Page N of every request; the client sorts what it has loaded, so a later page can add newer hits above.
    const succeeded = answers.flatMap((answer) => ("failure" in answer ? [] : [answer]));
    return {
      pullRequests,
      hasMore: succeeded.some((a) => a.hits.length === PAGE_SIZE && page * PAGE_SIZE < Math.min(a.total, SEARCH_RESULT_CAP)),
      incomplete: succeeded.some((a) => a.incomplete || a.total > SEARCH_RESULT_CAP),
      omittedRepositories: sources.slice(SEARCH_MAX_REQUESTS).flat().length,
      failures: answers.flatMap((a) => ("failure" in a ? [{ repositories: a.repositories.map((r) => r.fullName), message: a.failure }] : [])),
    };
  },
});
