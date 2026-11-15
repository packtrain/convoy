import { useCallback, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { toastMutationRejection } from "@/lib/errors";
import { calculateRankBetween, resolveInsertIndex } from "@/lib/tasks/rank";
import { useAgentAutomationTrigger } from "@/lib/tasks/agent-automation/context";
import { pendingDetailsFromUpdate, type PendingAssigneeSplitDetails } from "@/lib/tasks/optimistic-assignees";
import { toTaskMutationArgs } from "@/lib/tasks/task-mutations";
import type { AddTaskOptions, Task, TaskUpdate } from "@/lib/tasks/types";
import { getChildren } from "@/lib/tasks/tree";
import type { OptimisticAssigneeDetailsStore } from "./optimistic-assignee-details";
import type { TaskCrudMutationHandles } from "./crud-mutations";

export function useTaskCrudActions({
  projectId,
  normalizedSelectedListRef,
  tasksRef,
  assigneeDetails,
  createMutation,
  updateMutation,
  duplicateMutation,
}: {
  projectId: Id<"projects"> | undefined;
  normalizedSelectedListRef: string | null;
  tasksRef: RefObject<Task[]>;
  assigneeDetails: OptimisticAssigneeDetailsStore;
  createMutation: TaskCrudMutationHandles["createMutation"];
  updateMutation: TaskCrudMutationHandles["updateMutation"];
  duplicateMutation: TaskCrudMutationHandles["duplicateMutation"];
}) {
  const automationTrigger = useAgentAutomationTrigger();

  const updateTask = useCallback(
    (id: string, updates: TaskUpdate) => {
      const pendingUpdateDetails = pendingDetailsFromUpdate(updates);
      if (pendingUpdateDetails) {
        assigneeDetails.queue(id, pendingUpdateDetails);
      }
      updateMutation(toTaskMutationArgs(id, updates)).catch(toastMutationRejection);

      // Assignment automation (OS-1094) only triggers from interactive UI
      // delegation — this is the shared delegation choke point for table,
      // board, and sidebar. Skip no-op re-delegation to the same agent.
      const agent = updates.delegatedToAgentDetails;
      if (agent && !agent.isDeleted) {
        const task = tasksRef.current.find((candidate) => candidate._id === id || candidate.clientId === id);
        const alreadyDelegated = task?.delegatedToAgent?.projectAgentId === agent.projectAgentId;
        if (task && !alreadyDelegated) {
          automationTrigger?.onTaskAssignedToAgent({ task, projectAgentId: agent.projectAgentId });
        }
      }
    },
    [assigneeDetails, automationTrigger, tasksRef, updateMutation]
  );

  const addTask = useCallback(
    (
      task: Omit<Task, "_id" | "clientId">,
      options?: AddTaskOptions
    ): string | null => {
      if (!projectId) return null;

      const currentTasks = tasksRef.current;
      const parentId = options?.parentId ?? null;

      const siblings = getChildren(parentId, currentTasks);
      const insertIndex = resolveInsertIndex(
        siblings.map((sibling) => sibling._id),
        options
      );

      const prevRank = siblings[insertIndex - 1]?.rank;
      const nextRank = siblings[insertIndex]?.rank;
      const newRank = calculateRankBetween(prevRank, nextRank);

      const clientId = crypto.randomUUID();

      // Draft → split args: assigneeInput is the id-only draft (e.g. from a
      // URL filter default); otherwise use hydrated draft details.
      const assigneeId = options?.assigneeId !== undefined
        ? options.assigneeId
        : task.assigneeInput !== undefined
          ? task.assigneeInput?.type === "user"
            ? task.assigneeInput.userId
            : undefined
          : (task.assignee?.userId ?? undefined);
      const delegatedToAgentId =
        task.assigneeInput?.type === "projectAgent"
          ? task.assigneeInput.projectAgentId
          : (task.delegatedToAgent?.projectAgentId ?? undefined);

      const createArgs = {
        projectId,
        parentId: parentId ? (parentId as Id<"tasks">) : undefined,
        clientId,
        name: task.name,
        taskTypeKey: task.taskType.key,
        priority: task.priority,
        dueDate: task.dueDate ?? undefined,
        status: task.status,
        listRef: normalizedSelectedListRef ?? undefined,
        ...(assigneeId !== undefined && { assigneeId }),
        ...(delegatedToAgentId !== undefined && { delegatedToAgentId }),
        tags: task.tags,
        labelId: task.labelId ?? undefined,
        sectionId: parentId ? undefined : (task.sectionId ?? undefined),
        rank: newRank,
      };

      const pendingDetails: PendingAssigneeSplitDetails = {
        ...(task.assignee ? { assignee: task.assignee } : {}),
        ...(task.delegatedToAgent ? { delegatedToAgent: task.delegatedToAgent } : {}),
      };
      if (pendingDetails.assignee !== undefined || pendingDetails.delegatedToAgent !== undefined) {
        assigneeDetails.queue(clientId, pendingDetails);
      }

      createMutation(createArgs).catch(toastMutationRejection);

      return clientId;
    },
    [assigneeDetails, createMutation, normalizedSelectedListRef, projectId, tasksRef]
  );

  const duplicateTask = useCallback(
    (id: string): string | null => {
      const currentTasks = tasksRef.current;
      const originalTask = currentTasks.find((t) => t._id === id);
      if (!originalTask) return null;

      const siblings = getChildren(originalTask.parentId ?? null, currentTasks);
      const originalIndex = siblings.findIndex((t) => t._id === id);
      const nextSibling = siblings[originalIndex + 1];

      const newRank = calculateRankBetween(originalTask.rank, nextSibling?.rank);

      const newClientId = crypto.randomUUID();
      duplicateMutation({ id: id as Id<"tasks">, newClientId, newRank }).catch(toastMutationRejection);
      return newClientId;
    },
    [duplicateMutation, tasksRef]
  );

  return {
    addTask,
    updateTask,
    duplicateTask,
  };
}
