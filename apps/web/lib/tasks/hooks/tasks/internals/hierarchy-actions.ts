import { useCallback, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { toastMutationRejection } from "@/lib/errors";
import { calculateRankBetween } from "@/lib/tasks/rank";
import type { Task } from "@/lib/tasks/types";
import { getChildren } from "@/lib/tasks/tree";
import type { TaskRankMutationHandles } from "./rank-mutations";

export function useTaskHierarchyActions({
  tasksRef,
  updateParentMutation,
}: {
  tasksRef: RefObject<Task[]>;
  updateParentMutation: TaskRankMutationHandles["updateParentMutation"];
}) {
  const setParent = useCallback(
    (id: string, newParentId: string | null, rank?: string) => {
      const currentTasks = tasksRef.current;

      let newRank = rank;
      if (!newRank) {
        const siblings = getChildren(newParentId, currentTasks).filter((t) => t._id !== id);
        const lastRank = siblings[siblings.length - 1]?.rank;
        newRank = calculateRankBetween(lastRank, undefined);
      }

      updateParentMutation({
        id: id as Id<"tasks">,
        parentId: newParentId ? (newParentId as Id<"tasks">) : null,
        rank: newRank,
      }).catch(toastMutationRejection);
    },
    [updateParentMutation, tasksRef]
  );

  const setParentMultiple = useCallback(
    (ids: string[], newParentId: string | null, afterTaskId?: string) => {
      const currentTasks = tasksRef.current;

      const existingSiblings = getChildren(newParentId, currentTasks)
        .filter((t) => !ids.includes(t._id as string))
        .sort((a, b) => a.rank.localeCompare(b.rank));

      let prevRank: string | undefined;
      let nextRank: string | undefined;

      if (afterTaskId) {
        const afterIndex = existingSiblings.findIndex((t) => t._id === afterTaskId);
        if (afterIndex !== -1) {
          prevRank = existingSiblings[afterIndex]?.rank;
          nextRank = existingSiblings[afterIndex + 1]?.rank;
        }
      }

      if (prevRank === undefined && !afterTaskId) {
        prevRank = existingSiblings[existingSiblings.length - 1]?.rank;
      }

      for (const id of ids) {
        const newRank = calculateRankBetween(prevRank, nextRank);
        updateParentMutation({
          id: id as Id<"tasks">,
          parentId: newParentId ? (newParentId as Id<"tasks">) : null,
          rank: newRank,
        }).catch(toastMutationRejection);
        prevRank = newRank;
      }
    },
    [updateParentMutation, tasksRef]
  );

  const hasChildren = useCallback(
    (id: string): boolean => {
      return tasksRef.current.some((t) => t.parentId === id);
    },
    [tasksRef]
  );

  const getChildCount = useCallback(
    (id: string): number => {
      return tasksRef.current.filter((t) => t.parentId === id).length;
    },
    [tasksRef]
  );

  return {
    setParent,
    setParentMultiple,
    hasChildren,
    getChildCount,
  };
}
