import { useCallback } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ArchiveFilter, StatusFilterKey } from "@/lib/tasks/types";
import { taskIdsToStrings } from "@/lib/tasks/id-utils";
import { useMappedTasks, useTaskInputState, useTaskTreeState } from "./use-task-view-state";
import { useTaskDeleteMutations } from "./use-task-delete-mutations";
import { useTaskListQueryState } from "./internals/query-state";
import { useOptimisticAssigneeDetails } from "./internals/optimistic-assignee-details";
import { useTaskArchiveState } from "./internals/archive-state";
import { useTaskRankMutationHandles } from "./internals/rank-mutations";
import { useTaskListMoveMutationHandles } from "./internals/list-move-mutations";
import { useTaskArchiveMutationHandles } from "./internals/archive-mutations";
import { useTaskBulkMutationHandles } from "./internals/bulk-mutations";
import { useTaskCrudMutationHandles } from "./internals/crud-mutations";
import { useTaskCrudActions } from "./internals/crud-actions";
import { useTaskHierarchyActions } from "./internals/hierarchy-actions";
import { useTaskReorderActions } from "./internals/reorder-actions";
import { useTaskBulkActions } from "./internals/bulk-actions";

// External interface uses string IDs for compatibility with existing components
// Internal operations cast to Id<"tasks"> when calling Convex mutations
export function useTasks(
  projectId: Id<"projects"> | undefined,
  archiveFilter: ArchiveFilter = "active",
  statusFilter: StatusFilterKey = "all",
  selectedListRef: string | null = null
) {
  const { normalizedSelectedListRef, listByProjectArgs, tasksData, isLoading } = useTaskListQueryState({
    projectId,
    archiveFilter,
    statusFilter,
    selectedListRef,
  });
  const assigneeDetails = useOptimisticAssigneeDetails();
  const archiveState = useTaskArchiveState({ archiveFilter, tasksData });
  const { updateRankMutation, batchUpdateRanksMutation, updateParentMutation } = useTaskRankMutationHandles({ listByProjectArgs });
  const { moveToListMutation } = useTaskListMoveMutationHandles({
    listByProjectArgs,
    normalizedSelectedListRef,
  });
  const { archiveMutation, unarchiveMutation, restoreMutation } = useTaskArchiveMutationHandles({
    listByProjectArgs,
    archiveFilter,
    archiveState,
  });
  const { bulkUpdateMutation, bulkRemoveMutation, bulkArchiveMutation, bulkUnarchiveMutation } = useTaskBulkMutationHandles({
    listByProjectArgs,
    archiveFilter,
    assigneeDetails,
    archiveState,
  });
  const { createMutation, updateMutation, duplicateMutation, removeMutation } = useTaskCrudMutationHandles({
    listByProjectArgs,
    assigneeDetails,
  });

  const { deleteTask, bulkDelete, bulkDeleteWithChildren, restoreTask } = useTaskDeleteMutations({
    removeMutation,
    bulkRemoveMutation,
    restoreMutation,
  });

  const tasks = useMappedTasks(archiveState.displayedTasksData);
  const { taskTree, flattenedTasks, expandedIds, toggleExpanded, expandAll, collapseAll } = useTaskTreeState(tasks, {
    preserveRootOrder: archiveFilter === "archived",
  });
  const { tasksRef, inputRefs, rowRefs, registerInput, registerRow, focusInput, getAdjacentId } = useTaskInputState(tasks);

  const { addTask, updateTask, duplicateTask } = useTaskCrudActions({
    projectId,
    normalizedSelectedListRef,
    tasksRef,
    assigneeDetails,
    createMutation,
    updateMutation,
    duplicateMutation,
  });

  const archiveTask = useCallback(
    async (id: string): Promise<string[]> => {
      const result = await archiveMutation({ id: id as Id<"tasks"> });
      return taskIdsToStrings(result.archivedRootIds);
    },
    [archiveMutation]
  );

  const unarchiveTask = useCallback(
    async (id: string): Promise<void> => {
      await unarchiveMutation({ id: id as Id<"tasks"> });
    },
    [unarchiveMutation]
  );

  const { setParent, setParentMultiple, hasChildren, getChildCount } = useTaskHierarchyActions({
    tasksRef,
    updateParentMutation,
  });
  const { reorderTasks, reorderMultiple, moveTask, moveClosedToBottom } = useTaskReorderActions({
    tasksRef,
    assigneeDetails,
    updateMutation,
    updateRankMutation,
    batchUpdateRanksMutation,
  });
  const {
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    moveToList,
    moveActiveToList,
    bulkArchive,
    bulkUnarchive,
  } = useTaskBulkActions({
    assigneeDetails,
    bulkUpdateMutation,
    moveToListMutation,
    bulkArchiveMutation,
    bulkUnarchiveMutation,
    archiveState,
    tasksRef,
  });

  return {
    tasks,
    isLoading,
    // Tree structure
    taskTree,
    flattenedTasks,
    expandedIds,
    toggleExpanded,
    expandAll,
    collapseAll,
    // CRUD
    updateTask,
    addTask,
    deleteTask,
    archiveTask,
    unarchiveTask,
    setParent,
    setParentMultiple,
    hasChildren,
    getChildCount,
    reorderTasks,
    reorderMultiple,
    moveTask,
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    moveToList,
    moveActiveToList,
    moveClosedToBottom,
    bulkDelete,
    bulkDeleteWithChildren,
    bulkArchive,
    bulkUnarchive,
    restoreTask,
    duplicateTask,
    // Element refs
    inputRefs,
    rowRefs,
    registerInput,
    registerRow,
    focusInput,
    getAdjacentId,
  };
}
