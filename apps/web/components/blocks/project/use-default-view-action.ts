"use client";

import type { BoardRowGroupBy, ListGroupBy } from "@/lib/navigation";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_BOARD_GROUP_BY,
  type BoardGroupBy,
  type ProjectViewMode,
} from "@/lib/navigation";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import type { TaskListItem } from "./task-lists/task-list-types";

/**
 * "Set the current view as the default" actions shared by the desktop settings
 * dropdown and the mobile toolbar panel. Two scopes: the project-wide default
 * (needs `project:update`) and the currently viewed List's override
 * (`list:manage`, OS-1566).
 */
export function useDefaultViewAction({
  projectId,
  currentViewMode,
  currentBoardGroupBy,
  defaultViewMode,
  defaultBoardGroupBy,
  currentListGroupBy = "none",
  defaultListGroupBy,
  currentBoardRowGroupBy = "none",
  defaultBoardRowGroupBy,
  viewedList = null,
}: {
  projectId?: Id<"projects">;
  currentViewMode: ProjectViewMode;
  currentBoardGroupBy: BoardGroupBy;
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  currentListGroupBy?: ListGroupBy;
  defaultListGroupBy?: ListGroupBy;
  currentBoardRowGroupBy?: BoardRowGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
  /** The List the current view belongs to, or null (Backlog/Archived). */
  viewedList?: TaskListItem | null;
}) {
  const { canEditProject, canManageLists } = useProjectPermissions(
    projectId ?? null
  );
  const updateProject = useMutation(api.projects.core.update);
  const updateList = useMutation(api.tasks.lists.update);

  const matchesCurrentView = (
    mode: ProjectViewMode,
    groupBy: BoardGroupBy | undefined,
    listGroupBy?: ListGroupBy,
    rowGroupBy?: BoardRowGroupBy
  ) =>
    currentViewMode === mode &&
    (mode === "list" ? (listGroupBy ?? "none") === currentListGroupBy :
      (groupBy ?? DEFAULT_BOARD_GROUP_BY) === currentBoardGroupBy &&
      (rowGroupBy ?? "none") === currentBoardRowGroupBy);

  const isCurrentViewProjectDefault = matchesCurrentView(
    defaultViewMode ?? "list",
    defaultBoardGroupBy,
    defaultListGroupBy,
    defaultBoardRowGroupBy
  );
  const hasListOverride = viewedList?.defaultViewMode != null;
  const isCurrentViewListDefault =
    hasListOverride &&
    matchesCurrentView(
      viewedList?.defaultViewMode ?? "list",
      viewedList?.defaultBoardGroupBy,
      viewedList?.defaultListGroupBy,
      viewedList?.defaultBoardRowGroupBy
    );

  const setCurrentViewAsProjectDefault = useCallback(async () => {
    if (!projectId) {
      return;
    }

    try {
      await updateProject({
        id: projectId,
        defaultViewMode: currentViewMode,
        ...(currentViewMode === "board"
          ? { defaultBoardGroupBy: currentBoardGroupBy, defaultBoardRowGroupBy: currentBoardRowGroupBy }
          : { defaultListGroupBy: currentListGroupBy }),
      });
      toast.success("Default view updated");
    } catch {
      toast.error("Failed to update default view");
    }
  }, [currentListGroupBy, currentBoardGroupBy, currentBoardRowGroupBy, currentViewMode, projectId, updateProject]);

  const setCurrentViewAsListDefault = useCallback(async () => {
    if (!viewedList) {
      return;
    }

    try {
      await updateList({
        id: viewedList._id,
        defaultViewMode: currentViewMode,
        ...(currentViewMode === "board"
          ? { defaultBoardGroupBy: currentBoardGroupBy, defaultBoardRowGroupBy: currentBoardRowGroupBy }
          : { defaultListGroupBy: currentListGroupBy }),
      });
      toast.success(`Default view updated for "${viewedList.name}"`);
    } catch {
      toast.error("Failed to update default view");
    }
  }, [currentListGroupBy, currentBoardGroupBy, currentBoardRowGroupBy, currentViewMode, viewedList, updateList]);

  const clearListDefaultView = useCallback(async () => {
    if (!viewedList) {
      return;
    }

    try {
      await updateList({
        id: viewedList._id,
        defaultViewMode: null,
      });
      toast.success(`"${viewedList.name}" now uses the project default view`);
    } catch {
      toast.error("Failed to reset default view");
    }
  }, [viewedList, updateList]);

  return {
    canSetProjectDefaultView: Boolean(projectId) && canEditProject,
    // The List rows need both a List to act on and its name for their labels,
    // so the hook owns the one condition instead of every toolbar re-deriving it.
    showListDefaultView: canManageLists && viewedList !== null,
    isCurrentViewProjectDefault,
    isCurrentViewListDefault,
    hasListOverride,
    viewedListName: viewedList?.name ?? "",
    setCurrentViewAsProjectDefault,
    setCurrentViewAsListDefault,
    clearListDefaultView,
  };
}
