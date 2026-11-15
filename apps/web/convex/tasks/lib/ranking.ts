import { LexoRank } from "lexorank";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { ensure } from "../../lib/shared/ensure";
import {
  getLastChildTaskByRank,
  getRootTaskAtRankBoundary,
  getLastActiveTaskInListByRank,
  getFirstActiveRootTaskInList,
} from "./tasksRepo";

/** Guard for client-supplied LexoRank strings; throws `errorMessage` when unparsable. */
export function validateRank(rank: string, errorMessage: string): string {
  let parses = true;
  try {
    LexoRank.parse(rank);
  } catch {
    parses = false;
  }
  ensure(parses).isTrue(errorMessage);
  return rank;
}

/** Rank appending after `previousRank`; `LexoRank.middle()` when the group is empty. */
export function appendRank(previousRank: string | undefined): string {
  return previousRank ? LexoRank.parse(previousRank).genNext().toString() : LexoRank.middle().toString();
}

/**
 * LexoRank appending a task to the END of its sibling group: after the parent's last
 * child, or for a root task after the project's last root with the same `isArchived`
 * (so active and archived roots rank independently). `LexoRank.middle()` when empty.
 *
 * Scoped by parent/project, NOT by List — see {@link getAppendRankForList}.
 */
export async function getAppendRankForParent(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  parentId: Id<"tasks"> | null,
  isArchived: boolean
): Promise<string> {
  if (parentId) {
    const lastChild = await getLastChildTaskByRank(ctx, parentId);
    return appendRank(lastChild?.rank);
  }

  const lastRoot = await getRootTaskAtRankBoundary(ctx, projectId, {
    isArchived,
    order: "desc",
  });

  return appendRank(lastRoot?.rank);
}

/**
 * LexoRank appending a task to the END of a List, over every active task in it
 * regardless of nesting. `LexoRank.middle()` when the List is empty.
 *
 * Scoped by `listKey`, NOT by parent — see {@link getAppendRankForParent}.
 */
export async function getAppendRankForList(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  listKey: string
): Promise<string> {
  const lastTask = await getLastActiveTaskInListByRank(ctx, projectId, listKey);
  return appendRank(lastTask?.rank);
}

/**
 * Rank of the topmost ROOT task in a List — the upper boundary for prepending.
 * Walks ascending and returns the first root, ignoring subtasks;
 * `LexoRank.middle()` when there are none. Callers typically `genPrev()` from it.
 */
export async function getTopRootRankForList(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  listKey: string
): Promise<string> {
  const topRoot = await getFirstActiveRootTaskInList(ctx, projectId, listKey);
  return topRoot ? topRoot.rank : LexoRank.middle().toString();
}
