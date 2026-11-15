import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  BACKLOG_SYSTEM_LIST,
  findSystemTaskListByListKey,
  systemTaskListKeyValidator,
  type SystemTaskListKey,
} from "@/lib/task-lists/system-lists";
import { parsePersistedTaskListKey } from "../../../lib/contracts/taskListKeys";
import {
  boardGroupByValidator,
  listGroupByValidator,
  boardRowGroupByValidator,
  projectViewModeValidator,
} from "../../../lib/contracts/validators";

export const taskListPublicValidator = v.object({
  type: v.literal("list"),
  _id: v.id("taskLists"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  name: v.string(),
  ref: v.string(),
  rank: v.optional(v.string()),
  color: v.optional(v.string()),
  isArchived: v.boolean(),
  isDefault: v.boolean(),
  isPinned: v.boolean(),
  archivedAt: v.optional(v.number()),
  archivedBy: v.optional(v.id("users")),
  // Absent = inherit the project default view (OS-1566).
  defaultViewMode: v.optional(projectViewModeValidator),
  defaultBoardGroupBy: v.optional(boardGroupByValidator),
  defaultListGroupBy: v.optional(listGroupByValidator),
  defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
  createdBy: v.id("users"),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
});

// Sidebar pinned-List entry. Persisted Lists carry their full public shape
// (whose `type: "list"` discriminates the union); system Lists (Backlog) have
// no `taskLists` row, so they surface as a thin variant identified by their
// stable key. Discriminated by `type`.
export const pinnedSidebarListValidator = v.union(
  v.object({
    ...taskListPublicValidator.fields,
  }),
  v.object({
    type: v.literal("system"),
    key: systemTaskListKeyValidator,
    ref: v.literal(BACKLOG_SYSTEM_LIST.ref),
    name: v.literal(BACKLOG_SYSTEM_LIST.name),
  })
);

export const mcpTaskListSummaryValidator = v.object({
  id: v.union(v.id("taskLists"), v.literal(BACKLOG_SYSTEM_LIST.ref)),
  ref: v.string(),
  name: v.string(),
  isDefault: v.boolean(),
  type: v.union(v.literal("list"), v.literal("system")),
});

// Rendered for tasks whose persisted List row was deleted. Archived tasks keep
// their stale `listKey` when their List is deleted, so this is their display
// fallback rather than a data error.
export const REMOVED_TASK_LIST_NAME = "Deleted list";

export const structuredTaskListValidator = v.union(
  v.object({
    type: v.literal("list"),
    id: v.id("taskLists"),
    ref: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    isArchived: v.boolean(),
  }),
  v.object({
    type: v.literal("system"),
    key: v.literal(BACKLOG_SYSTEM_LIST.key),
    ref: v.literal(BACKLOG_SYSTEM_LIST.ref),
    name: v.literal(BACKLOG_SYSTEM_LIST.name),
  }),
  v.object({
    type: v.literal("removed"),
    name: v.literal(REMOVED_TASK_LIST_NAME),
  })
);

// The default List is derived from the project pointer, not a flag on the List
// row, so callers pass the project's `defaultListId` to compute `isDefault`.
function computeIsDefault(
  list: Doc<"taskLists">,
  defaultListId: Id<"taskLists"> | undefined
): boolean {
  return defaultListId !== undefined && list._id === defaultListId;
}

export function toTaskListPublic(
  list: Doc<"taskLists">,
  defaultListId?: Id<"taskLists">
) {
  return {
    type: "list" as const,
    _id: list._id,
    _creationTime: list._creationTime,
    projectId: list.projectId,
    name: list.name,
    ref: list.ref,
    ...(list.rank === undefined ? {} : { rank: list.rank }),
    ...(list.color === undefined ? {} : { color: list.color }),
    isArchived: list.isArchived,
    isDefault: computeIsDefault(list, defaultListId),
    isPinned: list.isPinned ?? false,
    ...(list.archivedAt === undefined ? {} : { archivedAt: list.archivedAt }),
    ...(list.archivedBy === undefined ? {} : { archivedBy: list.archivedBy }),
    ...(list.defaultViewMode === undefined
      ? {}
      : { defaultViewMode: list.defaultViewMode }),
    ...(list.defaultListGroupBy === undefined ? {} : { defaultListGroupBy: list.defaultListGroupBy }),
    ...(list.defaultBoardRowGroupBy === undefined ? {} : { defaultBoardRowGroupBy: list.defaultBoardRowGroupBy }),
    ...(list.defaultBoardGroupBy === undefined
      ? {}
      : { defaultBoardGroupBy: list.defaultBoardGroupBy }),
    createdBy: list.createdBy,
    updatedBy: list.updatedBy,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

// Tags a persisted public List as the sidebar union's "list" variant.
export function toPersistedPinnedSidebarList(
  list: Doc<"taskLists">,
  defaultListId?: Id<"taskLists">
) {
  return toTaskListPublic(list, defaultListId);
}

// Maps a system List's key to its sidebar union "system" variant. Exhaustive so
// adding a new system List is a compile error here rather than a silent bug.
export function toSystemPinnedSidebarList(key: SystemTaskListKey) {
  switch (key) {
    case BACKLOG_SYSTEM_LIST.key:
      return {
        type: "system" as const,
        key: BACKLOG_SYSTEM_LIST.key,
        ref: BACKLOG_SYSTEM_LIST.ref,
        name: BACKLOG_SYSTEM_LIST.name,
      };
    default: {
      const unhandled: never = key;
      throw new Error(`Unhandled system List: ${String(unhandled)}`);
    }
  }
}

export function toMcpTaskListSummary(
  list: Doc<"taskLists">,
  defaultListId?: Id<"taskLists">
) {
  return {
    id: list._id,
    ref: list.ref,
    name: list.name,
    isDefault: computeIsDefault(list, defaultListId),
    type: "list" as const,
  };
}

function toBacklogTaskListSummary() {
  return {
    id: BACKLOG_SYSTEM_LIST.ref,
    ref: BACKLOG_SYSTEM_LIST.ref,
    name: BACKLOG_SYSTEM_LIST.name,
    isDefault: false,
    type: "system" as const,
  };
}

// Maps a system List's key to its MCP summary. The exhaustive switch makes
// adding a new system List a compile error here rather than a silent "treat
// everything as Backlog" bug.
export function toSystemTaskListSummary(system: SystemTaskListKey) {
  switch (system) {
    case BACKLOG_SYSTEM_LIST.key:
      return toBacklogTaskListSummary();
    default: {
      const unhandled: never = system;
      throw new Error(`Unhandled system List: ${String(unhandled)}`);
    }
  }
}

// Maps a system List's key to its structured shape. Exhaustive for the same
// reason as toSystemTaskListSummary.
function toSystemStructuredTaskList(system: SystemTaskListKey) {
  switch (system) {
    case BACKLOG_SYSTEM_LIST.key:
      return toBacklogStructuredTaskList();
    default: {
      const unhandled: never = system;
      throw new Error(`Unhandled system List: ${String(unhandled)}`);
    }
  }
}

function toBacklogStructuredTaskList() {
  return {
    type: "system" as const,
    key: BACKLOG_SYSTEM_LIST.key,
    ref: BACKLOG_SYSTEM_LIST.ref,
    name: BACKLOG_SYSTEM_LIST.name,
  };
}

function toListStructuredTaskList(list: Doc<"taskLists">) {
  return {
    type: "list" as const,
    id: list._id,
    ref: list.ref,
    name: list.name,
    color: list.color,
    isArchived: list.isArchived,
  };
}

function toRemovedStructuredTaskList() {
  return {
    type: "removed",
    name: REMOVED_TASK_LIST_NAME,
  } as const;
}

// Maps a task's stored `listKey` to its structured List shape, resolving
// persisted Lists through a pre-materialized map to avoid per-task DB lookups.
export function toStructuredTaskList(
  task: Doc<"tasks">,
  listMap: Map<Id<"taskLists">, Doc<"taskLists">>
) {
  const systemList = findSystemTaskListByListKey(task.listKey);
  if (systemList) {
    return toSystemStructuredTaskList(systemList.key);
  }

  const listId = parsePersistedTaskListKey(task.listKey);
  if (!listId) {
    return null;
  }

  const list = listMap.get(listId);
  if (!list) {
    // The List row was deleted while this (archived) task kept its listKey.
    return toRemovedStructuredTaskList();
  }

  return toListStructuredTaskList(list);
}

export type TaskListPublic = Infer<typeof taskListPublicValidator>;
