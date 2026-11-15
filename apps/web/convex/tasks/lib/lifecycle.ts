import { LexoRank } from "lexorank";
import type { MutationCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { ProjectPermission } from "@/lib/authz/permissions";
import { ConvexError } from "convex/values";
import { logTaskActivity } from "./activity/logger";
import { emitEvents } from "../../lib/events";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { getDescendants, getRootTask } from "./tree";
import {
  getTaskById,
  getRootTaskAtRankBoundary,
  patchTask,
} from "./tasksRepo";
import { getTaskListById } from "./taskListsRepo";
import { deleteSection, listTasksBySection } from "./taskSectionsRepo";
import { getDefaultListKey } from "./lists/resolution";
import { parsePersistedTaskListKey } from "../../lib/contracts/taskListKeys";
import { findSystemTaskListByListKey } from "@/lib/task-lists/system-lists";

// TODO: should be migrated to lists
export async function archiveTasksByIds(
  ctx: MutationCtx,
  userId: Id<"users">,
  ids: Id<"tasks">[]
): Promise<{ archivedRootIds: Id<"tasks">[] }> {
  const tasks = await Promise.all(ids.map((id) => getTaskById(ctx, id)));
  const validTaskMap = new Map<string, Doc<"tasks">>();
  for (const task of tasks) {
    if (task !== null && !task.isDeleted && !task.isArchived) {
      validTaskMap.set(task._id, task);
    }
  }
  const validTasks = Array.from(validTaskMap.values());
  if (validTasks.length === 0) {
    return { archivedRootIds: [] };
  }

  const projectId = validTasks[0].projectId;
  if (validTasks.some((task) => task.projectId !== projectId)) {
    throw new ConvexError("Tasks must be in the same project");
  }
  await requireAuthorizedProject(
    ctx,
    userId,
    projectId,
    ProjectPermission.TASK_UPDATE
  );

  const validRootTasks = validTasks.filter(
    (task) => task.parentId === undefined
  );
  const validSubtasks = validTasks.filter((task) => task.parentId !== undefined);
  const now = Date.now();
  const archivedIds = new Set<string>();
  const archivedRootIds: Id<"tasks">[] = [];

  for (const task of validRootTasks) {
    await archiveTaskSubtree(ctx, userId, task, {
      archivedAt: now,
      detachParent: false,
      archivedIds,
      archivedRootIds,
    });
  }

  for (const task of validSubtasks) {
    if (archivedIds.has(task._id)) continue;
    // A subtask whose ancestor is also being archived in this batch stays
    // attached and gets archived through that ancestor's cascade instead.
    // With a single-task batch no other ancestor can be in the set, so skip
    // the chain walk and its per-ancestor reads.
    if (validTaskMap.size > 1 && (await hasAncestorInSet(ctx, task, validTaskMap)))
      continue;

    await archiveTaskSubtree(ctx, userId, task, {
      archivedAt: now,
      detachParent: true,
      archivedIds,
      archivedRootIds,
    });
  }

  // One bus event per archived subtree root — same granularity as the activity log.
  await emitEvents(
    ctx,
    archivedRootIds.map((taskId) => ({
      type: "task.archived" as const,
      actorUserId: userId,
      projectId,
      subject: { kind: "task" as const, id: taskId },
      payload: {},
    }))
  );

  return { archivedRootIds };
}

async function archiveTaskSubtree(
  ctx: MutationCtx,
  userId: Id<"users">,
  task: Doc<"tasks">,
  options: {
    archivedAt: number;
    detachParent: boolean;
    archivedIds: Set<string>;
    archivedRootIds: Id<"tasks">[];
  }
): Promise<void> {
  const { archivedAt, detachParent, archivedIds, archivedRootIds } = options;
  if (archivedIds.has(task._id)) return;

  await patchTask(ctx, task._id, {
    ...(detachParent ? { parentId: undefined, sectionId: (await getRootTask(ctx, task)).sectionId } : {}),
    isArchived: true,
    archivedAt,
    archivedBy: userId,
  });
  archivedIds.add(task._id);
  archivedRootIds.push(task._id);

  const descendants = await getDescendants(ctx, task._id);
  for (const descendant of descendants) {
    if (archivedIds.has(descendant._id)) continue;
    await patchTask(ctx, descendant._id, {
      isArchived: true,
      archivedAt,
      archivedBy: userId,
    });
    archivedIds.add(descendant._id);
  }

  await logTaskActivity.archived(ctx, {
    taskId: task._id,
    userId,
  });
}

async function hasAncestorInSet(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  candidates: Map<string, Doc<"tasks">>
): Promise<boolean> {
  let parentId = task.parentId;
  while (parentId !== undefined) {
    if (candidates.has(parentId)) return true;
    const parent = await getTaskById(ctx, parentId);
    parentId = parent?.parentId;
  }
  return false;
}

// TODO: should be migrated to lists
export async function unarchiveTasksByIds(
  ctx: MutationCtx,
  userId: Id<"users">,
  ids: Id<"tasks">[]
): Promise<void> {
  const tasks = await Promise.all(ids.map((id) => getTaskById(ctx, id)));
  const validRootTaskMap = new Map<string, Doc<"tasks">>();
  for (const task of tasks) {
    if (
      task !== null &&
      !task.isDeleted &&
      task.isArchived &&
      task.parentId === undefined
    ) {
      validRootTaskMap.set(task._id, task);
    }
  }
  const validRootTasks = Array.from(validRootTaskMap.values());
  if (validRootTasks.length === 0) {
    return;
  }

  const projectId = validRootTasks[0].projectId;
  if (validRootTasks.some((task) => task.projectId !== projectId)) {
    throw new ConvexError("Tasks must be in the same project");
  }
  const { project } = await requireAuthorizedProject(
    ctx,
    userId,
    projectId,
    ProjectPermission.TASK_UPDATE
  );

  // Archived tasks may reference a List that was deleted while they were
  // archived. Unarchiving self-corrects those to the project default List so
  // no active task carries a dangling listKey.
  const resolveUnarchiveListKey = async (
    listKey: string | undefined
  ): Promise<string | undefined> => {
    if (!listKey || findSystemTaskListByListKey(listKey)) {
      return undefined;
    }
    const listId = parsePersistedTaskListKey(listKey);
    if (!listId) {
      return undefined;
    }
    const list = await getTaskListById(ctx, listId);
    return list ? undefined : getDefaultListKey(project);
  };

  const unarchivedIds = new Set<string>();
  const sortedProjectTasks = [...validRootTasks].sort(
    (a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)
  );

  const firstActiveRoot = await getRootTaskAtRankBoundary(ctx, projectId, {
    isArchived: false,
    order: "asc",
  });

  // Precompute new ranks so restored order is preserved at top.
  // This is computed before any patches, so newly unarchived roots won't
  // shift the insertion boundary during this batch.
  const rankByTaskId = new Map<string, string>();
  let rankBoundary = firstActiveRoot?.rank;
  for (let i = sortedProjectTasks.length - 1; i >= 0; i--) {
    const task = sortedProjectTasks[i];
    const newRank = rankBoundary
      ? LexoRank.parse(rankBoundary).genPrev().toString()
      : LexoRank.middle().toString();
    rankByTaskId.set(task._id, newRank);
    rankBoundary = newRank;
  }

  for (const task of sortedProjectTasks) {
    if (unarchivedIds.has(task._id)) continue;

    const fallbackListKey = await resolveUnarchiveListKey(task.listKey);
    await patchTask(ctx, task._id, {
      isArchived: false,
      archivedAt: undefined,
      archivedBy: undefined,
      rank: rankByTaskId.get(task._id) ?? task.rank,
      ...(fallbackListKey ? { listKey: fallbackListKey, sectionId: undefined } : {}),
    });
    unarchivedIds.add(task._id);

    const descendants = await getDescendants(ctx, task._id);
    for (const descendant of descendants) {
      if (unarchivedIds.has(descendant._id)) continue;
      await patchTask(ctx, descendant._id, {
        isArchived: false,
        archivedAt: undefined,
        archivedBy: undefined,
        ...(fallbackListKey ? { listKey: fallbackListKey } : {}),
      });
      unarchivedIds.add(descendant._id);
    }

    await logTaskActivity.unarchived(ctx, {
      taskId: task._id,
      userId,
    });
  }
}

/** Deletes a section; its tasks move to No section in the same mutation. */
export async function removeSection(ctx: MutationCtx, sectionId: Id<"taskSections">): Promise<void> {
  // ponytail: single-mutation clear, like labels; batch via scheduler past ~5k tasks per section.
  for (const task of await listTasksBySection(ctx, sectionId)) {
    await patchTask(ctx, task._id, { sectionId: undefined });
  }
  await deleteSection(ctx, sectionId);
}
