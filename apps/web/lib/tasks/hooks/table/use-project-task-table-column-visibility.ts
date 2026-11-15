"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useOptionalCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import {
  getHiddenTaskTableColumns,
  normalizeHiddenTaskTableColumns,
  type TaskTableColumnId,
} from "@/lib/tasks/task-table-columns";

type UseProjectTaskTableColumnVisibilityOptions = {
  projectId?: Id<"projects"> | null;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[] | null;
  canEdit: boolean;
};

function areHiddenColumnsEqual(
  left: readonly TaskTableColumnId[],
  right: readonly TaskTableColumnId[]
): boolean {
  return (
    left.length === right.length &&
    left.every((columnId, index) => columnId === right[index])
  );
}

export function useProjectTaskTableColumnVisibility({
  projectId,
  hiddenTaskTableColumns,
  canEdit,
}: UseProjectTaskTableColumnVisibilityOptions) {
  const currentRoute = useOptionalCurrentOrgProject();
  const routeOrganizationId = currentRoute?.organizationId ?? null;
  const routeProjectAlias = currentRoute?.projectAlias ?? null;
  const updateProject = useMutation(
    api.projects.core.update
  ).withOptimisticUpdate((localStore, args) => {
    if (args.hiddenTaskTableColumns === undefined) {
      return;
    }

    const nextHiddenColumns = normalizeHiddenTaskTableColumns(
      args.hiddenTaskTableColumns
    );
    const currentById = localStore.getQuery(api.projects.core.getById, {
      id: args.id,
    });

    if (currentById) {
      localStore.setQuery(api.projects.core.getById, { id: args.id }, {
        ...currentById,
        hiddenTaskTableColumns: nextHiddenColumns,
      });
    }

    if (!routeOrganizationId || !routeProjectAlias) {
      return;
    }

    const getByAliasArgs = {
      organizationId: routeOrganizationId,
      alias: routeProjectAlias,
    };
    const currentByAlias = localStore.getQuery(
      api.projects.core.getByAlias,
      getByAliasArgs
    );

    if (!currentByAlias || currentByAlias._id !== args.id) {
      return;
    }

    localStore.setQuery(api.projects.core.getByAlias, getByAliasArgs, {
      ...currentByAlias,
      hiddenTaskTableColumns: nextHiddenColumns,
    });
  });
  const normalizedHiddenColumns = useMemo(
    () => getHiddenTaskTableColumns(hiddenTaskTableColumns),
    [hiddenTaskTableColumns]
  );
  const latestHiddenColumnsRef = useRef<TaskTableColumnId[]>(
    normalizedHiddenColumns
  );
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    if (
      areHiddenColumnsEqual(
        latestHiddenColumnsRef.current,
        normalizedHiddenColumns
      )
    ) {
      return;
    }

    latestHiddenColumnsRef.current = normalizedHiddenColumns;
  }, [normalizedHiddenColumns]);

  const hiddenColumnSet = useMemo(
    () => new Set(normalizedHiddenColumns),
    [normalizedHiddenColumns]
  );

  const isColumnVisible = useCallback(
    (columnId: TaskTableColumnId) => !hiddenColumnSet.has(columnId),
    [hiddenColumnSet]
  );

  const toggleColumnVisibility = useCallback(
    async (columnId: TaskTableColumnId) => {
      if (!projectId || !canEdit) {
        return;
      }

      const previousHiddenColumns = latestHiddenColumnsRef.current;
      const nextHiddenSet = new Set(previousHiddenColumns);
      if (nextHiddenSet.has(columnId)) {
        nextHiddenSet.delete(columnId);
      } else {
        nextHiddenSet.add(columnId);
      }
      const nextHiddenColumns = normalizeHiddenTaskTableColumns([
        ...nextHiddenSet,
      ]);
      const requestId = latestRequestIdRef.current + 1;

      latestRequestIdRef.current = requestId;
      latestHiddenColumnsRef.current = nextHiddenColumns;

      try {
        await updateProject({
          id: projectId,
          hiddenTaskTableColumns: nextHiddenColumns,
        });
      } catch {
        if (requestId === latestRequestIdRef.current) {
          latestHiddenColumnsRef.current = normalizedHiddenColumns;
        }
        toast.error("Failed to update column visibility");
      }
    },
    [
      canEdit,
      normalizedHiddenColumns,
      projectId,
      updateProject,
    ]
  );

  return {
    isColumnVisible,
    toggleColumnVisibility,
    canToggleColumns: Boolean(projectId) && canEdit,
  };
}
