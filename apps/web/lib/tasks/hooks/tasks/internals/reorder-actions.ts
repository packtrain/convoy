import { useCallback, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { toastMutationRejection } from "@/lib/errors";
import { calculateRankBetween } from "@/lib/tasks/rank";
import { buildDuplicateRankHealingUpdates } from "@/lib/tasks/rank-healing";
import { planClosedTasksToBottom } from "@/lib/tasks/closed-task-ordering";
import { toTaskMutationArgs } from "@/lib/tasks/task-mutations";
import { pendingDetailsFromUpdate } from "@/lib/tasks/optimistic-assignees";
import type { ReorderPosition, Task, TaskUpdate } from "@/lib/tasks/types";
import { getChildren } from "@/lib/tasks/tree";
import type { OptimisticAssigneeDetailsStore } from "./optimistic-assignee-details";
import type { TaskCrudMutationHandles } from "./crud-mutations";
import type { TaskRankMutationHandles } from "./rank-mutations";

export function useTaskReorderActions({
  tasksRef,
  assigneeDetails,
  updateMutation,
  updateRankMutation,
  batchUpdateRanksMutation,
}: {
  tasksRef: RefObject<Task[]>;
  assigneeDetails: OptimisticAssigneeDetailsStore;
  updateMutation: TaskCrudMutationHandles["updateMutation"];
  updateRankMutation: TaskRankMutationHandles["updateRankMutation"];
  batchUpdateRanksMutation: TaskRankMutationHandles["batchUpdateRanksMutation"];
}) {
  const reorderTasks = useCallback(
    (sourceId: string, targetId: string, parentId?: string | null, position: ReorderPosition = "before") => {
      if (sourceId === targetId) return;

      const items = tasksRef.current;
      const isAddTaskTarget = targetId.startsWith("add-");

      let effectiveParentId: string | null;
      if (parentId !== undefined) {
        effectiveParentId = parentId;
      } else if (isAddTaskTarget) {
        effectiveParentId = targetId === "add-root" ? null : targetId.slice(4);
      } else {
        const targetTask = items.find((t) => t._id === targetId);
        effectiveParentId = targetTask?.parentId ?? null;
      }

      const siblings = getChildren(effectiveParentId, items).filter((t) => t._id !== sourceId);

      let newRank: string;

      if (isAddTaskTarget) {
        const lastRank = siblings[siblings.length - 1]?.rank;
        newRank = calculateRankBetween(lastRank, undefined);
      } else {
        const targetIndex = siblings.findIndex((t) => t._id === targetId);
        if (targetIndex === -1) return;
        const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;

        const sourceTask = items.find((task) => task._id === sourceId);
        if (sourceTask?.parentId === effectiveParentId) {
          const healingUpdates = buildDuplicateRankHealingUpdates(siblings, insertIndex, [sourceId]);
          if (healingUpdates) {
            batchUpdateRanksMutation({ updates: healingUpdates }).catch(toastMutationRejection);
            return;
          }
        }

        const prevRank = siblings[insertIndex - 1]?.rank;
        const nextRank = siblings[insertIndex]?.rank;
        newRank = calculateRankBetween(prevRank, nextRank);
      }

      updateRankMutation({ id: sourceId as Id<"tasks">, rank: newRank }).catch(toastMutationRejection);
    },
    [batchUpdateRanksMutation, updateRankMutation, tasksRef]
  );

  const moveTask = useCallback(
    (sourceId: string, updates: TaskUpdate, rankTarget?: { targetTaskId: string; position: ReorderPosition }) => {
      const pendingUpdateDetails = pendingDetailsFromUpdate(updates);
      if (pendingUpdateDetails) {
        assigneeDetails.queue(sourceId, pendingUpdateDetails);
      }

      if (!rankTarget) {
        updateMutation(toTaskMutationArgs(sourceId, updates)).catch(toastMutationRejection);
        return;
      }

      const items = tasksRef.current;
      const siblings = getChildren(null, items).filter((t) => t._id !== sourceId);
      const targetIndex = siblings.findIndex((t) => t._id === rankTarget.targetTaskId);
      if (targetIndex === -1) {
        updateMutation(toTaskMutationArgs(sourceId, updates)).catch(toastMutationRejection);
        return;
      }

      const insertIndex = rankTarget.position === "after" ? targetIndex + 1 : targetIndex;

      const sourceTask = items.find((task) => task._id === sourceId);
      if (sourceTask && sourceTask.parentId === null) {
        const healingUpdates = buildDuplicateRankHealingUpdates(siblings, insertIndex, [sourceId]);
        if (healingUpdates) {
          batchUpdateRanksMutation({ updates: healingUpdates }).catch(toastMutationRejection);
          updateMutation(toTaskMutationArgs(sourceId, updates)).catch(toastMutationRejection);
          return;
        }
      }

      const prevRank = siblings[insertIndex - 1]?.rank;
      const nextRank = siblings[insertIndex]?.rank;
      updateMutation(
        toTaskMutationArgs(sourceId, {
          ...updates,
          rank: calculateRankBetween(prevRank, nextRank),
        })
      ).catch(toastMutationRejection);
    },
    [assigneeDetails, batchUpdateRanksMutation, tasksRef, updateMutation]
  );

  const reorderMultiple = useCallback(
    (ids: string[], targetId: string, parentId?: string | null, position: ReorderPosition = "before") => {
      const items = tasksRef.current;
      const isAddTaskTarget = targetId.startsWith("add-");

      if (!isAddTaskTarget && ids.includes(targetId)) return;

      let effectiveParentId: string | null;
      if (parentId !== undefined) {
        effectiveParentId = parentId;
      } else if (isAddTaskTarget) {
        effectiveParentId = targetId === "add-root" ? null : targetId.slice(4);
      } else {
        const targetTask = items.find((t) => t._id === targetId);
        effectiveParentId = targetTask?.parentId ?? null;
      }

      const allSiblings = getChildren(effectiveParentId, items);
      const remaining = allSiblings.filter((t) => !ids.includes(t._id as string));
      const selected = items.filter((t) => ids.includes(t._id as string));

      let insertIndex: number;
      if (isAddTaskTarget) {
        insertIndex = remaining.length;
      } else {
        const targetIndex = remaining.findIndex((t) => t._id === targetId);
        if (targetIndex === -1) return;
        insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
      }

      const selectedAlreadyInScope = selected.every((task) => task.parentId === effectiveParentId);
      if (selectedAlreadyInScope) {
        const healingUpdates = buildDuplicateRankHealingUpdates(
          remaining,
          insertIndex,
          selected.map((task) => task._id)
        );
        if (healingUpdates) {
          batchUpdateRanksMutation({ updates: healingUpdates }).catch(toastMutationRejection);
          return;
        }
      }

      const result = [...remaining.slice(0, insertIndex), ...selected, ...remaining.slice(insertIndex)];

      const startIdx = insertIndex;
      const endIdx = insertIndex + selected.length;
      const finalNextRank = result[endIdx]?.rank;

      for (let i = startIdx; i < endIdx; i++) {
        const prevRank = result[i - 1]?.rank;
        const newRank = calculateRankBetween(prevRank, finalNextRank);
        result[i] = { ...result[i], rank: newRank };
        updateRankMutation({ id: result[i]._id, rank: newRank }).catch(toastMutationRejection);
      }
    },
    [batchUpdateRanksMutation, updateRankMutation, tasksRef]
  );

  const moveClosedToBottom = useCallback(
    (rootIds: string[]) => {
      const rootIdSet = new Set(rootIds);
      const orderedRoots = tasksRef.current.filter((task) => rootIdSet.has(String(task._id))).sort((a, b) => a.rank.localeCompare(b.rank));
      const plan = planClosedTasksToBottom(orderedRoots);
      if (plan.updates.length === 0) return;

      batchUpdateRanksMutation({
        updates: plan.updates.map((update) => ({
          id: update.id,
          rank: update.rank,
        })),
      }).catch(toastMutationRejection);
    },
    [batchUpdateRanksMutation, tasksRef]
  );

  return {
    reorderTasks,
    reorderMultiple,
    moveTask,
    moveClosedToBottom,
  };
}
