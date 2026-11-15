"use client";

import { useCallback } from "react";
import { usePaginatedQuery, useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toastMutationRejection } from "@/lib/errors";
import { useLastResolvedValue } from "@/hooks/react/use-last-resolved-value";
import type {
  ReorderMultipleFn,
  ReorderTasksFn,
  Task,
  TaskUpdate,
} from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import { toTaskMutationArgs } from "@/lib/tasks/task-mutations";
import { useMappedTasks, useTaskInputState, useTaskTreeState } from "./use-task-view-state";
import { useTaskDeleteMutations } from "./use-task-delete-mutations";

const PAGE_SIZE = 50;

interface AddTaskOptions {
  parentId?: string;
  afterId?: string;
  beforeId?: string;
}

const unsupportedArchivedOperations = {
  addTask: (
    task: Omit<Task, "_id" | "clientId">,
    options?: AddTaskOptions
  ): string | null => {
    void task;
    void options;
    return null;
  },
  archiveTask: async (id: string): Promise<string[]> => {
    void id;
    return [];
  },
  setParent: (id: string, parentId: string | null, rank?: string): void => {
    void id;
    void parentId;
    void rank;
  },
  setParentMultiple: (ids: string[], parentId: string | null, afterTaskId?: string): void => {
    void ids;
    void parentId;
    void afterTaskId;
  },
  reorderTasks: ((): void => {}) as ReorderTasksFn,
  reorderMultiple: ((): void => {}) as ReorderMultipleFn,
  bulkArchive: async (ids: string[]): Promise<string[]> => {
    void ids;
    return [];
  },
  moveToList: (rootIds: string[], listRef: string): void => {
    void rootIds;
    void listRef;
  },
  moveActiveToList: async (listRef: string): Promise<void> => {
    void listRef;
  },
  moveClosedToBottom: (rootIds: string[]): void => {
    void rootIds;
  },
  duplicateTask: (id: string): string | null => {
    void id;
    return null;
  },
};

function optimisticallyRemoveArchivedTasks(
  localStore: OptimisticLocalStore,
  projectId: Id<"projects"> | undefined,
  rootIds: Id<"tasks">[]
) {
  if (!projectId || rootIds.length === 0) return;

  const rootIdSet = new Set(rootIds.map(String));
  for (const queryResult of localStore.getAllQueries(api.tasks.core.listArchivedByProject)) {
    const args = queryResult.args;
    if (args.projectId !== projectId || queryResult.value === undefined) {
      continue;
    }

    const value = queryResult.value;
    const idsToRemove = collectTaskAndDescendantIds(value.page, rootIdSet);
    localStore.setQuery(api.tasks.core.listArchivedByProject, args, {
      ...value,
      page: value.page.filter((task) => !idsToRemove.has(task._id)),
    });
  }
}

export function useArchivedTasks(projectId: Id<"projects"> | undefined) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tasks.core.listArchivedByProject,
    projectId ? { projectId } : "skip",
    { initialNumItems: PAGE_SIZE }
  );
  const stableResults = useLastResolvedValue({
    cacheKey: projectId ? `tasks:${projectId}:archived-paginated` : null,
    enabled: Boolean(projectId),
    value: status === "LoadingFirstPage" ? undefined : results,
  });

  const tasks = useMappedTasks(stableResults);
  const {
    taskTree,
    flattenedTasks,
    expandedIds,
    toggleExpanded,
    expandAll,
    collapseAll,
  } = useTaskTreeState(tasks, { preserveRootOrder: true });
  const {
    tasksRef,
    inputRefs,
    rowRefs,
    registerInput,
    registerRow,
    focusInput,
    getAdjacentId,
  } = useTaskInputState(tasks);

  // Mutations
  const updateMutation = useMutation(api.tasks.core.update);
  const removeMutation = useMutation(api.tasks.core.remove);
  const unarchiveMutation = useMutation(api.tasks.core.unarchive).withOptimisticUpdate(
    (localStore, args) => {
      optimisticallyRemoveArchivedTasks(localStore, projectId, [args.id]);
    }
  );
  const bulkUpdateMutation = useMutation(api.tasks.core.bulk.update);
  const bulkRemoveMutation = useMutation(api.tasks.core.bulk.remove);
  const bulkUnarchiveMutation = useMutation(
    api.tasks.core.bulk.unarchive
  ).withOptimisticUpdate((localStore, args) => {
    optimisticallyRemoveArchivedTasks(localStore, projectId, args.ids);
  });
  const restoreMutation = useMutation(api.tasks.core.restore);
  const {
    deleteTask,
    bulkDelete,
    bulkDeleteWithChildren,
    restoreTask,
  } = useTaskDeleteMutations({
    removeMutation,
    bulkRemoveMutation,
    restoreMutation,
  });

  const updateTask = useCallback(
    (id: string, updates: TaskUpdate) => {
      updateMutation(toTaskMutationArgs(id, updates)).catch(toastMutationRejection);
    },
    [updateMutation]
  );

  const unarchiveTask = useCallback(
    async (id: string): Promise<void> => {
      await unarchiveMutation({ id: id as Id<"tasks"> });
    },
    [unarchiveMutation]
  );

  const bulkUpdateStatus = useCallback(
    (ids: string[], status: Task["status"]) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], status }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateAssignee = useCallback(
    (ids: string[], change: TaskAssigneeChange) => {
      bulkUpdateMutation({
        ids: ids as Id<"tasks">[],
        ...(change.assigneeId !== undefined && { assigneeId: change.assigneeId }),
        ...(change.delegatedToAgentId !== undefined && { delegatedToAgentId: change.delegatedToAgentId }),
      }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdatePriority = useCallback(
    (ids: string[], priority: Task["priority"]) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], priority }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateDueDate = useCallback(
    (ids: string[], dueDate: number | null) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], dueDate }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateTaskType = useCallback(
    (ids: string[], taskTypeKey: string | null) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], taskTypeKey }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUnarchive = useCallback(
    async (ids: string[]): Promise<void> => {
      await bulkUnarchiveMutation({ ids: ids as Id<"tasks">[] });
    },
    [bulkUnarchiveMutation]
  );

  // Check if a task has children
  const hasChildren = useCallback((id: string): boolean => {
    return tasksRef.current.some((t) => t.parentId === id);
  }, [tasksRef]);

  // Get child count for a task
  const getChildCount = useCallback((id: string): number => {
    return tasksRef.current.filter((t) => t.parentId === id).length;
  }, [tasksRef]);

  return {
    tasks,
    isLoading: status === "LoadingFirstPage" && stableResults === undefined,
    // Pagination
    hasMore: status === "CanLoadMore" || status === "LoadingMore",
    isLoadingMore: status === "LoadingMore",
    loadMore: () => loadMore(PAGE_SIZE),
    // Tree structure
    taskTree,
    flattenedTasks,
    expandedIds,
    toggleExpanded,
    expandAll,
    collapseAll,
    // CRUD
    updateTask,
    addTask: unsupportedArchivedOperations.addTask,
    deleteTask,
    archiveTask: unsupportedArchivedOperations.archiveTask,
    unarchiveTask,
    setParent: unsupportedArchivedOperations.setParent,
    setParentMultiple: unsupportedArchivedOperations.setParentMultiple,
    hasChildren,
    getChildCount,
    reorderTasks: unsupportedArchivedOperations.reorderTasks,
    reorderMultiple: unsupportedArchivedOperations.reorderMultiple,
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    bulkDelete,
    bulkDeleteWithChildren,
    bulkArchive: unsupportedArchivedOperations.bulkArchive,
    bulkUnarchive,
    moveToList: unsupportedArchivedOperations.moveToList,
    moveActiveToList: unsupportedArchivedOperations.moveActiveToList,
    moveClosedToBottom: unsupportedArchivedOperations.moveClosedToBottom,
    restoreTask,
    duplicateTask: unsupportedArchivedOperations.duplicateTask,
    // Element refs
    inputRefs,
    rowRefs,
    registerInput,
    registerRow,
    focusInput,
    getAdjacentId,
  };
}
