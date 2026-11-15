import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { createPersistedTaskListKey, parsePersistedTaskListKey, type PersistedTaskListKey } from "../../../lib/contracts/taskListKeys";
import {
  BACKLOG_SYSTEM_LIST,
  isBacklogListRef,
} from "@/lib/task-lists/system-lists";
import { ensure } from "../../../lib/shared/ensure";
import { findTaskListByRefForProject, getTaskListById, getTaskListsByIds, normalizeTaskListId } from "../taskListsRepo";
import { errors } from "../../errors";

type DbCtx = QueryCtx | MutationCtx;

type ResolvedPersistedTaskList = {
  list: Doc<"taskLists">;
  listKey: string;
};

export type ResolvedSystemTaskList = {
  system: typeof BACKLOG_SYSTEM_LIST.key;
  listKey: typeof BACKLOG_SYSTEM_LIST.listKey;
};

export type ResolvedProjectTaskList =
  | ResolvedPersistedTaskList
  | ResolvedSystemTaskList;

function resolveListIdentifierArgs(args: {
  listId?: string;
  listRef?: string;
}): string | undefined {
  ensure(args).satisfies((a) => a.listId === undefined || a.listRef === undefined, errors.LIST_IDENTIFIER_CONFLICT);
  return args.listId ?? args.listRef;
}

export async function resolvePersistedProjectTaskList(
  ctx: DbCtx,
  args: {
    projectId: Id<"projects">;
    identifier: string;
    activeOnly?: boolean;
    rejectScoped?: boolean;
  }
): Promise<ResolvedPersistedTaskList | null> {
  const trimmed = args.identifier.trim();
  if (!trimmed) {
    return null;
  }
  if ((args.rejectScoped ?? false) && trimmed.includes("/")) {
    return null;
  }

  let list = await findTaskListByRefForProject(ctx, args.projectId, trimmed);

  if (!list) {
    const normalizedId = normalizeTaskListId(ctx, trimmed);
    if (normalizedId) {
      list = await getTaskListById(ctx, normalizedId);
    }
  }

  if (!list || list.projectId !== args.projectId) {
    return null;
  }
  if ((args.activeOnly ?? false) && list.isArchived) {
    return null;
  }

  return {
    list,
    listKey: createPersistedTaskListKey(list._id),
  };
}

async function resolveProjectTaskList(
  ctx: DbCtx,
  args: {
    projectId: Id<"projects">;
    identifier: string;
    activeOnly?: boolean;
    rejectScoped?: boolean;
  }
): Promise<ResolvedProjectTaskList | null> {
  const trimmed = args.identifier.trim();
  if (isBacklogListRef(trimmed)) {
    return {
      system: BACKLOG_SYSTEM_LIST.key,
      listKey: BACKLOG_SYSTEM_LIST.listKey,
    };
  }

  return await resolvePersistedProjectTaskList(ctx, args);
}

export async function resolveOptionalProjectTaskList(
  ctx: DbCtx,
  args: {
    projectId: Id<"projects">;
    listId?: string;
    listRef?: string;
    activeOnly?: boolean;
  }
): Promise<ResolvedProjectTaskList | null> {
  const identifier = resolveListIdentifierArgs(args);
  if (!identifier) {
    return null;
  }
  const trimmed = identifier.trim();
  ensure(trimmed).notEq("", errors.LIST_IDENTIFIER_REQUIRED);
  ensure(trimmed.includes("/")).isFalse(errors.LIST_IDENTIFIER_NOT_BARE);
  return await resolveProjectTaskList(ctx, {
    projectId: args.projectId,
    identifier,
    activeOnly: args.activeOnly ?? true,
    rejectScoped: true,
  });
}

export function isResolvedSystemTaskList(
  resolved: ResolvedProjectTaskList
): resolved is ResolvedSystemTaskList {
  return "system" in resolved;
}

/**
 * Batch-load the persisted Lists referenced by a set of tasks, keyed by List
 * ID. Tasks in the Backlog (or with no persisted List) simply don't appear in
 * the map. Dedupes List IDs and issues one `db.get` per unique List to avoid
 * N+1 lookups. Pass a single-element array to resolve one task's List.
 */
export async function loadTaskListMapForTasks(
  ctx: DbCtx,
  tasks: Doc<"tasks">[]
): Promise<Map<Id<"taskLists">, Doc<"taskLists">>> {
  const listIds = [
    ...new Set(
      tasks
        .map((task) => parsePersistedTaskListKey(task.listKey))
        .filter((id): id is Id<"taskLists"> => id !== null)
    ),
  ];
  const lists = await getTaskListsByIds(ctx, listIds);
  return new Map(
    lists
      .filter((list): list is Doc<"taskLists"> => list !== null)
      .map((list) => [list._id, list])
  );
}

// --- Default ("Inbox") List ---------------------------------------------

export const INBOX_LIST_NAME = "Inbox";
export const INBOX_LIST_REF = "INBOX";

/**
 * Builds the canonical listKey for a project's default List from the stored
 * `defaultListId`. Every project owns a default List after the OS-842 backfill,
 * so a missing `defaultListId` is a broken invariant, not a supported state —
 * this throws rather than falling back.
 */
export function getDefaultListKey(project: Doc<"projects">): PersistedTaskListKey {
  if (!project.defaultListId) {
    throw new Error(
      `Project ${project._id} has no defaultListId; expected a default List after backfill`
    );
  }
  return createPersistedTaskListKey(project.defaultListId);
}

/** Whether `list` is the project-wide default List. Derived from the pointer. */
export function isDefaultList(project: Doc<"projects">, list: Doc<"taskLists">): boolean {
  return project.defaultListId === list._id;
}
