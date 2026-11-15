import { mutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { statusValidator, priorityValidator } from "../../lib/contracts/validators";
import { getAuthenticatedUser } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { ProjectPermission } from "@/lib/authz/permissions";
import { resolveTaskTypeKey } from "@/lib/tasks/task-types";
import { validateTaskTypeKey } from "../../lib/contracts/taskTypes";
import { logTaskActivity } from "../lib/activity/logger";
import { emitEvents } from "../../lib/events";
import type { AppEvent } from "../../lib/contracts/appEvents";
import {
  applyAutoSetOwner,
  assertAssignableProjectAgent,
  getTaskAssigneeSplit,
  hasAssigneeSplitUpdate,
  hydrateDelegatedAgent,
  hydrateTaskAssigneeSplits,
  hydrateTaskAssigneeUser,
  resolveAssigneeSplit,
  type TaskAssigneeSplitArgs,
  type TaskAssigneeSplitDetails,
} from "../lib/assignees";
import { archiveTasksReturnValidator, deleteTasksResultValidator, type TaskUpdateFields } from "../lib/validators";
import { assertProjectAllowsStatus } from "../lib/invariants";
import { getDescendants } from "../lib/tree";
import { archiveTasksByIds, unarchiveTasksByIds } from "../lib/lifecycle";
import { getTaskById, listChildTasks, patchTask, softDeleteTask } from "../lib/tasksRepo";
import { errors } from "../errors";

type BulkTaskFetchResult =
  | {
      validTasks: Doc<"tasks">[];
      project: Doc<"projects">;
    }
  | "no-op";

/**
 * Load the requested tasks, drop deleted/missing ones, enforce single-project
 * scope, and authorize the project for the given permission. Returns "no-op"
 * when nothing valid remains so callers can short-circuit idempotently.
 */
async function fetchValidTasksForBulkOp(
  ctx: MutationCtx,
  userId: Id<"users">,
  ids: Id<"tasks">[],
  permission: ProjectPermission
): Promise<BulkTaskFetchResult> {
  const tasks = await Promise.all(ids.map((id) => getTaskById(ctx, id)));
  const validTasks = tasks.filter((task): task is Doc<"tasks"> => task !== null && !task.isDeleted);

  if (validTasks.length === 0) {
    return "no-op";
  }

  const projectId = validTasks[0].projectId;
  if (validTasks.some((task) => task.projectId !== projectId)) {
    throw new ConvexError("Tasks must be in the same project");
  }

  const { project } = await requireAuthorizedProject(ctx, userId, projectId, permission);

  return { validTasks, project };
}

export const update = mutation({
  args: {
    ids: v.array(v.id("tasks")),
    status: v.optional(statusValidator),
    taskTypeKey: v.optional(v.union(v.string(), v.null())),
    assigneeId: v.optional(v.union(v.id("users"), v.null())),
    delegatedToAgentId: v.optional(v.union(v.id("projectAgents"), v.null())),
    dueDate: v.optional(v.union(v.number(), v.null())),
    priority: v.optional(priorityValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const hasStatusUpdate = args.status !== undefined;
    const hasTaskTypeUpdate = args.taskTypeKey !== undefined;
    const splitArgs: TaskAssigneeSplitArgs = {
      assigneeId: args.assigneeId,
      delegatedToAgentId: args.delegatedToAgentId,
    };
    const hasAssigneeUpdate = hasAssigneeSplitUpdate(splitArgs);
    const hasDueDateUpdate = args.dueDate !== undefined;
    const hasPriorityUpdate = args.priority !== undefined;
    const bulkStatus = args.status;
    const bulkPriority = args.priority;

    if (!hasStatusUpdate && !hasTaskTypeUpdate && !hasAssigneeUpdate && !hasDueDateUpdate && !hasPriorityUpdate) {
      throw new ConvexError(errors.BULK_UPDATE_NO_FIELDS);
    }

    const bulkFetch = await fetchValidTasksForBulkOp(ctx, user._id, args.ids, ProjectPermission.TASK_UPDATE);
    if (bulkFetch === "no-op") return null;
    const { validTasks, project } = bulkFetch;

    const resolvedTaskTypeKey = hasTaskTypeUpdate ? resolveTaskTypeKey(args.taskTypeKey) : undefined;
    if (resolvedTaskTypeKey !== undefined) {
      validateTaskTypeKey(resolvedTaskTypeKey);
    }

    if (bulkStatus !== undefined) {
      if (validTasks.some((task) => task.status !== bulkStatus)) {
        assertProjectAllowsStatus(project, bulkStatus);
      }
    }

    if (hasAssigneeUpdate) {
      await assertAssignableProjectAgent(ctx, project._id, splitArgs.delegatedToAgentId);
    }
    // At most two candidate new owners (explicit arg / acting user via
    // auto-set-owner) and one new agent — hydrate them once up front.
    const [hydratedArgOwner, hydratedActingOwner, hydratedNewAgent, hydratedOldSplits] = hasAssigneeUpdate
      ? await Promise.all([
          hydrateTaskAssigneeUser(ctx, splitArgs.assigneeId ?? undefined),
          hydrateTaskAssigneeUser(ctx, user._id),
          hydrateDelegatedAgent(ctx, splitArgs.delegatedToAgentId ?? undefined),
          hydrateTaskAssigneeSplits(ctx, validTasks),
        ])
      : [null, null, null, new Map<Id<"tasks">, TaskAssigneeSplitDetails>()];

    const events: AppEvent[] = [];
    for (const task of validTasks) {
      const patchData: TaskUpdateFields = {};
      const shouldLogStatus = bulkStatus !== undefined && task.status !== bulkStatus;
      const currentSplit = getTaskAssigneeSplit(task);
      const resolvedSplit = hasAssigneeUpdate
        ? resolveAssigneeSplit(
            currentSplit,
            applyAutoSetOwner({ splitArgs, currentAssigneeId: currentSplit.assigneeId, actingUserId: user._id })
          )
        : currentSplit;
      const shouldLogAssignee = hasAssigneeUpdate && currentSplit.assigneeId !== resolvedSplit.assigneeId;
      const shouldLogDelegation = hasAssigneeUpdate && currentSplit.delegatedToAgentId !== resolvedSplit.delegatedToAgentId;
      const shouldLogPriority = bulkPriority !== undefined && task.priority !== bulkPriority;
      const oldDueDate = task.dueDate;
      const shouldLogDueDate = hasDueDateUpdate && (oldDueDate ?? null) !== (args.dueDate ?? null);

      if (shouldLogStatus) {
        patchData.status = bulkStatus;
      }
      const oldTaskTypeKey = resolveTaskTypeKey(task.taskTypeKey);
      const shouldLogTaskType = resolvedTaskTypeKey !== undefined && oldTaskTypeKey !== resolvedTaskTypeKey;
      if (shouldLogTaskType) {
        patchData.taskTypeKey = resolvedTaskTypeKey;
      }
      if (hasAssigneeUpdate) {
        Object.assign(patchData, resolvedSplit);
      }
      if (shouldLogDueDate) {
        patchData.dueDate = args.dueDate ?? undefined;
      }
      if (shouldLogPriority) {
        patchData.priority = bulkPriority;
      }

      if (Object.keys(patchData).length === 0) {
        continue;
      }

      await patchTask(ctx, task._id, patchData);

      if (shouldLogStatus) {
        await logTaskActivity.statusChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldValue: task.status,
          newValue: bulkStatus,
        });
        events.push({
          type: "task.status_changed",
          actorUserId: user._id,
          projectId: task.projectId,
          subject: { kind: "task", id: task._id },
          payload: { oldStatus: task.status, newStatus: bulkStatus },
        });
      }
      if (shouldLogTaskType) {
        await logTaskActivity.typeChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldKey: oldTaskTypeKey,
          newKey: resolvedTaskTypeKey,
        });
      }
      if (shouldLogAssignee) {
        const newOwnerDetails = resolvedSplit.assigneeId
          ? resolvedSplit.assigneeId === user._id
            ? hydratedActingOwner
            : hydratedArgOwner
          : null;
        await logTaskActivity.assigneeChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldAssignee: hydratedOldSplits.get(task._id)?.assignee ?? null,
          newAssignee: newOwnerDetails,
        });
        events.push({
          type: "task.assignee_changed",
          actorUserId: user._id,
          projectId: task.projectId,
          subject: { kind: "task", id: task._id },
          payload: { oldAssigneeId: currentSplit.assigneeId, newAssigneeId: resolvedSplit.assigneeId },
        });
      }
      if (shouldLogDelegation) {
        await logTaskActivity.delegationChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldAgent: hydratedOldSplits.get(task._id)?.delegatedToAgent ?? null,
          newAgent: resolvedSplit.delegatedToAgentId ? hydratedNewAgent : null,
        });
      }
      if (shouldLogDueDate) {
        await logTaskActivity.dueDateChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldValue: oldDueDate,
          newValue: args.dueDate ?? undefined,
        });
      }
      if (shouldLogPriority) {
        await logTaskActivity.priorityChanged(ctx, {
          taskId: task._id,
          userId: user._id,
          oldValue: task.priority,
          newValue: bulkPriority,
        });
      }
    }
    await emitEvents(ctx, events);

    return null;
  },
});

export const remove = mutation({
  args: {
    ids: v.array(v.id("tasks")),
    cascadeMode: v.optional(v.union(v.literal("delete_all"), v.literal("keep_children"))),
  },
  returns: deleteTasksResultValidator,
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const cascadeMode = args.cascadeMode ?? "delete_all";

    const bulkFetch = await fetchValidTasksForBulkOp(ctx, user._id, args.ids, ProjectPermission.TASK_DELETE);
    if (bulkFetch === "no-op") return { deletedIds: [] };
    const { validTasks } = bulkFetch;

    // 4. Delete all valid tasks
    // Track already-deleted IDs to avoid double-processing descendants
    const deletedIds = new Set<Id<"tasks">>();
    const events: AppEvent[] = [];

    for (const task of validTasks) {
      // Skip if already deleted in this batch (e.g., was a descendant of earlier item)
      if (deletedIds.has(task._id)) continue;

      // Get direct children
      const children = await listChildTasks(ctx, task._id);

      const hasChildren = children.length > 0;

      if (hasChildren && cascadeMode === "keep_children") {
        // Move children to the grandparent (or top-level if no grandparent)
        const newParentId = task.parentId;
        for (const child of children) {
          await patchTask(ctx, child._id, {
            parentId: newParentId,
            sectionId: task.sectionId,
          });
        }
      } else if (hasChildren && cascadeMode === "delete_all") {
        // Recursively soft-delete all descendants (note: getDescendants still uses recursive queries)
        const descendants = await getDescendants(ctx, task._id);

        for (const descendant of descendants) {
          if (deletedIds.has(descendant._id)) continue;
          await softDeleteTask(ctx, descendant._id, user._id);

          deletedIds.add(descendant._id);
        }
      }

      // Schedule permanent deletion of the task itself
      await softDeleteTask(ctx, task._id, user._id);

      // Log activity for the main task
      await logTaskActivity.deleted(ctx, {
        taskId: task._id,
        userId: user._id,
      });
      events.push({
        type: "task.deleted",
        actorUserId: user._id,
        projectId: task.projectId,
        subject: { kind: "task", id: task._id },
        payload: {},
      });

      deletedIds.add(task._id);
    }
    await emitEvents(ctx, events);

    return { deletedIds: Array.from(deletedIds) };
  },
});

export const archive = mutation({
  args: { ids: v.array(v.id("tasks")) },
  returns: archiveTasksReturnValidator,
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    return await archiveTasksByIds(ctx, user._id, args.ids);
  },
});

export const unarchive = mutation({
  args: { ids: v.array(v.id("tasks")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await unarchiveTasksByIds(ctx, user._id, args.ids);

    return null;
  },
});
