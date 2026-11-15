import type { BoardRowGroupBy, ListGroupBy } from "../../lib/contracts/validators";
import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { appendRank } from "./ranking";
import { INBOX_LIST_NAME, INBOX_LIST_REF } from "./lists/resolution";
import { createTaskListSearchText, normalizeListName, normalizeTaskListRefForLookup } from "./lists/naming";
import type { BoardGroupBy, ProjectViewMode } from "../../lib/contracts/validators";

type Ctx = QueryCtx | MutationCtx;

export function normalizeTaskListId(ctx: Ctx, id: string): Id<"taskLists"> | null {
  return ctx.db.normalizeId("taskLists", id);
}

export async function getTaskListById(ctx: Ctx, listId: Id<"taskLists">): Promise<Doc<"taskLists"> | null> {
  return ctx.db.get("taskLists", listId);
}

export async function getTaskListsByIds(ctx: Ctx, listIds: Id<"taskLists">[]): Promise<(Doc<"taskLists"> | null)[]> {
  return Promise.all(listIds.map((listId) => getTaskListById(ctx, listId)));
}

/** Lookup by ref, normalizing first; null for refs that can't be valid. */
export async function findTaskListByRefForProject(ctx: Ctx, projectId: Id<"projects">, ref: string): Promise<Doc<"taskLists"> | null> {
  const normalizedRef = normalizeTaskListRefForLookup(ref);
  if (!normalizedRef) {
    return null;
  }

  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_ref", (q) => q.eq("projectId", projectId).eq("ref", normalizedRef))
    .unique();
}

export async function findTaskListByNormalizedName(
  ctx: Ctx,
  projectId: Id<"projects">,
  normalizedName: string
): Promise<Doc<"taskLists"> | null> {
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_normalizedName", (q) => q.eq("projectId", projectId).eq("normalizedName", normalizedName))
    .unique();
}

/** First `limit` active (non-archived) Lists — enough for limit/last-one checks. */
export async function listActiveTaskLists(ctx: Ctx, projectId: Id<"projects">, limit: number): Promise<Doc<"taskLists">[]> {
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isArchived_and_rank", (q) => q.eq("projectId", projectId).eq("isArchived", false))
    .take(limit);
}

/** First `limit` pinned Lists — enough for limit checks. */
export async function listPinnedTaskLists(ctx: Ctx, projectId: Id<"projects">, limit: number): Promise<Doc<"taskLists">[]> {
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isPinned_and_rank", (q) => q.eq("projectId", projectId).eq("isPinned", true))
    .take(limit);
}

/** All pinned Lists for a project, pre-sorted by List rank via the index. */
export async function listPinnedTaskListsByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"taskLists">[]> {
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isPinned_and_rank", (q) => q.eq("projectId", projectId).eq("isPinned", true))
    .collect();
}

/** Last (highest-ranked) active List in a project, for append-to-end rank computation. */
export async function getLastActiveTaskListByRank(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"taskLists"> | null> {
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isArchived_and_rank", (q) => q.eq("projectId", projectId).eq("isArchived", false))
    .order("desc")
    .first();
}

/**
 * Paginated Lists for a project. With a `queryText` it searches the
 * full-text `search_text` index; otherwise it lists by rank via the
 * `by_project_and_isArchived_and_rank` index. Both scope to the given archived
 * state.
 */
export async function paginateTaskLists(
  ctx: Ctx,
  args: {
    projectId: Id<"projects">;
    isArchived: boolean;
    queryText?: string;
    paginationOpts: PaginationOptions;
  }
): Promise<PaginationResult<Doc<"taskLists">>> {
  const { projectId, isArchived, queryText, paginationOpts } = args;
  if (queryText) {
    return ctx.db
      .query("taskLists")
      .withSearchIndex("search_text", (q) => q.search("searchText", queryText).eq("projectId", projectId).eq("isArchived", isArchived))
      .paginate(paginationOpts);
  }
  return ctx.db
    .query("taskLists")
    .withIndex("by_project_and_isArchived_and_rank", (q) => q.eq("projectId", projectId).eq("isArchived", isArchived))
    .paginate(paginationOpts);
}

/**
 * Insert a List, computing `normalizedName`/`searchText` and stamping
 * `createdBy`/`updatedBy`/`createdAt`/`updatedAt`/`isArchived`. Callers pass
 * only the user-supplied props (and an already-validated `color`).
 */
export async function insertTaskList(
  ctx: MutationCtx,
  props: {
    projectId: Id<"projects">;
    name: string;
    ref: string;
    color?: string;
    rank: string;
    isPinned?: boolean;
    pinnedAt?: number;
    pinnedBy?: Id<"users">;
    defaultViewMode?: ProjectViewMode;
    defaultBoardGroupBy?: BoardGroupBy;
    defaultListGroupBy?: ListGroupBy;
    defaultBoardRowGroupBy?: BoardRowGroupBy;
  },
  createdBy: Id<"users">
): Promise<Id<"taskLists">> {
  const now = Date.now();
  return ctx.db.insert("taskLists", {
    projectId: props.projectId,
    name: props.name,
    normalizedName: normalizeListName(props.name),
    ref: props.ref,
    rank: props.rank,
    ...(props.color === undefined ? {} : { color: props.color }),
    ...(props.isPinned === undefined ? {} : { isPinned: props.isPinned }),
    ...(props.pinnedAt === undefined ? {} : { pinnedAt: props.pinnedAt }),
    ...(props.pinnedBy === undefined ? {} : { pinnedBy: props.pinnedBy }),
    ...(props.defaultViewMode === undefined ? {} : { defaultViewMode: props.defaultViewMode }),
    ...(props.defaultListGroupBy === undefined ? {} : { defaultListGroupBy: props.defaultListGroupBy }),
    ...(props.defaultBoardGroupBy === undefined ? {} : { defaultBoardGroupBy: props.defaultBoardGroupBy }),
    ...(props.defaultBoardRowGroupBy === undefined ? {} : { defaultBoardRowGroupBy: props.defaultBoardRowGroupBy }),
    searchText: createTaskListSearchText(props.name, props.ref),
    isArchived: false,
    createdBy,
    updatedBy: createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export type TaskListUpdatePatch = {
  name?: string;
  normalizedName?: string;
  ref?: string;
  searchText?: string;
  // The pin/archive fields below (and `color`) clear when patched to an
  // explicit `undefined` — Convex removes fields patched to `undefined`.
  color?: string;
  rank?: string;
  isPinned?: boolean;
  pinnedAt?: number;
  pinnedBy?: Id<"users">;
  isArchived?: boolean;
  archivedAt?: number;
  archivedBy?: Id<"users">;
  // Absent = inherit the project default view; cleared the same way.
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  defaultListGroupBy?: ListGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
};

/**
 * Patch a List, stamping `updatedBy`/`updatedAt` so callers never repeat them.
 * The patch is applied as-is, so an explicit `undefined` value clears that
 * field (pin/archive transitions rely on this).
 */
export async function updateTaskList(
  ctx: MutationCtx,
  listId: Id<"taskLists">,
  patch: TaskListUpdatePatch,
  updatedBy: Id<"users">
): Promise<void> {
  await ctx.db.patch("taskLists", listId, {
    ...patch,
    updatedBy,
    updatedAt: Date.now(),
  });
}

export async function deleteTaskList(ctx: MutationCtx, listId: Id<"taskLists">): Promise<void> {
  await ctx.db.delete("taskLists", listId);
}

/**
 * Insert the project's persisted "Inbox" List (`projects.core.create`,
 * `users.core.onboard`, the OS-842 backfill). Bypasses `tasks.lists.create`, which
 * needs an authenticated principal. Callers that may run against existing data should
 * reuse an existing INBOX via `findTaskListByRefForProject` first. Starts pinned to the sidebar.
 */
export async function createInboxList(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; userId: Id<"users"> }
): Promise<Id<"taskLists">> {
  const lastList = await getLastActiveTaskListByRank(ctx, args.projectId);
  return insertTaskList(
    ctx,
    {
      projectId: args.projectId,
      name: INBOX_LIST_NAME,
      ref: INBOX_LIST_REF,
      rank: appendRank(lastList?.rank),
      isPinned: true,
      pinnedAt: Date.now(),
      pinnedBy: args.userId,
    },
    args.userId
  );
}
