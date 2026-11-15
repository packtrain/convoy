import { useState, useCallback, useRef, useEffect } from "react";
import type { LocalTask, ReorderPosition } from "@/lib/tasks/types";
import { calculateRankBetween, resolveInsertIndex } from "@/lib/tasks/rank";

// Local state version for playground/performance testing
function getLocalChildren(parentId: string | null, tasks: LocalTask[]) {
  return tasks
    .filter((task) => task.parentId === parentId)
    .sort((a, b) => a.rank.localeCompare(b.rank));
}

function getEffectiveParentId(
  tasks: LocalTask[],
  targetId: string,
  parentId?: string | null
) {
  if (parentId !== undefined) {
    return parentId;
  }

  if (targetId.startsWith("add-")) {
    return targetId === "add-root" ? null : targetId.slice(4);
  }

  return tasks.find((task) => task.id === targetId)?.parentId ?? null;
}

export function useLocalTasks(initialData: LocalTask[]) {
  // Sort by rank on initialization - array order IS display order
  const [tasks, setTasks] = useState<LocalTask[]>(() =>
    [...initialData].sort((a, b) => a.rank.localeCompare(b.rank))
  );

  // Element refs for focus management
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const registerInput = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const focusInput = useCallback((id: string, cursorPosition?: "start" | "end") => {
    // Use setTimeout to ensure the input is registered after render
    setTimeout(() => {
      const input = inputRefs.current.get(id);
      if (input) {
        input.focus();
        if (cursorPosition === "end") {
          input.setSelectionRange(input.value.length, input.value.length);
        } else if (cursorPosition === "start") {
          input.setSelectionRange(0, 0);
        }
      }
    }, 0);
  }, []);

  // Use a ref to access current tasks without adding dependency
  const tasksRef = useRef<LocalTask[]>(tasks);
  // Update ref in effect to avoid "Cannot access refs during render" error
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const getAdjacentId = useCallback((currentId: string, direction: "prev" | "next"): string | null => {
    // Use tasks array order (sorted by rank) - NOT inputRefs Map order
    // Map.keys() returns insertion order, which doesn't match display order with virtualization
    const ids = tasksRef.current.map((t) => t.id);
    const currentIndex = ids.indexOf(currentId);
    if (direction === "prev" && currentIndex > 0) {
      return ids[currentIndex - 1];
    }
    if (direction === "next" && currentIndex < ids.length - 1) {
      return ids[currentIndex + 1];
    }
    return null;
  }, []);

  // CRUD operations (all useCallback for stable references in meta)
  const updateTask = useCallback((id: string, updates: Partial<LocalTask>) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, ...updates } : task))
    );
  }, []);

  const addTask = useCallback(async (task: LocalTask, position?: { afterId?: string; beforeId?: string; parentId?: string }): Promise<string | null> => {
    let newId = task.id;
    setTasks((prev) => {
      const parentId = position?.parentId ?? task.parentId ?? null;
      const siblings = getLocalChildren(parentId, prev);
      const insertIndex = resolveInsertIndex(
        siblings.map((taskItem) => taskItem.id),
        position
      );

      // Calculate rank based on neighbors
      const prevRank = siblings[insertIndex - 1]?.rank;
      const nextRank = siblings[insertIndex]?.rank;
      const newRank = calculateRankBetween(prevRank, nextRank);

      const newTask = { ...task, parentId, rank: newRank };
      newId = newTask.id;
      return [...prev, newTask];
    });
    return newId;
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const reorderTasks = useCallback((
    sourceId: string,
    targetId: string | null,
    parentId?: string | null,
    position: ReorderPosition = "before"
  ) => {
    setTasks((items) => {
      if (sourceId === targetId) {
        return items;
      }

      const sourceTask = items.find((task) => task.id === sourceId);
      if (!sourceTask) {
        return items;
      }

      const effectiveParentId =
        targetId === null
          ? (parentId ?? sourceTask.parentId)
          : getEffectiveParentId(items, targetId, parentId);
      const siblings = getLocalChildren(effectiveParentId, items).filter(
        (task) => task.id !== sourceId
      );

      let insertIndex = siblings.length;
      if (targetId !== null && !targetId.startsWith("add-")) {
        const targetIndex = siblings.findIndex((task) => task.id === targetId);
        if (targetIndex === -1) {
          return items;
        }
        insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
      }

      const prevRank = siblings[insertIndex - 1]?.rank;
      const nextRank = siblings[insertIndex]?.rank;
      const newRank = calculateRankBetween(prevRank, nextRank);

      return items.map((task) =>
        task.id === sourceId
          ? { ...task, parentId: effectiveParentId, rank: newRank }
          : task
      );
    });
  }, []);

  const reorderMultiple = useCallback((
    ids: string[],
    targetId: string,
    parentId?: string | null,
    position: ReorderPosition = "before"
  ) => {
    setTasks((items) => {
      if (!targetId.startsWith("add-") && ids.includes(targetId)) {
        return items;
      }

      const effectiveParentId = getEffectiveParentId(items, targetId, parentId);
      const remainingSiblings = getLocalChildren(effectiveParentId, items).filter(
        (task) => !ids.includes(task.id)
      );
      const selected = items.filter((task) => ids.includes(task.id));
      if (selected.length === 0) {
        return items;
      }

      let insertIndex = remainingSiblings.length;
      if (!targetId.startsWith("add-")) {
        const targetIndex = remainingSiblings.findIndex((task) => task.id === targetId);
        if (targetIndex === -1) {
          return items;
        }
        insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
      }

      const result = [
        ...remainingSiblings.slice(0, insertIndex),
        ...selected.map((task) => ({ ...task, parentId: effectiveParentId })),
        ...remainingSiblings.slice(insertIndex),
      ];

      const startIdx = insertIndex;
      const endIdx = insertIndex + selected.length;
      const updated = new Map<string, LocalTask>();
      for (let i = startIdx; i < endIdx; i++) {
        const prevRank = result[i - 1]?.rank;
        const nextRank = result[endIdx]?.rank;
        const rankedTask = {
          ...result[i],
          parentId: effectiveParentId,
          rank: calculateRankBetween(prevRank, nextRank),
        };
        result[i] = rankedTask;
        updated.set(rankedTask.id, rankedTask);
      }

      return items.map((task) => updated.get(task.id) ?? task);
    });
  }, []);

  const setParent = useCallback((id: string, parentId: string | null, rank?: string) => {
    setTasks((items) => {
      const sourceTask = items.find((task) => task.id === id);
      if (!sourceTask) {
        return items;
      }

      let newRank = rank;
      if (!newRank) {
        const siblings = getLocalChildren(parentId, items).filter(
          (task) => task.id !== id
        );
        const lastRank = siblings[siblings.length - 1]?.rank;
        newRank = calculateRankBetween(lastRank, undefined);
      }

      return items.map((task) =>
        task.id === id ? { ...task, parentId, rank: newRank } : task
      );
    });
  }, []);

  const setParentMultiple = useCallback((ids: string[], parentId: string | null) => {
    setTasks((items) => {
      const siblings = getLocalChildren(parentId, items).filter(
        (task) => !ids.includes(task.id)
      );
      let prevRank = siblings[siblings.length - 1]?.rank;
      const updates = new Map<string, LocalTask>();

      for (const id of ids) {
        const task = items.find((item) => item.id === id);
        if (!task) {
          continue;
        }

        const rank = calculateRankBetween(prevRank, undefined);
        updates.set(id, { ...task, parentId, rank });
        prevRank = rank;
      }

      return items.map((task) => updates.get(task.id) ?? task);
    });
  }, []);

  // Bulk operations
  const bulkUpdateStatus = useCallback((ids: string[], status: LocalTask["status"]) => {
    setTasks((prev) =>
      prev.map((task) => (ids.includes(task.id) ? { ...task, status } : task))
    );
  }, []);

  const bulkDelete = useCallback((ids: string[]) => {
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
  }, []);

  return {
    tasks,
    setTasks,
    isLoading: false,
    // CRUD
    updateTask,
    addTask,
    deleteTask,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
    bulkUpdateStatus,
    bulkDelete,
    // Element refs
    inputRefs,
    rowRefs,
    registerInput,
    registerRow,
    focusInput,
    getAdjacentId,
  };
}
