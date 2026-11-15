import { v } from "convex/values";

export const BACKLOG_SYSTEM_LIST = {
  ref: "BACKLOG",
  key: "backlog",
  listKey: "system:backlog",
  name: "Backlog",
} as const;

/**
 * Validator for a system List's stable `key`. Today Backlog is the only pinnable
 * system List; widen this to a `v.union(...)` when the catalog grows.
 */
export const systemTaskListKeyValidator = v.literal(BACKLOG_SYSTEM_LIST.key);

/**
 * Pin state for a system List. System Lists have no `taskLists` row, so their
 * pins live embedded on the owning project document (see `projects` schema).
 */
export const pinnedSystemTaskListValidator = v.object({
  key: systemTaskListKeyValidator,
  pinnedAt: v.number(),
  pinnedBy: v.id("users"),
});

export const BACKLOG_LIST_REF = BACKLOG_SYSTEM_LIST.ref;
export const BACKLOG_SYSTEM_LIST_KEY = BACKLOG_SYSTEM_LIST.listKey;

export type BacklogListRef = typeof BACKLOG_LIST_REF;

/**
 * The catalog of system (virtual) Lists. Backlog is the only one today; add new
 * entries here and the `SystemTaskListKey` union widens automatically, which
 * makes the exhaustive `switch`es over system Lists fail to compile until each
 * new List is handled.
 */
export const SYSTEM_TASK_LISTS = [BACKLOG_SYSTEM_LIST] as const;
export type SystemTaskList = (typeof SYSTEM_TASK_LISTS)[number];
export type SystemTaskListKey = SystemTaskList["key"];

/** Resolve a stored `listKey` to its system List, or null if it isn't one. */
export function findSystemTaskListByListKey(
  listKey: string | undefined
): SystemTaskList | null {
  return SYSTEM_TASK_LISTS.find((list) => list.listKey === listKey) ?? null;
}

export function isBacklogListRef(
  ref: string | null | undefined
): ref is BacklogListRef {
  return ref?.trim().toUpperCase() === BACKLOG_LIST_REF;
}

export function isSystemListRef(
  ref: string | null | undefined
): ref is BacklogListRef {
  return isBacklogListRef(ref);
}
