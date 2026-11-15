import type { MutationCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { listChildTasks, getTaskById } from "./tasksRepo";

export async function getDescendants(
  ctx: MutationCtx,
  taskId: Id<"tasks">
): Promise<Doc<"tasks">[]> {
  const descendants: Doc<"tasks">[] = [];

  const children = await listChildTasks(ctx, taskId);

  for (const child of children) {
    descendants.push(child);
    const childDescendants = await getDescendants(ctx, child._id);
    descendants.push(...childDescendants);
  }

  return descendants;
}

/**
 * Check whether `targetId` is a descendant of `taskId`. Walks UP from target
 * instead of recursively searching DOWN — reduces O(subtree size) queries to
 * O(tree depth) queries (typically 3–5).
 */
export async function isDescendantOf(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  targetId: Id<"tasks">
): Promise<boolean> {
  let currentId: Id<"tasks"> | undefined = targetId;

  while (currentId) {
    const task: Doc<"tasks"> | null = await getTaskById(ctx, currentId);
    if (!task || task.isDeleted) return false;

    if (task.parentId === taskId) return true;
    currentId = task.parentId;
  }

  return false;
}

/** Top of `task`'s tree; a promoted subtask takes this root's section. */
export async function getRootTask(ctx: MutationCtx, task: Doc<"tasks">): Promise<Doc<"tasks">> {
  let root = task;
  while (root.parentId) {
    const parent = await getTaskById(ctx, root.parentId);
    if (!parent) break;
    root = parent;
  }
  return root;
}
