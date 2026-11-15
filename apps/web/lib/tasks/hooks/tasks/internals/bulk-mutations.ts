import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import { resolveTaskTypeKey, resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { applyOptimisticAutoSetOwner, resolveOptimisticAssigneeSplit } from "@/lib/tasks/optimistic-assignees";
import type { ArchiveFilter } from "@/lib/tasks/types";
import type { OptimisticAssigneeDetailsStore } from "./optimistic-assignee-details";
import type { TaskArchiveState } from "./archive-state";
import type { TaskListQueryArgs } from "./query-state";

export function useTaskBulkMutationHandles({
  listByProjectArgs,
  archiveFilter,
  assigneeDetails,
  archiveState,
}: {
  listByProjectArgs: TaskListQueryArgs | null;
  archiveFilter: ArchiveFilter;
  assigneeDetails: OptimisticAssigneeDetailsStore;
  archiveState: TaskArchiveState;
}) {
  // For the optimistic auto-set-owner mirror on bulk delegation.
  const currentUser = useQuery(api.users.core.current);

  const bulkUpdateMutation = useMutation(api.tasks.core.bulk.update).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const idsSet = new Set(args.ids.map((id) => id as string));
    const resolvedTaskType = args.taskTypeKey !== undefined ? resolveTaskTypeSummary(resolveTaskTypeKey(args.taskTypeKey)) : null;
    // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
    const now = globalThis.Date.now();
    const updatedTasks = currentTasks.map((task) => {
      if (idsSet.has(task._id)) {
        const optimisticSplit = resolveOptimisticAssigneeSplit({
          pendingDetails: assigneeDetails.consume(String(task._id)),
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
          ...(args.status !== undefined && { status: args.status }),
          ...(optimisticSplit.assignee !== undefined && { assignee: optimisticSplit.assignee }),
          ...(optimisticSplit.delegatedToAgent !== undefined && { delegatedToAgent: optimisticSplit.delegatedToAgent }),
          ...(args.priority !== undefined && { priority: args.priority }),
          ...(args.dueDate !== undefined && { dueDate: args.dueDate ?? null }),
          ...(resolvedTaskType && { taskType: resolvedTaskType }),
          updatedAt: now,
        };
      }
      return task;
    });
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const bulkRemoveMutation = useMutation(api.tasks.core.bulk.remove).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const selectedIds = new Set(args.ids.map(String));
    const cascadeMode = args.cascadeMode ?? "delete_all";

    if (cascadeMode === "keep_children") {
      const updatedTasks = currentTasks
        .filter((task) => !selectedIds.has(String(task._id)))
        .map((task) => {
          if (task.parentId && selectedIds.has(task.parentId)) {
            const deletedParent = currentTasks.find((t) => t._id === task.parentId);
            return {
              ...task,
              parentId: deletedParent?.parentId ?? null,
            };
          }
          return task;
        });
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    } else {
      const idsToRemove = collectTaskAndDescendantIds(currentTasks, selectedIds);

      localStore.setQuery(
        api.tasks.core.listByProject,
        listByProjectArgs,
        currentTasks.filter((task) => !idsToRemove.has(task._id))
      );
    }
  });

  const bulkArchiveMutation = useMutation(api.tasks.core.bulk.archive).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    if (archiveFilter === "active") {
      const idsSet = new Set(args.ids.map(String));
      const idsToArchive = collectTaskAndDescendantIds(currentTasks, idsSet);

      archiveState.captureArchivedSnapshots(currentTasks, idsToArchive);
      archiveState.removePendingUnarchivedTasks(idsToArchive);

      const updatedTasks = currentTasks.filter((task) => !idsToArchive.has(task._id));
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    }
  });

  const bulkUnarchiveMutation = useMutation(api.tasks.core.bulk.unarchive).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs || archiveFilter !== "archived") return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const rootIds = new Set(args.ids.map(String));
    const idsToUnarchive = collectTaskAndDescendantIds(currentTasks, rootIds);
    localStore.setQuery(
      api.tasks.core.listByProject,
      listByProjectArgs,
      currentTasks.filter((task) => !idsToUnarchive.has(task._id))
    );
  });

  return {
    bulkUpdateMutation,
    bulkRemoveMutation,
    bulkArchiveMutation,
    bulkUnarchiveMutation,
  };
}

export type TaskBulkMutationHandles = ReturnType<typeof useTaskBulkMutationHandles>;
