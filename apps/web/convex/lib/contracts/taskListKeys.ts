import type { Id } from "../../_generated/dataModel";

const PERSISTED_LIST_KEY_PREFIX = "list:";
const CONVEX_ID_LIKE_REGEX = /^[a-z0-9;]+$/i;
const MIN_CONVEX_ID_LENGTH = 8;
const MAX_CONVEX_ID_LENGTH = 128; // TODO: fix. Duplicated in should.ts

export type PersistedTaskListKey = `list:${Id<"taskLists">}`;

export function createPersistedTaskListKey(listId: Id<"taskLists">): PersistedTaskListKey {
  return `${PERSISTED_LIST_KEY_PREFIX}${listId}`;
}

export function parsePersistedTaskListKey(listKey: string | undefined): Id<"taskLists"> | null {
  if (!listKey?.startsWith(PERSISTED_LIST_KEY_PREFIX)) {
    return null;
  }

  const listId = listKey.slice(PERSISTED_LIST_KEY_PREFIX.length);
  if (listId.length < MIN_CONVEX_ID_LENGTH || listId.length > MAX_CONVEX_ID_LENGTH || !CONVEX_ID_LIKE_REGEX.test(listId)) {
    return null;
  }

  // Convex document IDs are opaque strings; after the shape check this cast is still
  // only valid for keys produced by createPersistedTaskListKey or trusted migrations.
  return listId as Id<"taskLists">;
}
