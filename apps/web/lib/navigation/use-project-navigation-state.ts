"use client";

import { useCallback, useMemo } from "react";
import type { StatusFilterKey, AssigneeFilter, ArchiveFilter } from "@/lib/tasks/types";
import { BACKLOG_LIST_REF } from "@/lib/task-lists/system-lists";
import {
  DEFAULT_BOARD_GROUP_BY,
  buildProjectRouteTarget,
  isBoardViewCompatible,
  normalizeProjectParams,
  parseProjectParams,
  resolveProjectViewPaths,
  updateProjectParams,
  withProjectArtifact,
  withProjectTask,
  withProjectTaskAndArchive,
  withProjectTaskArtifact,
  type BoardGroupBy,
  type BoardRowGroupBy,
  type ListGroupBy,
  type ProjectQueryParams,
  type ProjectViewMode,
  type ResolvedDefaultView,
} from "./project-state";
import { useNavigation } from "./core";
import { href, type RouteTarget } from "./target";

interface ProjectNavigationState {
  pathname: string;
  listPath: string;
  boardPath: string;
  params: ProjectQueryParams;
  viewMode: ProjectViewMode;
  isBoardViewAvailable: boolean;
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  archiveFilter: ArchiveFilter;
  selectedListRef: string | null;
  boardGroupBy: BoardGroupBy;
  boardRowGroupBy: BoardRowGroupBy;
  setBoardRowGroupBy: (groupBy: BoardRowGroupBy) => void;
  listGroupBy: ListGroupBy;
  setListGroupBy: (groupBy: ListGroupBy) => void;
  taskRefId: string | null;
  artifactId: string | null;
  openTask: (taskRefId: string | null) => void;
  selectArtifact: (artifactId: string | null) => void;
  selectTaskArtifact: (
    taskRefId: string | null,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter
  ) => void;
  openTaskWithArchive: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => void;
  setStatusFilter: (filter: StatusFilterKey) => void;
  setAssigneeFilter: (filter: AssigneeFilter) => void;
  setArchiveFilter: (filter: ArchiveFilter) => void;
  setSelectedListRef: (
    listRef: string | null,
    defaultView?: ResolvedDefaultView
  ) => void;
  setBoardGroupBy: (groupBy: BoardGroupBy) => void;
  setViewMode: (view: ProjectViewMode) => void;
  normalizedListTarget: () => RouteTarget;
  /** Pass the resolved default to fill a view that has no grouping in the URL. */
  listViewTarget: (defaultView?: ResolvedDefaultView) => RouteTarget;
  boardViewTarget: (defaultView?: ResolvedDefaultView) => RouteTarget;
  boardPreferredTarget: () => RouteTarget;
  taskTarget: (taskRefId: string | null) => RouteTarget;
  taskInBoardTarget: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => RouteTarget;
  taskWithArchiveTarget: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => RouteTarget;
  taskArtifactTarget: (
    taskRefId: string | null,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter
  ) => RouteTarget;
  boardGroupByTarget: (groupBy: BoardGroupBy) => RouteTarget;
  taskHref: (taskRefId: string | null) => string;
  taskWithArchiveHref: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => string;
  taskInBoardHref: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => string;
  selectedListHref: (
    listRef: string | null,
    defaultView?: ResolvedDefaultView
  ) => string;
  boardGroupByHref: (groupBy: BoardGroupBy) => string;
  backlogHref: () => string;
  archivedHref: () => string;
  openTaskInBoard: (
    taskRefId: string | null,
    archiveFilter: ArchiveFilter,
    listRef?: string | null
  ) => void;
}

export function useProjectNavigationState(): ProjectNavigationState {
  const navigation = useNavigation();
  const pathname = navigation.location.pathname;
  const currentParams = useMemo(
    () => new URLSearchParams(navigation.location.search),
    [navigation.location.search]
  );
  const params = useMemo(() => parseProjectParams(currentParams), [currentParams]);
  const { listPath, boardPath, currentView } = useMemo(
    () => resolveProjectViewPaths(pathname),
    [pathname]
  );

  const statusFilter: StatusFilterKey = params.filter ?? "all";
  const assigneeFilter: AssigneeFilter = params.assignee ?? null;
  const archiveFilter: ArchiveFilter = params.archived ? "archived" : "active";
  const selectedListRef = params.list ?? null;
  const boardGroupBy: BoardGroupBy = params.groupBy ?? DEFAULT_BOARD_GROUP_BY;
  // Normalization already dropped rows equal to the columns.
  const boardRowGroupBy: BoardRowGroupBy =
    normalizeProjectParams(params).rowGroupBy ?? "none";
  const taskRefId = params.task ?? null;
  const artifactId = params.artifact ?? null;
  const isBoardViewAvailable = isBoardViewCompatible(archiveFilter);
  const boardPreference = currentView === "board" || params.view === "board";

  // Both views' grouping stays in the URL; a view without one gets its default.
  const viewSwitchParams = useCallback(
    (updates: Partial<ProjectQueryParams>) =>
      updateProjectParams(params, { task: null, artifact: null, view: null, ...updates }),
    [params]
  );

  // `defaultView`, when supplied, wins over the on-screen view preference —
  // that is how a List switch applies the target List's own default view
  // (OS-1566). Omit it and the current view is preserved, which every other
  // caller (filters, archive toggle, Backlog/Archived) relies on.
  const autoViewTarget = useCallback(
    (
      updates: Partial<ProjectQueryParams>,
      defaultView?: ResolvedDefaultView
    ) => {
      const nextArchiveFilter: ArchiveFilter =
        updates.archived === true || (updates.archived === undefined && params.archived)
          ? "archived"
          : "active";
      const nextCanUseBoard = isBoardViewCompatible(nextArchiveFilter);
      const useBoard = defaultView
        ? defaultView.viewMode === "board"
        : boardPreference;
      const showBoard = nextCanUseBoard && useBoard;
      const nextParams = updateProjectParams(params, {
        ...updates,
        view: null,
        ...(defaultView && {
          listGroupBy: defaultView.listGroupBy === "none" ? null : defaultView.listGroupBy,
          // Keep URLs clean: a missing groupBy already normalizes to status.
          groupBy:
            showBoard && defaultView.boardGroupBy !== DEFAULT_BOARD_GROUP_BY
              ? defaultView.boardGroupBy
              : null,
          rowGroupBy: showBoard && defaultView.boardRowGroupBy !== "none" ? defaultView.boardRowGroupBy : null,
        }),
      });

      if (showBoard) {
        return buildProjectRouteTarget(boardPath, nextParams);
      }

      return buildProjectRouteTarget(listPath, nextParams);
    },
    [boardPath, boardPreference, listPath, params]
  );

  const listViewTarget = useCallback(
    (defaultView?: ResolvedDefaultView) =>
      buildProjectRouteTarget(listPath, viewSwitchParams(
        defaultView && !params.listGroupBy && defaultView.listGroupBy !== "none"
          ? { listGroupBy: defaultView.listGroupBy }
          : {}
      )),
    [listPath, params.listGroupBy, viewSwitchParams]
  );

  const normalizedListTarget = useCallback(
    () =>
      buildProjectRouteTarget(
        listPath,
        normalizeProjectParams({ ...params, groupBy: null, rowGroupBy: null, view: null })
      ),
    [listPath, params]
  );

  const boardViewTarget = useCallback(
    (defaultView?: ResolvedDefaultView) =>
      buildProjectRouteTarget(boardPath, viewSwitchParams(
        defaultView && !params.groupBy && !params.rowGroupBy
          ? {
            groupBy: defaultView.boardGroupBy === DEFAULT_BOARD_GROUP_BY ? null : defaultView.boardGroupBy,
            rowGroupBy: defaultView.boardRowGroupBy === "none" ? null : defaultView.boardRowGroupBy,
          }
          : {}
      )),
    [boardPath, params.groupBy, params.rowGroupBy, viewSwitchParams]
  );

  const boardPreferredTarget = useCallback(
    () => buildProjectRouteTarget(listPath, updateProjectParams(params, { view: "board" })),
    [listPath, params]
  );

  const taskTarget = useCallback(
    (refId: string | null) => withProjectTask(pathname, params, refId),
    [params, pathname]
  );

  const taskInBoardTarget = useCallback(
    (
      refId: string | null,
      nextArchiveFilter: ArchiveFilter,
      listRef?: string | null
    ) =>
      buildProjectRouteTarget(
        listPath,
        updateProjectParams(
          params,
          {
            task: refId,
            archived: nextArchiveFilter === "archived",
            view: nextArchiveFilter === "active" ? "board" : null,
            ...(listRef !== undefined && { list: listRef }),
          }
        )
      ),
    [listPath, params]
  );

  const taskWithArchiveTarget = useCallback(
    (
      refId: string | null,
      nextArchiveFilter: ArchiveFilter,
      listRef?: string | null
    ) =>
      withProjectTaskAndArchive(
        pathname,
        params,
        refId,
        nextArchiveFilter === "archived",
        listRef
      ),
    [params, pathname]
  );

  const artifactTarget = useCallback(
    (selectedArtifactId: string | null) =>
      withProjectArtifact(pathname, params, selectedArtifactId),
    [params, pathname]
  );

  const taskArtifactTarget = useCallback(
    (
      refId: string | null,
      selectedArtifactId: string | null,
      nextArchiveFilter?: ArchiveFilter
    ) =>
      withProjectTaskArtifact(
        pathname,
        params,
        refId,
        selectedArtifactId,
        nextArchiveFilter === undefined ? undefined : nextArchiveFilter === "archived"
      ),
    [params, pathname]
  );

  // Picking the other axis's dimension swaps the axes.
  const boardGroupByTarget = useCallback(
    (groupBy: BoardGroupBy) =>
      buildProjectRouteTarget(
        boardPath,
        updateProjectParams(params, {
          groupBy,
          ...(groupBy === boardRowGroupBy && { rowGroupBy: boardGroupBy }),
        })
      ),
    [boardGroupBy, boardPath, boardRowGroupBy, params]
  );
  const boardRowGroupByTarget = useCallback(
    (rowGroupBy: BoardRowGroupBy) =>
      buildProjectRouteTarget(
        boardPath,
        updateProjectParams(params, {
          rowGroupBy,
          ...(rowGroupBy === boardGroupBy &&
            boardRowGroupBy !== "none" && { groupBy: boardRowGroupBy }),
        })
      ),
    [boardGroupBy, boardPath, boardRowGroupBy, params]
  );

  const selectedListTarget = useCallback(
    (listRef: string | null, defaultView?: ResolvedDefaultView) =>
      autoViewTarget(
        {
          task: null,
          artifact: null,
          list: listRef,
          archived: false,
        },
        defaultView
      ),
    [autoViewTarget]
  );

  const backlogTarget = useCallback(
    () =>
      autoViewTarget({
        task: null,
        artifact: null,
        list: BACKLOG_LIST_REF,
        archived: false,
      }),
    [autoViewTarget]
  );

  const archivedTarget = useCallback(
    () =>
      autoViewTarget({
        task: null,
        artifact: null,
        list: null,
        archived: true,
      }),
    [autoViewTarget]
  );

  return {
    pathname,
    listPath,
    boardPath,
    params,
    viewMode: currentView,
    isBoardViewAvailable,
    statusFilter,
    assigneeFilter,
    archiveFilter,
    selectedListRef,
    boardGroupBy,
    boardRowGroupBy,
    setBoardRowGroupBy: (rowGroupBy) => navigation.push(boardRowGroupByTarget(rowGroupBy)),
    listGroupBy: params.listGroupBy ?? "none",
    setListGroupBy: (listGroupBy) => navigation.push(buildProjectRouteTarget(listPath, updateProjectParams(params, { listGroupBy }))),
    taskRefId,
    artifactId,
    openTask: (refId) => navigation.push(taskTarget(refId)),
    selectArtifact: (selectedArtifactId) =>
      navigation.push(artifactTarget(selectedArtifactId)),
    selectTaskArtifact: (refId, selectedArtifactId, nextArchiveFilter) =>
      navigation.push(
        taskArtifactTarget(refId, selectedArtifactId, nextArchiveFilter)
      ),
    openTaskWithArchive: (refId, nextArchiveFilter, listRef) =>
      navigation.push(taskWithArchiveTarget(refId, nextArchiveFilter, listRef)),
    setStatusFilter: (filter) => navigation.push(autoViewTarget({ filter })),
    setAssigneeFilter: (filter) => navigation.push(autoViewTarget({ assignee: filter })),
    setArchiveFilter: (filter) =>
      navigation.push(autoViewTarget({ archived: filter === "archived" })),
    setSelectedListRef: (listRef, defaultView) =>
      navigation.push(selectedListTarget(listRef, defaultView)),
    setBoardGroupBy: (groupBy) => navigation.push(boardGroupByTarget(groupBy)),
    setViewMode: (view) =>
      navigation.push(view === "board" ? boardViewTarget() : listViewTarget()),
    normalizedListTarget,
    listViewTarget,
    boardViewTarget,
    boardPreferredTarget,
    taskTarget,
    taskInBoardTarget,
    taskWithArchiveTarget,
    taskArtifactTarget,
    boardGroupByTarget,
    taskHref: (refId) => href(taskTarget(refId)),
    taskWithArchiveHref: (refId, nextArchiveFilter, listRef) =>
      href(taskWithArchiveTarget(refId, nextArchiveFilter, listRef)),
    taskInBoardHref: (refId, nextArchiveFilter, listRef) =>
      href(taskInBoardTarget(refId, nextArchiveFilter, listRef)),
    selectedListHref: (listRef, defaultView) =>
      href(selectedListTarget(listRef, defaultView)),
    boardGroupByHref: (groupBy) => href(boardGroupByTarget(groupBy)),
    backlogHref: () => href(backlogTarget()),
    archivedHref: () => href(archivedTarget()),
    openTaskInBoard: (refId, nextArchiveFilter, listRef) =>
      navigation.push(taskInBoardTarget(refId, nextArchiveFilter, listRef)),
  };
}
