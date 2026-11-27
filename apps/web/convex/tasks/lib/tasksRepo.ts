import type { GenericDatabaseWriter, PaginationOptions, PaginationResult, WithoutSystemFields } from "convex/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { TaskSearchFilters } from "./validators";
import type { Status } from "@/lib/tasks/status";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import { internal } from "../../_generated/api";
import { TASK_PERMANENT_DELETE_DELAY_MS } from "./constants";

type Ctx = QueryCtx | MutationCtx;

export async function getTaskById(ctx: Ctx, taskId: Id<"tasks">): Promise<Doc<"tasks"> | null> {
  return ctx.db.get("tasks", taskId);
}

export async function getActiveTaskById(ctx: Ctx, taskId: Id<"tasks">): Promise<Doc<"tasks"> | null> {
  const task = await ctx.db.get("tasks", taskId);
  if (!task || task.isDeleted) {
    return null;
  }
  return task;
}

export async function getTasksByIds(ctx: Ctx, taskIds: Id<"tasks">[]): Promise<(Doc<"tasks"> | null)[]> {
  return Promise.all(taskIds.map((taskId) => getTaskById(ctx, taskId)));
}

/** Active (non-deleted, non-archived) tasks in a List, sorted by rank via index. */
export async function listActiveTasksInList(ctx: Ctx, projectId: Id<"projects">, listKey: string): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_listKey_and_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false).eq("listKey", listKey)
    )
    .collect();
}

/** Active (non-deleted, non-archived) tasks in a List for one status, sorted by rank via index. */
export async function listActiveTasksInListByStatus(
  ctx: Ctx,
  projectId: Id<"projects">,
  listKey: string,
  status: Status
): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_deleted_archived_listKey_status_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false).eq("listKey", listKey).eq("status", status)
    )
    .collect();
}

/** Archived (non-deleted) tasks for a project, newest archived first. */
export async function listArchivedTasksByProject(ctx: Ctx, projectId: Id<"projects">): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_archivedAt", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", true)
    )
    .order("desc")
    .collect();
}

/** Archived (non-deleted) tasks for a project and one status, newest archived first. */
export async function listArchivedTasksByProjectAndStatus(ctx: Ctx, projectId: Id<"projects">, status: Status): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_deleted_archived_status_archivedAt", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", true).eq("status", status)
    )
    .order("desc")
    .collect();
}

/** Archived (non-deleted) tasks for a project, newest first, paginated. */
export async function paginateArchivedTasksByProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"tasks">>> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_archivedAt", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", true)
    )
    .order("desc")
    .paginate(paginationOpts);
}

/** Non-deleted tasks closed with `status` in `[since, until)`, newest closed first. */
export async function listClosedTasks(
  ctx: Ctx,
  args: { projectId: Id<"projects">; status: Status; limit: number; since?: number; until?: number }
): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_status_and_closedAt", (q) => {
      // The lower bound also skips unstamped rows: `undefined` sorts below every number.
      const from = q.eq("projectId", args.projectId).eq("isDeleted", false).eq("status", args.status).gte("closedAt", args.since ?? 0);
      return args.until === undefined ? from : from.lt("closedAt", args.until);
    })
    .order("desc")
    .take(args.limit);
}

/** Active (non-deleted, non-archived) tasks for a project, newest first, paginated. */
export async function paginateRecentActiveTasksByProject(
  ctx: Ctx,
  projectId: Id<"projects">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"tasks">>> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_createdAt", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false)
    )
    .order("desc")
    .paginate(paginationOpts);
}

/** Direct, non-deleted children of a parent task, sorted by rank via index. */
export async function listChildTasks(ctx: Ctx, parentId: Id<"tasks">): Promise<Doc<"tasks">[]> {
  return ctx.db
    .query("tasks")
    .withIndex("by_parent_and_isDeleted_and_rank", (q) => q.eq("parentId", parentId).eq("isDeleted", false))
    .collect();
}

/** Last (highest-ranked) non-deleted child of a parent, or null. */
export async function getLastChildTaskByRank(ctx: Ctx, parentId: Id<"tasks">): Promise<Doc<"tasks"> | null> {
  return ctx.db
    .query("tasks")
    .withIndex("by_parent_and_isDeleted_and_rank", (q) => q.eq("parentId", parentId).eq("isDeleted", false))
    .order("desc")
    .first();
}

/**
 * The boundary root task (`parentId === undefined`) by rank for a project and
 * archive state. `order: "desc"` returns the last (highest-ranked) root,
 * `order: "asc"` the first (lowest-ranked).
 */
export async function getRootTaskAtRankBoundary(
  ctx: Ctx,
  projectId: Id<"projects">,
  opts: { isArchived: boolean; order: "asc" | "desc" }
): Promise<Doc<"tasks"> | null> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_parentId_and_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", opts.isArchived).eq("parentId", undefined)
    )
    .order(opts.order)
    .first();
}

/** Last (highest-ranked) active (non-deleted, non-archived) task in a List, or null. */
export async function getLastActiveTaskInListByRank(ctx: Ctx, projectId: Id<"projects">, listKey: string): Promise<Doc<"tasks"> | null> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_listKey_and_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false).eq("listKey", listKey)
    )
    .order("desc")
    .first();
}

/**
 * First (lowest-ranked) active ROOT task in a List, or null.
 *
 * No index combines `listKey` and `parentId`, and the lowest-ranked row may be a
 * subtask, so `.first()` would be wrong. `for await` short-circuits on the first
 * root, reading only the leading subtasks plus that root.
 */
export async function getFirstActiveRootTaskInList(ctx: Ctx, projectId: Id<"projects">, listKey: string): Promise<Doc<"tasks"> | null> {
  for await (const task of ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_listKey_and_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false).eq("listKey", listKey)
    )) {
    if (task.parentId === undefined) {
      return task;
    }
  }

  return null;
}

/** A single non-deleted task by its project ref number and archive state. */
export async function findTaskByRefNumber(
  ctx: Ctx,
  projectId: Id<"projects">,
  isArchived: boolean,
  refNumber: number
): Promise<Doc<"tasks"> | null> {
  return ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_refNumber", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", isArchived).eq("refNumber", refNumber)
    )
    .unique();
}

/**
 * Full-text search over non-deleted tasks in a project via the `search_text`
 * index, applying the optional status / assignee / delegation / List filters
 * the same way the search index expects (a `null` assigneeId filter matches
 * unassigned tasks, a `null` delegatedToAgentId filter matches non-delegated
 * ones).
 */
export async function searchTasks(
  ctx: Ctx,
  params: {
    projectId: Id<"projects">;
    text: string;
    isArchived: boolean;
    filters?: TaskSearchFilters;
    listKey?: string | null;
    paginationOpts: PaginationOptions;
  }
): Promise<PaginationResult<Doc<"tasks">>> {
  return ctx.db
    .query("tasks")
    .withSearchIndex("search_text", (q) => {
      let indexedQuery = q
        .search("searchText", params.text)
        .eq("projectId", params.projectId)
        .eq("isDeleted", false)
        .eq("isArchived", params.isArchived);

      if (params.filters?.status !== undefined) {
        indexedQuery = indexedQuery.eq("status", params.filters.status);
      }
      if (params.filters?.assigneeId !== undefined) {
        indexedQuery = indexedQuery.eq("assigneeId", params.filters.assigneeId ?? undefined);
      }
      if (params.filters?.delegatedToAgentId !== undefined) {
        indexedQuery = indexedQuery.eq("delegatedToAgentId", params.filters.delegatedToAgentId ?? undefined);
      }
      if (params.listKey) {
        indexedQuery = indexedQuery.eq("listKey", params.listKey);
      }

      return indexedQuery;
    })
    .paginate(params.paginationOpts);
}

/** Hard-delete a task row. Cascade of related rows is the caller's concern. */
export async function deleteTask(ctx: MutationCtx, taskId: Id<"tasks">): Promise<void> {
  await ctx.db.delete("tasks", taskId);
}

/**
 * Canonical write chokepoint for the `tasks` table (enforced via eslint
 * `no-restricted-syntax`) so managed fields can't be forgotten: these own
 * `createdAt`/`updatedAt`/`closedAt` and default `isDeleted`/`isArchived`.
 *
 * They take a mutation context in production and still accept the raw database
 * writer used by test setup/builders.
 */
type TaskWriteDb = GenericDatabaseWriter<DataModel>;
type TaskWriteTarget = MutationCtx | TaskWriteDb;

type TaskInsertFields = Omit<WithoutSystemFields<Doc<"tasks">>, "createdAt" | "updatedAt" | "closedAt" | "isDeleted" | "isArchived"> & {
  isDeleted?: boolean;
  isArchived?: boolean;
};
type TaskPatchFields = Omit<Partial<WithoutSystemFields<Doc<"tasks">>>, "updatedAt" | "closedAt">;

/** Insert a task, stamping `createdAt`/`updatedAt` and defaulting `isDeleted`/`isArchived`. */
function getTaskWriteDb(target: TaskWriteTarget): TaskWriteDb {
  return "db" in target ? target.db : target;
}

export async function insertTask(target: TaskWriteTarget, fields: TaskInsertFields): Promise<Id<"tasks">> {
  const db = getTaskWriteDb(target);
  const now = Date.now();
  return db.insert("tasks", {
    ...fields,
    isDeleted: fields.isDeleted ?? false,
    isArchived: fields.isArchived ?? false,
    ...(isClosedStatus(fields.status) && { closedAt: now }),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Patch a task, bumping `updatedAt` on every write. Pass `bumpUpdatedAt: false`
 * for denormalized-mirror syncs (e.g. resource counts) so background
 * lifecycle churn does not make the task look user-edited.
 */
export async function patchTask(
  target: TaskWriteTarget,
  id: Id<"tasks">,
  patch: TaskPatchFields,
  opts?: { bumpUpdatedAt?: boolean }
): Promise<void> {
  const db = getTaskWriteDb(target);
  const closedAtPatch = await resolveClosedAtPatch(db, id, patch.status);
  const fullPatch = { ...patch, ...closedAtPatch };
  await db.patch("tasks", id, opts?.bumpUpdatedAt === false ? fullPatch : { ...fullPatch, updatedAt: Date.now() });
}

/** Stamp `closedAt` on a status change into a closed status, clear it on reopen (docs/specs/task-closed-at.md). */
async function resolveClosedAtPatch(
  db: TaskWriteDb,
  id: Id<"tasks">,
  status: Status | undefined
): Promise<{ closedAt?: number | undefined }> {
  if (status === undefined) return {};
  const current = await db.get("tasks", id);
  if (current?.status === status) return {};
  return { closedAt: isClosedStatus(status) ? Date.now() : undefined };
}

/**
 * Move one unit of a denormalized resource counter between two tasks (OS-1711).
 * Source is clamped at zero so retries can't go negative; neither side bumps
 * `updatedAt` (OS-882 — resource changes are recorded via activity logs).
 */
export async function transferTaskResourceCount(
  ctx: MutationCtx,
  args: {
    from: Doc<"tasks">;
    to: Doc<"tasks">;
    field: "artifactCount" | "attachmentCount";
  }
): Promise<void> {
  const { from, to, field } = args;
  await patchTask(ctx, from._id, { [field]: Math.max(0, (from[field] ?? 0) - 1) }, { bumpUpdatedAt: false });
  await patchTask(ctx, to._id, { [field]: (to[field] ?? 0) + 1 }, { bumpUpdatedAt: false });
}

/**
 * Soft-delete a single task and schedule its permanent deletion 30 days from
 * now. Caller is responsible for permission checks and cascading to descendants
 * (since the cascade rules differ between modes — see `remove` / `bulkRemove`).
 */
export async function softDeleteTask(ctx: MutationCtx, taskId: Id<"tasks">, userId: Id<"users">): Promise<void> {
  const scheduledId = await ctx.scheduler.runAfter(TASK_PERMANENT_DELETE_DELAY_MS, internal.tasks.core.permanentlyDelete, { taskId });

  await patchTask(ctx, taskId, {
    isDeleted: true,
    deletedAt: Date.now(),
    deletedBy: userId,
    scheduledDeletionId: scheduledId,
  });
}

/**
 * Whether any active (non-deleted, non-archived) task still lives in the List.
 * Archived tasks do not block List deletion — they keep their stale `listKey`
 * and render as a removed List (see toStructuredTaskList).
 */
export async function hasActiveTasksInList(ctx: Ctx, projectId: Id<"projects">, listKey: string): Promise<boolean> {
  const activeTask = await ctx.db
    .query("tasks")
    .withIndex("by_project_and_isDeleted_and_isArchived_and_listKey_and_rank", (q) =>
      q.eq("projectId", projectId).eq("isDeleted", false).eq("isArchived", false).eq("listKey", listKey)
    )
    .first();

  return activeTask !== null;
}
