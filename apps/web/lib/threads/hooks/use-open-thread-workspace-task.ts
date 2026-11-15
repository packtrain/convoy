"use client";

import { useCallback } from "react";
import type { ArchiveFilter } from "@/lib/tasks/types";

export interface ThreadWorkspaceTaskTarget {
  refId: string;
  isArchived?: boolean;
}

type SetThreadWorkspaceTask = (
  taskRefId: string | null,
  archiveFilter?: ArchiveFilter,
  options?: { history?: "push" | "replace" }
) => void;

export function getThreadWorkspaceArchiveFilter(
  isArchived: boolean
): ArchiveFilter {
  return isArchived ? "archived" : "active";
}

export function openThreadWorkspaceTask(
  setTask: SetThreadWorkspaceTask,
  task: ThreadWorkspaceTaskTarget
) {
  setTask(
    task.refId,
    getThreadWorkspaceArchiveFilter(task.isArchived === true)
  );
}

export function useOpenThreadWorkspaceTask(setTask: SetThreadWorkspaceTask) {
  return useCallback(
    (task: ThreadWorkspaceTaskTarget) => {
      openThreadWorkspaceTask(setTask, task);
    },
    [setTask]
  );
}
