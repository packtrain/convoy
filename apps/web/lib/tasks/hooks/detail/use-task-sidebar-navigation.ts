"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useLastResolvedRouteValue } from "@/lib/routing/use-last-resolved-route-value";
import type { Task } from "@/lib/tasks/types";

interface UseTaskSidebarNavigationOptions {
  taskList: Task[];
  taskRefId: string | null;
  setTaskRefId: (taskRefId: string | null) => void;
  projectId?: Id<"projects">;
  isAuthenticated?: boolean;
}

interface UseTaskSidebarNavigationReturn {
  detailsTask: Task | undefined;
  isSidebarOpen: boolean;
  openTaskSidebar: (clientId: string) => void;
  closeTaskSidebar: () => void;
}

const TASK_REF_ID_PATTERN = /^[A-Z][A-Z0-9]{1,4}-\d+$/;

function normalizeReadyTaskRefId(refId: string | null | undefined): string | null {
  if (typeof refId !== "string") {
    return null;
  }

  const normalizedRefId = refId.trim().toUpperCase();
  return TASK_REF_ID_PATTERN.test(normalizedRefId) ? normalizedRefId : null;
}

export function useTaskSidebarNavigation({
  taskList,
  taskRefId,
  setTaskRefId,
  projectId,
  isAuthenticated = false,
}: UseTaskSidebarNavigationOptions): UseTaskSidebarNavigationReturn {
  const [optimisticTaskRefId, setOptimisticTaskRefId] = useState<string | null>(null);

  const taskByRefId = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of taskList) {
      const refId = normalizeReadyTaskRefId(task.refId);
      if (refId) {
        map.set(refId, task);
      }
    }
    return map;
  }, [taskList]);

  const taskRefByClientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of taskList) {
      const refId = normalizeReadyTaskRefId(task.refId);
      if (refId) {
        map.set(task.clientId, refId);
      }
    }
    return map;
  }, [taskList]);
  const taskRefByClientIdRef = useRef(taskRefByClientId);
  const setTaskRefIdRef = useRef(setTaskRefId);

  // Memoized row surfaces can keep an old opener; keep it pointed at the latest
  // committed client-id lookup and URL setter.
  useLayoutEffect(() => {
    taskRefByClientIdRef.current = taskRefByClientId;
    setTaskRefIdRef.current = setTaskRefId;
  }, [setTaskRefId, taskRefByClientId]);

  const effectiveTaskRefId =
    normalizeReadyTaskRefId(taskRefId) ?? optimisticTaskRefId;
  const tableDetailsTask = effectiveTaskRefId
    ? taskByRefId.get(effectiveTaskRefId)
    : undefined;
  const selectedTaskLookup = useQuery(
    api.tasks.core.getByRefs,
    isAuthenticated && projectId && effectiveTaskRefId && !tableDetailsTask
      ? { projectId, refs: [effectiveTaskRefId] }
      : "skip"
  );
  const selectedTask = selectedTaskLookup?.results[0]?.task ?? null;
  const selectedTaskMissing =
    !tableDetailsTask &&
    selectedTaskLookup !== undefined &&
    selectedTask === null;
  const detailsTask = useLastResolvedRouteValue<Task | null>({
    cacheKey: effectiveTaskRefId
      ? `task-details:${projectId}:${effectiveTaskRefId}`
      : null,
    enabled: Boolean(effectiveTaskRefId),
    value:
      tableDetailsTask ??
      selectedTask ??
      (selectedTaskMissing ? null : undefined),
  }) ?? undefined;
  const isSidebarOpen = Boolean(detailsTask);

  useEffect(() => {
    if (!optimisticTaskRefId) {
      return;
    }

    if (taskRefId === optimisticTaskRefId) {
      // Defer clearing by one task to avoid dropping the optimistic ref
      // in the same commit where URL state catches up.
      const clearTaskId = window.setTimeout(() => {
        setOptimisticTaskRefId(null);
      }, 0);
      return () => {
        window.clearTimeout(clearTaskId);
      };
    }
  }, [optimisticTaskRefId, taskRefId]);

  const openTaskSidebar = useCallback(
    (clientId: string) => {
      const taskRefMap = taskRefByClientIdRef.current;
      const refId = taskRefMap.get(clientId);

      if (!refId) {
        return;
      }

      setOptimisticTaskRefId(refId);
      setTaskRefIdRef.current(refId);
    },
    []
  );

  const closeTaskSidebar = useCallback(() => {
    setOptimisticTaskRefId(null);
    setTaskRefIdRef.current(null);
  }, []);

  return {
    detailsTask,
    isSidebarOpen,
    openTaskSidebar,
    closeTaskSidebar,
  };
}
