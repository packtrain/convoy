"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppAuth, useAppConvexAuth } from "@/lib/auth/hooks";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ProjectHeader } from "@/components/blocks/project/project-header";
import { ViewOnlyBadge } from "@/components/blocks/project/view-only-badge";
import { useSelectedTaskList } from "@/components/blocks/project/task-lists/use-selected-task-list";
import { useActiveTaskListResults } from "@/components/blocks/project/task-lists/use-task-list-results";
import { NoAccess } from "@/components/blocks/no-access";
import { TaskViewShellSkeleton } from "./task-view-skeleton";
import { MobileTaskViewsHeader } from "@/components/blocks/mobile/mobile-task-views-header";
import { ProjectTaskListDropdown } from "@/components/blocks/project/task-lists/project-task-list-dropdown";
import { MobileToolbarPanel } from "@/components/blocks/mobile/mobile-toolbar-panel";
import {
  useMobileNavBarHidden,
  useMobileNavBarPageConfig,
  type MobileNavPageConfig,
} from "@/components/blocks/mobile/mobile-nav-context";
import { useShowTaskListRank } from "@/lib/dev-mode/use-dev-mode";
import { useListDefaultViewNavigation } from "@/lib/task-lists/hooks/use-list-default-view";
import {
  appRoute,
  href,
  resolveDefaultView,
  useNavigation,
  useProjectNavigationState,
  useRouteParams,
} from "@/lib/navigation";
import { useLastResolvedRouteValue } from "@/lib/routing/use-last-resolved-route-value";
import { useTasks } from "@/lib/tasks/hooks/use-tasks";
import { AssignableTaskAssigneesProvider } from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { getAllowedTaskStatuses } from "@/lib/tasks/status-policy";
import { useTaskSections } from "@/lib/tasks/hooks/use-task-sections";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import type {
  TaskSearchHrefBuilder,
  TaskSearchSelectHandler,
} from "@/lib/tasks/task-selector";
import { ProjectTaskViewsProvider } from "./project-task-views-context";
import { useReadyAfterPaint } from "./use-ready-after-paint";

export function ProjectTaskViewsShell({ children }: { children: ReactNode }) {
  const params = useRouteParams<{ organizationSlug: string; projectAlias: string }>();
  const navigation = useNavigation();
  const { isLoaded, isSignedIn, userId } = useAppAuth();
  const { isLoading: convexAuthLoading, isAuthenticated } = useAppConvexAuth();
  const urlNavigationState = useProjectNavigationState();
  const {
    viewMode,
    isBoardViewAvailable,
    normalizedListTarget,
    listViewTarget,
    boardViewTarget,
    boardPreferredTarget,
    statusFilter,
    assigneeFilter,
    archiveFilter,
    selectedListRef,
    boardGroupBy,
    openTaskWithArchive,
    openTaskInBoard,
    taskWithArchiveHref,
    taskInBoardHref,
    selectedListHref,
    backlogHref,
    archivedHref,
    setStatusFilter,
    setAssigneeFilter,
    setArchiveFilter,
    setSelectedListRef,
    setBoardGroupBy,
  } = urlNavigationState;
  const showTaskRank = useShowTaskListRank();
  // Pages report their task detail surface state so shared mobile chrome can
  // hide behind the open surface.
  const [isDetailSurfaceOpen, setDetailSurfaceOpen] = useState(false);
  const headerAddTaskActionRef = useRef<(() => void) | null>(null);

  // Paint the skeleton for one frame on a fresh shell mount before mounting the heavy task-view
  // subtree. Navigating in from another route leaves `org`/`project` already warm, so the shell
  // would otherwise render the full table synchronously inside the navigation transition —
  // freezing the previous route on screen until it lands. Fresh mounts only: in-project
  // navigation reuses this shell instance, so filters and view toggles get no skeleton flash.
  const contentReady = useReadyAfterPaint();

  const queriedOrg = useQuery(
    api.organizations.core.getBySlug,
    isAuthenticated ? { slug: params.organizationSlug } : "skip"
  );
  const org = useLastResolvedRouteValue({
    cacheKey: userId ? `${userId}:${params.organizationSlug}` : null,
    enabled: Boolean(isSignedIn && userId),
    value: queriedOrg,
  });

  const queriedProject = useQuery(
    api.projects.core.getByAlias,
    isAuthenticated && org
      ? { organizationId: org._id, alias: params.projectAlias }
      : "skip"
  );
  const projectRouteCacheKey = userId
    ? `${userId}:${params.organizationSlug}/${params.projectAlias}`
    : null;
  const project = useLastResolvedRouteValue({
    cacheKey: projectRouteCacheKey,
    enabled: Boolean(isSignedIn && projectRouteCacheKey),
    value: queriedProject,
  });
  const convexUser = useQuery(api.users.core.current);
  const { canCreateTask, myRole } = useProjectPermissions(project?._id ?? null);
  const viewOnlyBadge = <ViewOnlyBadge role={myRole} />;
  const allowedStatuses = getAllowedTaskStatuses(project);
  const clearInvalidSelectedListRef = useCallback(() => {
    setSelectedListRef(null);
  }, [setSelectedListRef]);
  const selectedList = useSelectedTaskList({
    projectId: project?._id,
    selectedListRef,
    onInvalidListRef: clearInvalidSelectedListRef,
  });
  const taskListResultsController = useActiveTaskListResults(project?._id);
  // Selecting a List applies that List's own default view (OS-1566), falling
  // back to the project default. Resolved from the already-loaded active-List
  // set, so no extra query on the switch path.
  const { selectList, getListHref } = useListDefaultViewNavigation({
    project,
    results: taskListResultsController.results,
    setSelectedListRef,
    selectedListHref,
  });
  const defaultList =
    taskListResultsController.results.find(
      (list) => list._id === project?.defaultListId
    ) ?? null;
  const defaultListRef = defaultList?.ref ?? null;
  // The List whose view is on screen. With no `list` param that is the
  // project's default List; Backlog and Archived have no List row (OS-1566).
  const viewedList =
    archiveFilter === "archived"
      ? null
      : selectedListRef === null
        ? defaultList
        : (selectedList ?? null);
  const currentMoveSourceListRef = selectedListRef ?? defaultListRef;
  // With no `listGroupBy` in the URL, a List with sections groups by them (task-sections.md#grouping).
  const derivesListGrouping =
    viewMode === "list" && archiveFilter !== "archived" && !urlNavigationState.params.listGroupBy;
  const listSections = useTaskSections(
    derivesListGrouping ? project?._id : undefined,
    currentMoveSourceListRef
  );
  const isListGroupingLoading = derivesListGrouping && listSections.isLoading;
  const groupsBySection = derivesListGrouping && listSections.sections.length > 0;
  const navigationState = useMemo(
    () => (groupsBySection ? { ...urlNavigationState, listGroupBy: "section" as const } : urlNavigationState),
    [groupsBySection, urlNavigationState]
  );
  const currentUserId = convexUser?._id ? String(convexUser._id) : undefined;
  const activeTaskResult = useTasks(
    archiveFilter === "active" || viewMode === "board" ? project?._id : undefined,
    "active",
    statusFilter,
    selectedListRef
  );

  useEffect(() => {
    if (viewMode === "board" && !isBoardViewAvailable) {
      navigation.push(normalizedListTarget());
    }
  }, [isBoardViewAvailable, navigation, normalizedListTarget, viewMode]);

  const openMembersSettings = useCallback(() => {
    navigation.push(
      appRoute.projectSettings(
        params.organizationSlug,
        params.projectAlias,
        "members"
      )
    );
  }, [navigation, params.organizationSlug, params.projectAlias]);

  const openAiAgentsSettings = useCallback(() => {
    navigation.push(
      appRoute.projectSettings(
        params.organizationSlug,
        params.projectAlias,
        "agents"
      )
    );
  }, [navigation, params.organizationSlug, params.projectAlias]);

  const defaultHeaderAddTaskAction = useCallback(() => {
    navigation.push(boardPreferredTarget());
  }, [boardPreferredTarget, navigation]);

  const setHeaderAddTaskAction = useCallback((action: (() => void) | null) => {
    headerAddTaskActionRef.current = action;
  }, []);

  const handleAddTask = useCallback(() => {
    const headerAddTaskAction = headerAddTaskActionRef.current;
    if (headerAddTaskAction) {
      headerAddTaskAction();
      return;
    }

    defaultHeaderAddTaskAction();
  }, [defaultHeaderAddTaskAction]);

  const handleSearchTaskSelect = useCallback<TaskSearchSelectHandler>(
    (taskRefId, nextArchiveFilter, listRef) => {
      if (viewMode === "board") {
        openTaskInBoard(taskRefId, nextArchiveFilter, listRef);
        return;
      }

      openTaskWithArchive(taskRefId, nextArchiveFilter, listRef);
    },
    [openTaskInBoard, openTaskWithArchive, viewMode]
  );

  const getSearchTaskHref = useCallback<TaskSearchHrefBuilder>(
    (taskRefId, nextArchiveFilter, listRef) => {
      if (viewMode === "board") {
        return taskInBoardHref(taskRefId, nextArchiveFilter, listRef);
      }

      return taskWithArchiveHref(taskRefId, nextArchiveFilter, listRef);
    },
    [taskInBoardHref, taskWithArchiveHref, viewMode]
  );

  const projectLoadGateOpen =
    !isLoaded ||
    convexAuthLoading ||
    org === undefined ||
    (org !== null && project === undefined);

  // The global mobile nav bar hides behind open task detail surfaces and picks
  // up this page's view-aware search navigation + selected list for its fixed
  // Search and + slots.
  useMobileNavBarHidden(isDetailSurfaceOpen);
  // Registered configs must be identity-stable (see MobileNavPageConfig):
  // useProjectNavigationState returns fresh callbacks every render, so the
  // search handlers go through a latest-value ref and the config identity
  // depends only on primitives.
  const mobileNavSearchHandlersRef = useRef({
    onSelectTask: handleSearchTaskSelect,
    getTaskHref: getSearchTaskHref,
  });
  useEffect(() => {
    mobileNavSearchHandlersRef.current = {
      onSelectTask: handleSearchTaskSelect,
      getTaskHref: getSearchTaskHref,
    };
  });
  const hasResolvedProject = Boolean(org && project);
  const mobileNavPageConfig = useMemo<MobileNavPageConfig | null>(
    () =>
      hasResolvedProject
        ? {
            search: {
              onSelectTask: (taskRefId, archiveFilter, listRef) =>
                mobileNavSearchHandlersRef.current.onSelectTask(
                  taskRefId,
                  archiveFilter,
                  listRef
                ),
              getTaskHref: (taskRefId, archiveFilter, listRef) =>
                mobileNavSearchHandlersRef.current.getTaskHref(
                  taskRefId,
                  archiveFilter,
                  listRef
                ),
            },
            createTaskListRef: selectedListRef,
          }
        : null,
    [hasResolvedProject, selectedListRef]
  );
  useMobileNavBarPageConfig(mobileNavPageConfig);

  // Fills the List/Board switch links when the URL has no grouping for that view.
  const viewDefault = useMemo(() => resolveDefaultView(project, viewedList), [project, viewedList]);

  const contextValue = useMemo(
    () =>
      org && project
        ? {
            organizationSlug: params.organizationSlug,
            projectAlias: params.projectAlias,
            org,
            project,
            allowedStatuses,
            navigationState,
            selectedList: selectedList ?? null,
            taskListResultsController,
            activeTaskResult,
            currentMoveSourceListRef,
            currentUserId,
            isListGroupingLoading,
            showTaskRank,
            openMembersSettings,
            openAiAgentsSettings,
            setHeaderAddTaskAction,
            setDetailSurfaceOpen,
          }
        : null,
    [
      allowedStatuses,
      activeTaskResult,
      currentMoveSourceListRef,
      currentUserId,
      isListGroupingLoading,
      navigationState,
      openAiAgentsSettings,
      openMembersSettings,
      org,
      params.organizationSlug,
      params.projectAlias,
      project,
      selectedList,
      setHeaderAddTaskAction,
      showTaskRank,
      taskListResultsController,
    ]
  );

  if (projectLoadGateOpen || !contentReady) {
    return <TaskViewShellSkeleton viewMode={viewMode} />;
  }

  if (project === undefined || project === null || org === null) {
    return (
      <NoAccess
        organizationSlug={params.organizationSlug}
        message="You don't have access to this project."
      />
    );
  }

  return (
    <ProjectTaskViewsProvider value={contextValue!}>
      <AssignableTaskAssigneesProvider projectId={project._id}>
        <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
          <ProjectHeader
            projectName={project.name}
            badge={viewOnlyBadge}
            projectId={project._id}
            hiddenTaskTableColumns={project.hiddenTaskTableColumns}
            defaultListId={project.defaultListId ?? null}
            isBoardViewAvailable={isBoardViewAvailable}
            organizationSlug={params.organizationSlug}
            projectAlias={params.projectAlias}
            viewMode={viewMode}
            listPath={href(listViewTarget(viewDefault))}
            boardPath={href(boardViewTarget(viewDefault))}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            archiveFilter={archiveFilter}
            selectedListRef={selectedListRef}
            selectedList={selectedList ?? null}
            viewedList={viewedList}
            taskListResultsController={taskListResultsController}
            boardGroupBy={boardGroupBy}
            boardRowGroupBy={navigationState.boardRowGroupBy}
            onBoardRowGroupByChange={navigationState.setBoardRowGroupBy}
            defaultBoardRowGroupBy={project.defaultBoardRowGroupBy}
            listGroupBy={navigationState.listGroupBy}
            onListGroupByChange={navigationState.setListGroupBy}
            defaultListGroupBy={project.defaultListGroupBy}
            defaultViewMode={project.defaultViewMode}
            defaultBoardGroupBy={project.defaultBoardGroupBy}
            getListHref={getListHref}
            backlogHref={backlogHref()}
            archivedHref={archivedHref()}
            onStatusFilterChange={setStatusFilter}
            onAssigneeFilterChange={setAssigneeFilter}
            onArchiveFilterChange={setArchiveFilter}
            onSelectedListChange={selectList}
            onBoardGroupByChange={setBoardGroupBy}
            onSearchTaskSelect={handleSearchTaskSelect}
            getSearchTaskHref={getSearchTaskHref}
            onAddTask={canCreateTask ? handleAddTask : undefined}
            onMembersClick={openMembersSettings}
            onAiAgentsClick={openAiAgentsSettings}
          />

          {/* Mobile-only compact header: List selector plus the per-page tools
              (filters/view) that the global bottom nav bar no longer carries. */}
          <MobileTaskViewsHeader
            projectName={project.name}
            badge={viewOnlyBadge}
            listSelector={
              // Same selector component as the desktop header; it renders a
              // bottom sheet below the md breakpoint.
              <ProjectTaskListDropdown
                projectId={project._id}
                defaultListId={project.defaultListId ?? null}
                archiveFilter={archiveFilter}
                selectedListRef={selectedListRef}
                selectedList={selectedList ?? null}
                resultsController={taskListResultsController}
                getListHref={getListHref}
                backlogHref={backlogHref()}
                archivedHref={archivedHref()}
                onStatusFilterChange={setStatusFilter}
                onArchiveFilterChange={setArchiveFilter}
                onSelectedListChange={selectList}
              />
            }
            renderToolbar={({ onClose }) => (
              <MobileToolbarPanel
                projectId={project._id}
                organizationSlug={params.organizationSlug}
                projectAlias={params.projectAlias}
                statusFilter={statusFilter}
                assigneeFilter={assigneeFilter}
                archiveFilter={archiveFilter}
                onStatusFilterChange={setStatusFilter}
                onAssigneeFilterChange={setAssigneeFilter}
                onArchiveFilterChange={setArchiveFilter}
                viewMode={viewMode}
                listPath={href(listViewTarget(viewDefault))}
                boardPath={href(boardViewTarget(viewDefault))}
                boardGroupBy={boardGroupBy}
                boardRowGroupBy={navigationState.boardRowGroupBy}
                onBoardRowGroupByChange={navigationState.setBoardRowGroupBy}
                defaultBoardRowGroupBy={project.defaultBoardRowGroupBy}
            listGroupBy={navigationState.listGroupBy}
            onListGroupByChange={navigationState.setListGroupBy}
            defaultListGroupBy={project.defaultListGroupBy}
                onBoardGroupByChange={setBoardGroupBy}
                defaultViewMode={project.defaultViewMode}
                defaultBoardGroupBy={project.defaultBoardGroupBy}
                viewedList={viewedList}
                hiddenTaskTableColumns={project.hiddenTaskTableColumns}
                onMembersClick={openMembersSettings}
                onAiAgentsClick={openAiAgentsSettings}
                onClose={onClose}
              />
            )}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </AssignableTaskAssigneesProvider>
    </ProjectTaskViewsProvider>
  );
}
