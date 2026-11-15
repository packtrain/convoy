import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { MAX_ACTIVE_TASK_LISTS, MAX_PINNED_TASK_LISTS } from "@/lib/task-lists/constants";
import { getProjectById } from "../../../projects/lib/projectsRepo";
import { ensure } from "../../../lib/shared/ensure";
import { createPersistedTaskListKey } from "../../../lib/contracts/taskListKeys";
import { hasActiveTasksInList } from "../tasksRepo";
import {
  findTaskListByNormalizedName,
  findTaskListByRefForProject,
  getTaskListById,
  listActiveTaskLists,
  listPinnedTaskLists,
} from "../taskListsRepo";
import { isDefaultList } from "./resolution";
import { errors } from "../../errors";

function isOtherList(existing: Doc<"taskLists"> | null, existingId: Id<"taskLists"> | undefined): boolean {
  return existing !== null && existing._id !== existingId;
}

export async function assertUniqueTaskListName(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  normalizedName: string,
  existingId?: Id<"taskLists">
) {
  const existing = await findTaskListByNormalizedName(ctx, projectId, normalizedName);
  ensure(isOtherList(existing, existingId)).isFalse(errors.LIST_NAME_TAKEN);
}

export async function assertUniqueTaskListRef(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  ref: string,
  existingId?: Id<"taskLists">
) {
  const existing = await findTaskListByRefForProject(ctx, projectId, ref);
  ensure(isOtherList(existing, existingId)).isFalse(errors.LIST_REF_TAKEN);
}

export async function assertActiveTaskListLimit(ctx: MutationCtx, projectId: Id<"projects">) {
  const activeLists = await listActiveTaskLists(ctx, projectId, MAX_ACTIVE_TASK_LISTS);
  ensure(activeLists.length).lt(MAX_ACTIVE_TASK_LISTS, errors.activeListLimitReached(MAX_ACTIVE_TASK_LISTS));
}

export async function assertPinnedTaskListLimit(ctx: MutationCtx, projectId: Id<"projects">) {
  // Persisted and system List pins share one budget. System pins live embedded
  // on the project document; persisted pins live on their `taskLists` rows.
  const [pinnedLists, project] = await Promise.all([
    listPinnedTaskLists(ctx, projectId, MAX_PINNED_TASK_LISTS),
    getProjectById(ctx, projectId),
  ]);
  const systemPinCount = project?.pinnedSystemLists?.length ?? 0;
  ensure(pinnedLists.length + systemPinCount).lt(
    MAX_PINNED_TASK_LISTS,
    errors.pinnedListLimitReached(MAX_PINNED_TASK_LISTS)
  );
}

export async function requireTaskListExists(ctx: MutationCtx, listId: Id<"taskLists">): Promise<Doc<"taskLists">> {
  return ensure(getTaskListById(ctx, listId)).notNull(errors.LIST_NOT_FOUND);
}

/**
 * The project-wide default List cannot be archived or deleted. A different
 * active List must be made default first (OS-843 owns that UI).
 */
export function assertNotDefaultList(project: Doc<"projects">, list: Doc<"taskLists">) {
  ensure(isDefaultList(project, list)).isFalse(errors.DEFAULT_LIST_CANNOT_BE_REMOVED);
}

/**
 * A project must always keep at least one active List. Archiving an
 * already-archived List, or removing one, does not reduce the active set, so
 * only an active List that is the sole remaining active List is blocked.
 */
export async function assertNotLastActiveList(ctx: MutationCtx, list: Doc<"taskLists">) {
  if (list.isArchived) {
    return;
  }
  const activeLists = await listActiveTaskLists(ctx, list.projectId, 2);
  const remaining = activeLists.filter((other) => other._id !== list._id);
  ensure(remaining.length).gte(1, errors.LAST_ACTIVE_LIST_CANNOT_BE_REMOVED);
}

/**
 * Deleting a List only requires it to have no active tasks. Archived tasks
 * keep their stale `listKey` and render as a removed List afterwards.
 */
export async function assertTaskListHasNoActiveTasks(ctx: MutationCtx, listId: Id<"taskLists">) {
  const list = await requireTaskListExists(ctx, listId);
  const listKey = createPersistedTaskListKey(listId);
  const hasTasks = await hasActiveTasksInList(ctx, list.projectId, listKey);
  ensure(hasTasks).isFalse(errors.LIST_HAS_ACTIVE_TASKS);
}
