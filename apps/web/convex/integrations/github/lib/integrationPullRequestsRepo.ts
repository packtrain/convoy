import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { PaginationOptions, PaginationResult } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import schema from "../../../schema";
import { type NormalizedPullRequest, type PullRequestState } from "../../../lib/contracts/github";
import { findLinkedRepository } from "./integrationRepositoriesRepo";

type Ctx = QueryCtx | MutationCtx;

export async function getPullRequestByNumber(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">,
  number: number
): Promise<Doc<"integrationPullRequests"> | null> {
  return ctx.db
    .query("integrationPullRequests")
    .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).eq("number", number))
    .unique();
}

/** A PR named `owner/name#number`, stored in one of `links`' repositories; null outside them. */
export async function findLinkedPullRequest(
  ctx: Ctx,
  links: Doc<"integrationRepositoryLinks">[],
  pr: { owner: string; name: string; number: number }
): Promise<Doc<"integrationPullRequests"> | null> {
  const linked = await findLinkedRepository(ctx, links, pr);
  return linked ? getPullRequestByNumber(ctx, linked.repository._id, pr.number) : null;
}

export type PullRequestListOptions = {
  /** Open includes drafts; closed includes merged. */
  tab: "open" | "closed";
  sort: "updated" | "created";
  order: "asc" | "desc";
  /** Only rows updated at or after this (closed history's coverage). */
  updatedSince?: number;
  /** The You filters: only rows this GitHub person authored, or is assigned to. */
  author?: GithubPerson;
  assignee?: GithubPerson;
};

type GithubPerson = { userId: number; login: string };

/** Filtered pages stop after this many rows read, ending short with Load more. */
const FILTERED_MAX_ROWS_READ = 500;

// ponytail: rows synced before IDs were stored match by login, which a GitHub rename breaks until their next sync.
function matchesPeople(row: Doc<"integrationPullRequests">, { author, assignee }: PullRequestListOptions): boolean {
  const authored = !author || (row.authorId !== undefined ? row.authorId === author.userId : row.author === author.login);
  const assigned =
    !assignee || (row.assigneeIds ? row.assigneeIds.includes(assignee.userId) : (row.assignees ?? []).includes(assignee.login));
  return authored && assigned;
}

/** One list over several repositories, merged in index order (one stream per repository and state). */
export async function paginatePullRequests(
  ctx: Ctx,
  repositoryIds: Id<"integrationRepositories">[],
  options: PullRequestListOptions,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"integrationPullRequests">>> {
  const states: PullRequestState[] = options.tab === "open" ? ["open"] : ["closed", "merged"];
  const index =
    options.sort === "created" ? "by_repositoryId_and_state_and_providerCreatedAt" : "by_repositoryId_and_state_and_providerUpdatedAt";
  const field = options.sort === "created" ? "providerCreatedAt" : "providerUpdatedAt";
  const since = options.updatedSince;
  const streams = repositoryIds.flatMap((repositoryId) =>
    states.map((state) => {
      if (options.sort === "updated") {
        return stream(ctx.db, schema)
          .query("integrationPullRequests")
          .withIndex(index, (q) => {
            const scoped = q.eq("repositoryId", repositoryId).eq("state", state);
            return since === undefined ? scoped : scoped.gte("providerUpdatedAt", since);
          })
          .order(options.order);
      }
      const created = stream(ctx.db, schema)
        .query("integrationPullRequests")
        .withIndex(index, (q) => q.eq("repositoryId", repositoryId).eq("state", state))
        .order(options.order);
      // ponytail: skips rows past the coverage by reading them; add a created-time cursor if that scan grows.
      return since === undefined ? created : created.filterWith(async (row) => row.providerUpdatedAt >= since);
    })
  );
  if (streams.length === 0) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  if (!options.author && !options.assignee) {
    return mergedStream(streams, [field]).paginate(paginationOpts);
  }
  const filtered = streams.map((rows) => rows.filterWith(async (row) => matchesPeople(row, options)));
  return mergedStream(filtered, [field]).paginate({ ...paginationOpts, maximumRowsRead: FILTERED_MAX_ROWS_READ });
}

/** The stored Layers of one stack, bottom first. A stack holds a handful of PRs. */
export async function listStackPullRequests(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">,
  stackId: number
): Promise<Doc<"integrationPullRequests">[]> {
  const rows = await ctx.db
    .query("integrationPullRequests")
    .withIndex("by_repositoryId_and_stackId", (q) => q.eq("repositoryId", repositoryId).eq("stack.id", stackId))
    .take(50);
  return rows.sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0));
}

/** The stored open PR least recently updated, or null. */
export async function getStalestOpenPullRequest(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">
): Promise<Doc<"integrationPullRequests"> | null> {
  return ctx.db
    .query("integrationPullRequests")
    .withIndex("by_repositoryId_and_state_and_providerUpdatedAt", (q) => q.eq("repositoryId", repositoryId).eq("state", "open"))
    .first();
}

/** The repository's PRs numbered above `after`, lowest first. */
export async function listPullRequestsAfterNumber(
  ctx: Ctx,
  repositoryId: Id<"integrationRepositories">,
  after: number,
  limit: number
): Promise<Doc<"integrationPullRequests">[]> {
  return ctx.db
    .query("integrationPullRequests")
    .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId).gt("number", after))
    .take(limit);
}

const FIELDS = [
  "title",
  "description",
  "author",
  "authorId",
  "state",
  "draft",
  "headRef",
  "baseRef",
  "headSha",
  "baseSha",
  "providerUpdatedAt",
  "archived",
] as const satisfies readonly (keyof NormalizedPullRequest)[];

function isUnchanged(existing: Doc<"integrationPullRequests">, incoming: NormalizedPullRequest): boolean {
  return (
    FIELDS.every((field) => existing[field] === incoming[field]) &&
    (incoming.conflicts === undefined || existing.conflicts === incoming.conflicts) &&
    JSON.stringify(existing.stack) === JSON.stringify(incoming.stack) &&
    existing.labels.length === incoming.labels.length &&
    existing.labels.every((label, index) => label === incoming.labels[index]) &&
    JSON.stringify(existing.assignees ?? []) === JSON.stringify(incoming.assignees ?? []) &&
    JSON.stringify(existing.assigneeIds) === JSON.stringify(incoming.assigneeIds)
  );
}

/**
 * One row per repository and number. Older provider timestamps never
 * overwrite newer ones; equal timestamps win because the caller holds the
 * repository lease, so its fetch is the latest. Unchanged rows are not written.
 */
export async function upsertPullRequest(
  ctx: MutationCtx,
  repositoryId: Id<"integrationRepositories">,
  incoming: NormalizedPullRequest,
  /** Closed history is imported only on request, so sweeps update closed rows but never add them. */
  options: { insertClosed: boolean } = { insertClosed: true }
): Promise<{ written: false } | { written: true; previousState: PullRequestState | null }> {
  const existing = await getPullRequestByNumber(ctx, repositoryId, incoming.number);
  if (!existing) {
    if (!options.insertClosed && incoming.state !== "open") {
      return { written: false };
    }
    await ctx.db.insert("integrationPullRequests", { repositoryId, ...incoming, syncedAt: Date.now() });
    return { written: true, previousState: null };
  }
  if (incoming.providerUpdatedAt < existing.providerUpdatedAt || isUnchanged(existing, incoming)) {
    return { written: false };
  }
  // Unknown mergeability (list pages, or GitHub still computing) keeps the stored value. Function
  // args drop undefined fields, so name the clearable ones: patching them to undefined removes them.
  const { conflicts, ...rest } = incoming;
  await ctx.db.patch("integrationPullRequests", existing._id, {
    ...rest,
    stack: incoming.stack,
    archived: incoming.archived,
    ...(conflicts === undefined ? {} : { conflicts }),
    syncedAt: Date.now(),
  });
  return { written: true, previousState: existing.state };
}

/** Deletes up to `limit` of the repository's PRs; returns how many were deleted. */
export async function deletePullRequestsBatch(
  ctx: MutationCtx,
  repositoryId: Id<"integrationRepositories">,
  limit: number
): Promise<number> {
  const rows = await ctx.db
    .query("integrationPullRequests")
    .withIndex("by_repositoryId_and_number", (q) => q.eq("repositoryId", repositoryId))
    .take(limit);
  for (const row of rows) {
    await ctx.db.delete("integrationPullRequests", row._id);
  }
  return rows.length;
}
