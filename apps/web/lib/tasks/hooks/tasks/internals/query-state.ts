import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useLastResolvedValue } from "@/hooks/react/use-last-resolved-value";
import type { ArchiveFilter, StatusFilterKey } from "@/lib/tasks/types";

export type TaskListQueryArgs = {
  projectId: Id<"projects">;
  archiveFilter: ArchiveFilter;
  listRef?: string;
};

export type ListedTask = NonNullable<FunctionReturnType<typeof api.tasks.core.listByProject>>[number];

export function normalizeSelectedListRef(selectedListRef: string | null): string | null {
  return selectedListRef?.trim().toUpperCase() || null;
}

export function buildTaskListQueryArgs({
  projectId,
  archiveFilter,
  normalizedSelectedListRef,
}: {
  projectId: Id<"projects"> | undefined;
  archiveFilter: ArchiveFilter;
  normalizedSelectedListRef: string | null;
}): TaskListQueryArgs | null {
  if (!projectId) return null;

  return {
    projectId,
    archiveFilter,
    listRef: normalizedSelectedListRef ?? undefined,
  };
}

export function useTaskListQueryState({
  projectId,
  archiveFilter,
  statusFilter,
  selectedListRef,
}: {
  projectId: Id<"projects"> | undefined;
  archiveFilter: ArchiveFilter;
  statusFilter: StatusFilterKey;
  selectedListRef: string | null;
}) {
  const normalizedSelectedListRef = useMemo(() => normalizeSelectedListRef(selectedListRef), [selectedListRef]);
  const listByProjectArgs = useMemo(
    () =>
      buildTaskListQueryArgs({
        projectId,
        archiveFilter,
        normalizedSelectedListRef,
      }),
    [archiveFilter, normalizedSelectedListRef, projectId]
  );

  const queriedTasksData = useQuery(api.tasks.core.listByProject, listByProjectArgs ?? "skip");
  const tasksData = useLastResolvedValue({
    cacheKey: projectId ? `tasks:${projectId}:${archiveFilter}:${statusFilter}:${normalizedSelectedListRef ?? ""}` : null,
    fallbackCacheKey: projectId ? `tasks:${projectId}:${archiveFilter}:${statusFilter}:last` : null,
    enabled: Boolean(projectId),
    value: queriedTasksData,
  });

  return {
    normalizedSelectedListRef,
    listByProjectArgs,
    queriedTasksData,
    tasksData,
    isLoading: queriedTasksData === undefined,
  };
}
