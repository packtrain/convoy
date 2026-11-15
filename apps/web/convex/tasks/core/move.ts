import { mutation } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { LexoRank } from "lexorank";
import { getAuthenticatedAccess } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { ProjectPermission } from "@/lib/authz/permissions";
import { parsePersistedTaskListKey } from "../../lib/contracts/taskListKeys";
import {
  isResolvedSystemTaskList,
  loadTaskListMapForTasks,
  resolveOptionalProjectTaskList,
} from "../lib/lists/resolution";
import {
  toSystemTaskListSummary,
  toMcpTaskListSummary,
} from "../lib/lists/validators";
import { logTaskActivity } from "../lib/activity/logger";
import { moveToListResultValidator, type TaskUpdateFields } from "../lib/validators";
import { getAppendRankForParent, getTopRootRankForList } from "../lib/ranking";
import { getDescendants, getRootTask, isDescendantOf } from "../lib/tree";
import { getActiveTaskById, getTaskById, patchTask } from "../lib/tasksRepo";
import { ensure } from "../../lib/shared/ensure";
import { assertSectionInList } from "../lib/taskSectionsRepo";
import { errors } from "../errors";

export const toParent = mutation({
  args: {
    id: v.id("tasks"),
    parentId: v.union(v.id("tasks"), v.null()), // null = make top-level
    rank: v.optional(v.string()), // New rank within new parent's children
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const task = await ensure(getActiveTaskById(ctx, args.id)).notNull(
      errors.TASK_NOT_FOUND
    );

    await requireAuthorizedProject(ctx, principal, task.projectId, ProjectPermission.TASK_UPDATE);

    // Prevent setting parent to self
    if (args.parentId === args.id) {
      throw new ConvexError(errors.TASK_CANNOT_BE_OWN_PARENT);
    }

    const currentParentId = task.parentId ?? null;
    if (args.rank === undefined && currentParentId === args.parentId) {
      return null;
    }

    // Get old parent info for logging
    const oldParentId = task.parentId;
    const oldParent = oldParentId ? await getTaskById(ctx, oldParentId) : null;

    // Validate new parent if provided
    let newParent = null;
    if (args.parentId) {
      newParent = await getActiveTaskById(ctx, args.parentId);
      if (!newParent) {
        throw new ConvexError(errors.PARENT_TASK_NOT_FOUND);
      }
      if (newParent.projectId !== task.projectId) {
        throw new ConvexError(errors.PARENT_TASK_DIFFERENT_PROJECT);
      }
      if (newParent.listKey !== task.listKey) {
        throw new ConvexError(errors.SUBTASK_LIST_MUST_MATCH_PARENT);
      }

      // Prevent circular reference - can't set parent to a descendant
      const isCircular = await isDescendantOf(ctx, args.id, args.parentId);
      if (isCircular) {
        throw new ConvexError(errors.TASK_PARENT_CANNOT_BE_DESCENDANT);
      }
    }

    const rank =
      args.rank ??
      (await getAppendRankForParent(ctx, task.projectId, args.parentId, task.isArchived));

    // Only roots carry a section; a promoted subtask keeps its old root's.
    const root = await getRootTask(ctx, task);
    await patchTask(ctx, args.id, {
      parentId: args.parentId ?? undefined,
      rank,
      sectionId: args.parentId ? undefined : root.sectionId,
    });

    // Log activity if parent actually changed
    if (oldParentId !== args.parentId) {
      await logTaskActivity.parentChanged(ctx, {
        taskId: args.id,
        userId: user._id,
        oldParent,
        newParent,
      });
    }

    return null;
  },
});

export const toList = mutation({
  args: {
    rootIds: v.array(v.id("tasks")),
    listId: v.optional(v.string()),
    listRef: v.optional(v.string()),
    // Destination section; omitted = No section (OS-2137).
    sectionId: v.optional(v.id("taskSections")),
    apiKey: v.optional(v.string()),
  },
  returns: moveToListResultValidator,
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    if (args.rootIds.length === 0) {
      throw new ConvexError(errors.AT_LEAST_ONE_TASK_REQUIRED);
    }

    const uniqueRootIds = [...new Set(args.rootIds)];
    const rootTasks = await Promise.all(
      uniqueRootIds.map((id) => getTaskById(ctx, id))
    );
    const validRootTasks = rootTasks.filter(
      (task): task is Doc<"tasks"> => task !== null && !task.isDeleted
    );
    if (validRootTasks.length !== rootTasks.length) {
      throw new ConvexError(errors.TASK_NOT_FOUND);
    }

    const projectId = validRootTasks[0].projectId;
    if (validRootTasks.some((task) => task.projectId !== projectId)) {
      throw new ConvexError(errors.TASKS_SAME_PROJECT);
    }

    const { project } = await requireAuthorizedProject(
      ctx,
      principal,
      projectId,
      ProjectPermission.TASK_UPDATE
    );

    const listFilter = await resolveOptionalProjectTaskList(ctx, {
      ...args,
      projectId,
    });
    if (!listFilter) {
      throw new ConvexError(errors.LIST_NOT_FOUND);
    }
    const movingToSystemList = isResolvedSystemTaskList(listFilter);
    if (args.sectionId) {
      await assertSectionInList(ctx, { projectId, listKey: listFilter.listKey, sectionId: args.sectionId });
    }

    const subtrees = await Promise.all(
      validRootTasks.map(async (root) => [root, ...(await getDescendants(ctx, root._id))])
    );
    const seenMovedTaskIds = new Set<Id<"tasks">>();
    for (const subtree of subtrees) {
      for (const task of subtree) {
        if (seenMovedTaskIds.has(task._id)) {
          throw new ConvexError(errors.MOVE_ROOTS_NO_OVERLAP);
        }
        seenMovedTaskIds.add(task._id);
      }
    }
    const movedTasks = subtrees.flat();
    if (movedTasks.some((task) => task.isArchived)) {
      throw new ConvexError(errors.ARCHIVED_TASKS_NO_LIST);
    }

    const oldListById = await loadTaskListMapForTasks(ctx, movedTasks);
    const targetListKey = listFilter.listKey;
    let nextRootRank = await getTopRootRankForList(ctx, projectId, targetListKey);
    const rootRankById = new Map<Id<"tasks">, string>();
    for (const root of [...validRootTasks].reverse()) {
      const rank = LexoRank.parse(nextRootRank).genPrev().toString();
      rootRankById.set(root._id, rank);
      nextRootRank = rank;
    }

    for (const subtree of subtrees) {
      const root = subtree[0];
      const rootRank = rootRankById.get(root._id);
      if (!rootRank) {
        throw new Error("Missing target List rank");
      }
      const oldParent = root.parentId
        ? await getTaskById(ctx, root.parentId)
        : null;

      for (const task of subtree) {
        const patchData: TaskUpdateFields = {
          listKey: targetListKey,
          sectionId: undefined,
        };

        if (task._id === root._id) {
          patchData.parentId = undefined;
          patchData.rank = rootRank;
          patchData.sectionId = args.sectionId;
        }

        await patchTask(ctx, task._id, patchData);

        if (task.listKey !== targetListKey) {
          const oldListId = parsePersistedTaskListKey(task.listKey);
          await logTaskActivity.listChanged(ctx, {
            taskId: task._id,
            userId: user._id,
            oldList: oldListId ? oldListById.get(oldListId) ?? null : null,
            newList: movingToSystemList ? null : listFilter.list,
            oldListId: oldListId ?? undefined,
            ...(movingToSystemList
              ? { newListSystem: listFilter.system }
              : {}),
          });
        }
      }

      if (root.parentId !== undefined) {
        await logTaskActivity.parentChanged(ctx, {
          taskId: root._id,
          userId: user._id,
          oldParent,
          newParent: null,
        });
      }
    }

    return {
      taskIds: movedTasks.map((task) => task._id),
      list: movingToSystemList
        ? toSystemTaskListSummary(listFilter.system)
        : toMcpTaskListSummary(listFilter.list, project.defaultListId),
    };
  },
});
