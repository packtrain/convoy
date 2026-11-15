import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import type { TaskListQueryArgs } from "./query-state";

export function useTaskListMoveMutationHandles({
  listByProjectArgs,
  normalizedSelectedListRef,
}: {
  listByProjectArgs: TaskListQueryArgs | null;
  normalizedSelectedListRef: string | null;
}) {
  const moveToListMutation = useMutation(api.tasks.core.move.toList).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const rootIds = new Set(args.rootIds.map(String));
    const idsToMove = collectTaskAndDescendantIds(currentTasks, rootIds);
    const targetListRef = (args.listRef ?? args.listId)?.trim().toUpperCase();
    if (!targetListRef) return;
    if (normalizedSelectedListRef === targetListRef) {
      return;
    }

    localStore.setQuery(
      api.tasks.core.listByProject,
      listByProjectArgs,
      currentTasks.filter((task) => !idsToMove.has(task._id))
    );
  });

  return { moveToListMutation };
}

export type TaskListMoveMutationHandles = ReturnType<typeof useTaskListMoveMutationHandles>;
