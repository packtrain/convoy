import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import type { ArchiveFilter } from "@/lib/tasks/types";
import type { TaskArchiveState } from "./archive-state";
import type { TaskListQueryArgs } from "./query-state";

export function useTaskArchiveMutationHandles({
  listByProjectArgs,
  archiveFilter,
  archiveState,
}: {
  listByProjectArgs: TaskListQueryArgs | null;
  archiveFilter: ArchiveFilter;
  archiveState: TaskArchiveState;
}) {
  const archiveMutation = useMutation(api.tasks.core.archive).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    const idsToArchive = collectTaskAndDescendantIds(currentTasks, new Set([args.id as string]));

    // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
    const now = globalThis.Date.now();

    if (archiveFilter === "active") {
      archiveState.captureArchivedSnapshots(currentTasks, idsToArchive);
      archiveState.removePendingUnarchivedTasks(idsToArchive);

      const updatedTasks = currentTasks.filter((task) => !idsToArchive.has(task._id));
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    } else {
      const updatedTasks = currentTasks.map((task) =>
        idsToArchive.has(task._id) ? { ...task, isArchived: true, archivedAt: now, updatedAt: now } : task
      );
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    }
  });

  const unarchiveMutation = useMutation(api.tasks.core.unarchive).withOptimisticUpdate((localStore, args) => {
    if (!listByProjectArgs) return;
    const currentTasks = localStore.getQuery(api.tasks.core.listByProject, listByProjectArgs);
    if (!currentTasks) return;

    // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
    const now = globalThis.Date.now();

    const idsToUnarchive = collectTaskAndDescendantIds(currentTasks, new Set([args.id as string]));

    if (archiveFilter === "archived") {
      const updatedTasks = currentTasks.filter((task) => !idsToUnarchive.has(task._id));
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    } else {
      const updatedTasks = currentTasks.map((task) =>
        idsToUnarchive.has(task._id)
          ? {
              ...task,
              isArchived: false,
              archivedAt: undefined,
              archivedBy: undefined,
              updatedAt: now,
            }
          : task
      );
      localStore.setQuery(api.tasks.core.listByProject, listByProjectArgs, updatedTasks);
    }
  });

  const restoreMutation = useMutation(api.tasks.core.restore);

  return {
    archiveMutation,
    unarchiveMutation,
    restoreMutation,
  };
}

export type TaskArchiveMutationHandles = ReturnType<typeof useTaskArchiveMutationHandles>;
