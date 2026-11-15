import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { TaskListQueryArgs } from "./query-state";

export function useTaskRankMutationHandles({ listByProjectArgs }: { listByProjectArgs: TaskListQueryArgs | null }) {
  const updateRankMutation = useMutation(api.tasks.core.rank.update).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const updatedTasks = currentTasks.map((task) => (task._id === args.id ? { ...task, rank: args.rank, updatedAt: Date.now() } : task));
    updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const batchUpdateRanksMutation = useMutation(api.tasks.core.rank.batchUpdate).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const rankByTaskId = new Map(args.updates.map((update) => [update.id as string, update.rank]));
    const updatedTasks = currentTasks.map((task) => {
      const rank = rankByTaskId.get(task._id);
      return rank ? { ...task, rank, updatedAt: Date.now() } : task;
    });
    updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  const updateParentMutation = useMutation(api.tasks.core.move.toParent).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    // Mirrors move.toParent: only roots carry a section; a promoted subtask keeps its old root's.
    const byId = new Map(currentTasks.map((task) => [task._id, task]));
    let root = byId.get(args.id);
    while (root?.parentId) root = byId.get(root.parentId);
    const updatedTasks = currentTasks.map((task) =>
      task._id === args.id
        ? {
            ...task,
            parentId: args.parentId,
            rank: args.rank ?? task.rank,
            sectionId: args.parentId ? null : (root?.sectionId ?? null),
            updatedAt: Date.now(),
          }
        : task
    );
    updatedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
  });

  return {
    updateRankMutation,
    batchUpdateRanksMutation,
    updateParentMutation,
  };
}

export type TaskRankMutationHandles = ReturnType<typeof useTaskRankMutationHandles>;
