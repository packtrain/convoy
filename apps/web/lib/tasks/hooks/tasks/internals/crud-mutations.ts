import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { retypeTaskChecks } from "@/convex/checks/lib/resolution";
import type { Id } from "@/convex/_generated/dataModel";
import { calculateRankBetween } from "@/lib/tasks/rank";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import { resolveTaskTypeKey, resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { applyOptimisticAutoSetOwner, resolveOptimisticAssigneeSplit } from "@/lib/tasks/optimistic-assignees";
import type { OptimisticAssigneeDetailsStore } from "./optimistic-assignee-details";
import type { TaskListQueryArgs } from "./query-state";

export function useTaskCrudMutationHandles({
  listByProjectArgs,
  assigneeDetails,
}: {
  listByProjectArgs: TaskListQueryArgs | null;
  assigneeDetails: OptimisticAssigneeDetailsStore;
}) {
  // Needed for the optimistic auto-set-owner mirror: delegating an ownerless
  // task shows the acting user as owner immediately (server rule is canonical).
  const currentUser = useQuery(api.users.core.current);
  const createMutation = useMutation(api.tasks.core.create).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
    const now = globalThis.Date.now();
    const tempId = globalThis.crypto.randomUUID() as Id<"tasks">;
    const optimisticSplit = resolveOptimisticAssigneeSplit({
      pendingDetails: assigneeDetails.consume(args.clientId),
      assigneeId: args.assigneeId,
      delegatedToAgentId: args.delegatedToAgentId,
    });
    applyOptimisticAutoSetOwner({
      split: optimisticSplit,
      assigneeId: args.assigneeId,
      delegatedToAgentId: args.delegatedToAgentId,
      currentAssignee: null,
      currentUser,
    });
    const optimisticTask = {
      _id: tempId,
      _creationTime: now,
      projectId: args.projectId,
      parentId: args.parentId ?? null,
      clientId: args.clientId,
      refNumber: 0,
      refId: "...",
      name: args.name,
      description: null,
      taskType: resolveTaskTypeSummary(resolveTaskTypeKey(args.taskTypeKey)),
      priority: args.priority,
      dueDate: args.dueDate ?? null,
      status: args.status,
      list: null,
      assignee: optimisticSplit.assignee ?? null,
      delegatedToAgent: optimisticSplit.delegatedToAgent ?? null,
      tags: args.tags,
      labelId: args.labelId ?? null,
      sectionId: args.sectionId ?? null,
      externalLinks: [],
      attachmentCount: 0,
      artifactCount: 0,
      rank: args.rank ?? calculateRankBetween(undefined, undefined),
      createdBy: "" as Id<"users">,
      createdByName: null,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      isArchived: false,
    };

    const updatedTasks = [...currentTasks, optimisticTask];
    updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const duplicateMutation = useMutation(api.tasks.core.duplicate).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const originalTask = currentTasks.find((t) => t._id === args.id);
    if (!originalTask) return;

    // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
    const now = globalThis.Date.now();
    const tempId = globalThis.crypto.randomUUID() as Id<"tasks">;

    const optimisticTask = {
      _id: tempId,
      _creationTime: now,
      projectId: originalTask.projectId,
      parentId: originalTask.parentId,
      clientId: args.newClientId,
      refNumber: 0,
      refId: "...",
      name: originalTask.name,
      description: originalTask.description,
      taskType: originalTask.taskType,
      priority: originalTask.priority,
      dueDate: originalTask.dueDate,
      status: originalTask.status,
      list: originalTask.list,
      assignee: originalTask.assignee ?? null,
      delegatedToAgent: originalTask.delegatedToAgent ?? null,
      tags: [...originalTask.tags],
      labelId: originalTask.labelId,
      sectionId: originalTask.parentId ? null : originalTask.sectionId,
      externalLinks: [],
      // Attachments/artifacts are not copied by duplicate, so the copy starts at 0.
      attachmentCount: 0,
      artifactCount: 0,
      rank: args.newRank,
      createdBy: "" as Id<"users">,
      createdByName: null,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      isArchived: false,
    };

    const updatedTasks = [...currentTasks, optimisticTask];
    updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const updateMutation = useMutation(api.tasks.core.update).withOptimisticUpdate((localStore, args) => {
    // A type change moves the task's Checks to the new type's checklist without a round trip.
    const taskChecks = args.taskTypeKey !== undefined ? localStore.getQuery(api.checks.checklists.getForTask, { taskId: args.id }) : undefined;
    if (taskChecks) {
      localStore.setQuery(api.checks.checklists.getForTask, { taskId: args.id }, retypeTaskChecks(taskChecks, resolveTaskTypeKey(args.taskTypeKey)));
    }
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    // eslint-disable-next-line react-hooks/purity -- Date.now() in optimistic update callback is fine
    const now = globalThis.Date.now();
    const resolvedTaskType = args.taskTypeKey !== undefined ? resolveTaskTypeSummary(resolveTaskTypeKey(args.taskTypeKey)) : null;
    const updatedTasks = currentTasks.map((task) => {
      if (task._id === args.id) {
        const { id: _id, dueDate, taskTypeKey: _taskTypeKey, assigneeId: _assigneeId, delegatedToAgentId: _delegatedToAgentId, ...rest } = args;
        void _id;
        void _taskTypeKey;
        void _assigneeId;
        void _delegatedToAgentId;
        const optimisticSplit = resolveOptimisticAssigneeSplit({
          pendingDetails: assigneeDetails.consume(String(args.id)),
          assigneeId: args.assigneeId,
          delegatedToAgentId: args.delegatedToAgentId,
        });
        applyOptimisticAutoSetOwner({
          split: optimisticSplit,
          assigneeId: args.assigneeId,
          delegatedToAgentId: args.delegatedToAgentId,
          currentAssignee: task.assignee,
          currentUser,
        });

        return {
          ...task,
          ...rest,
          ...(dueDate !== undefined && { dueDate: dueDate ?? undefined }),
          ...(optimisticSplit.assignee !== undefined && { assignee: optimisticSplit.assignee }),
          ...(optimisticSplit.delegatedToAgent !== undefined && { delegatedToAgent: optimisticSplit.delegatedToAgent }),
          ...(resolvedTaskType && { taskType: resolvedTaskType }),
          updatedAt: now,
        };
      }
      return task;
    });
    if (args.rank !== undefined) {
      updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    }
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const removeMutation = useMutation(api.tasks.core.remove).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const deletedTask = currentTasks.find((t) => t._id === args.id);
    if (!deletedTask) return;

    const cascadeMode = args.cascadeMode ?? "delete_all";

    if (cascadeMode === "keep_children") {
      const grandparentId = deletedTask.parentId ?? null;
      const updatedTasks = currentTasks
        .filter((task) => task._id !== args.id)
        .map((task) => (task.parentId === args.id ? { ...task, parentId: grandparentId } : task));
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    } else {
      const idsToRemove = collectTaskAndDescendantIds(currentTasks, new Set([args.id as string]));

      localStore.setQuery(
        api.tasks.core.listByProject,
        listByProjectArgs,
        currentTasks.filter((task) => !idsToRemove.has(task._id))
      );
    }
  });

  return {
    createMutation,
    updateMutation,
    duplicateMutation,
    removeMutation,
  };
}

export type TaskCrudMutationHandles = ReturnType<typeof useTaskCrudMutationHandles>;
