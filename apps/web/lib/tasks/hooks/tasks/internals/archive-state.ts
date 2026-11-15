import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LexoRank } from "lexorank";
import type { ArchiveFilter } from "@/lib/tasks/types";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";
import type { ListedTask } from "./query-state";

export type TaskArchiveState = {
  displayedTasksData: ListedTask[] | undefined;
  captureArchivedSnapshots: (tasks: readonly ListedTask[], ids: ReadonlySet<string>) => void;
  addPendingUnarchivedTasks: (ids: readonly string[]) => string[];
  removePendingUnarchivedTasks: (ids: Iterable<string>) => void;
  clearArchivedSnapshots: (ids: Iterable<string>) => void;
};

export function useTaskArchiveState({
  archiveFilter,
  tasksData,
}: {
  archiveFilter: ArchiveFilter;
  tasksData: ListedTask[] | undefined;
}): TaskArchiveState {
  const archivedTaskSnapshotsRef = useRef<Map<string, ListedTask>>(new Map());
  const [pendingUnarchivedTasks, setPendingUnarchivedTasks] = useState<Map<string, ListedTask>>(() => new Map());

  const removePendingUnarchivedTasks = useCallback((ids: Iterable<string>) => {
    setPendingUnarchivedTasks((current) => {
      let changed = false;
      const next = new Map(current);
      for (const id of ids) {
        if (next.delete(id)) {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const clearArchivedSnapshots = useCallback((ids: Iterable<string>) => {
    for (const id of ids) {
      archivedTaskSnapshotsRef.current.delete(id);
    }
  }, []);

  const captureArchivedSnapshots = useCallback((tasks: readonly ListedTask[], ids: ReadonlySet<string>) => {
    for (const task of tasks) {
      if (ids.has(task._id)) {
        archivedTaskSnapshotsRef.current.set(task._id, task);
      }
    }
  }, []);

  useEffect(() => {
    if (archiveFilter !== "active" || !tasksData || pendingUnarchivedTasks.size === 0) {
      return;
    }

    const serverIds = new Set(tasksData.map((task) => String(task._id)));
    queueMicrotask(() => removePendingUnarchivedTasks(serverIds));
  }, [archiveFilter, pendingUnarchivedTasks.size, removePendingUnarchivedTasks, tasksData]);

  const displayedTasksData = useMemo(() => {
    if (archiveFilter !== "active" || !tasksData || pendingUnarchivedTasks.size === 0) {
      return tasksData;
    }

    const existingIds = new Set(tasksData.map((task) => task._id));
    const pendingTasks = [...pendingUnarchivedTasks.values()].filter((task) => !existingIds.has(task._id));
    if (pendingTasks.length === 0) {
      return tasksData;
    }

    const mergedTasks = [...tasksData, ...pendingTasks];
    mergedTasks.sort((a, b) => a.rank.localeCompare(b.rank));
    return mergedTasks;
  }, [archiveFilter, pendingUnarchivedTasks, tasksData]);

  const addPendingUnarchivedTasks = useCallback(
    (ids: readonly string[]) => {
      if (archiveFilter !== "active" || !tasksData) {
        return [];
      }

      const rootIds = new Set(ids.map(String));
      const snapshotTasks = [...archivedTaskSnapshotsRef.current.values()];
      const idsToRestore = collectTaskAndDescendantIds(snapshotTasks, rootIds);
      const existingIds = new Set(tasksData.map((task) => task._id));
      const firstActiveRoot = tasksData.find((task) => task.parentId === null);
      const rootRestoreOrder = ids
        .map((id) => archivedTaskSnapshotsRef.current.get(String(id)))
        .filter((task): task is ListedTask => task !== undefined && !existingIds.has(task._id));
      const rankByRootId = new Map<string, string>();
      let rankBoundary = firstActiveRoot?.rank;
      for (let i = rootRestoreOrder.length - 1; i >= 0; i--) {
        const task = rootRestoreOrder[i];
        let rank = task.rank;
        try {
          rank = rankBoundary ? LexoRank.parse(rankBoundary).genPrev().toString() : LexoRank.middle().toString();
        } catch {
          // Keep the snapshot rank if local optimistic rank generation hits a boundary.
          // The server still assigns the canonical top-of-list rank.
        }
        rankByRootId.set(task._id, rank);
        rankBoundary = rank;
      }
      const now = globalThis.Date.now();
      const restoredTasks = [...idsToRestore]
        .map((id) => archivedTaskSnapshotsRef.current.get(id))
        .filter((task): task is ListedTask => task !== undefined && !existingIds.has(task._id))
        .map((task) => ({
          ...task,
          parentId: rootIds.has(task._id) ? null : task.parentId,
          isArchived: false,
          archivedAt: undefined,
          archivedBy: undefined,
          rank: rankByRootId.get(task._id) ?? task.rank,
          updatedAt: now,
        }));

      if (restoredTasks.length === 0) {
        return [];
      }

      setPendingUnarchivedTasks((current) => {
        const next = new Map(current);
        for (const task of restoredTasks) {
          next.set(task._id, task);
        }
        return next;
      });

      return [...idsToRestore];
    },
    [archiveFilter, tasksData]
  );

  return useMemo(
    () => ({
      displayedTasksData,
      captureArchivedSnapshots,
      addPendingUnarchivedTasks,
      removePendingUnarchivedTasks,
      clearArchivedSnapshots,
    }),
    [addPendingUnarchivedTasks, captureArchivedSnapshots, clearArchivedSnapshots, displayedTasksData, removePendingUnarchivedTasks]
  );
}
