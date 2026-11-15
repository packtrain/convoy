"use client";

import { useTaskGrouping } from "@/components/blocks/task-grouping";
import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  ARCHIVE_COMPLETED_TASKS_HOTKEY,
  CREATE_TASK_DIALOG_HOTKEY,
  CREATE_TASK_AT_TOP_HOTKEY,
  isEditableHotkeyTarget,
  MOVE_CLOSED_TASKS_BOTTOM_HOTKEY,
} from "@/lib/browser/hotkeys";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import { getTaskGroupTarget } from "@/lib/tasks/types";
import { getHiddenTaskTableColumns } from "@/lib/tasks/task-table-columns";
import { useArchivedTasks } from "@/lib/tasks/hooks/use-archived-tasks";
import { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import { ArchiveCompletedDialog } from "@/components/blocks/tasks/archive-completed-dialog";
import { TaskTableSurface } from "@/components/blocks/tasks/task-table-surface";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { useCreateTaskDialog } from "@/components/blocks/tasks/create-task-dialog-context";
import { useProjectTaskViews } from "./project-task-views-context";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useProjectTaskDetailSurface } from "./use-project-task-detail-surface";

function isEditableShortcutEvent(event: KeyboardEvent): boolean {
  return (
    isEditableHotkeyTarget(event.target) ||
    isEditableHotkeyTarget(document.activeElement)
  );
}

export default function ProjectPage() {
  const { openCreateTaskDialog } = useCreateTaskDialog();
  const isMobile = useIsMobile();
  const {
    organizationSlug,
    projectAlias,
    project,
    allowedStatuses,
    navigationState,
    activeTaskResult,
    taskListResultsController,
    currentMoveSourceListRef,
    currentUserId,
    isListGroupingLoading,
    showTaskRank,
    openMembersSettings,
    openAiAgentsSettings,
    setHeaderAddTaskAction,
    setDetailSurfaceOpen,
  } = useProjectTaskViews();

  // URL-controlled state (filters, task sidebar)
  const {
    statusFilter,
    assigneeFilter,
    archiveFilter,
    taskRefId,
    artifactId,
    selectArtifact,
    selectTaskArtifact,
    openTask,
    setStatusFilter,
    setAssigneeFilter,
  } = navigationState;

  // Task data and CRUD operations
  // Archived tasks: paginated, no optimistic updates (reactive server state)
  const archivedResult = useArchivedTasks(
    archiveFilter === "archived" ? project._id : undefined
  );
  const taskResult =
    archiveFilter === "archived" ? archivedResult : activeTaskResult;
  // Select the active result set based on archive filter
  const {
    tasks: taskList,
    isLoading: tasksLoading,
    updateTask,
    addTask,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    bulkUnarchive,
    moveToList: moveToListOperation,
    moveClosedToBottom,
    duplicateTask,
    unarchiveTask,
    inputRefs,
    focusInput,
  } = taskResult;
  const projectHiddenTaskTableColumns = project.hiddenTaskTableColumns;
  const hiddenTaskTableColumns = useMemo(
    () => getHiddenTaskTableColumns(projectHiddenTaskTableColumns),
    [projectHiddenTaskTableColumns]
  );
  const moveToList =
    archiveFilter === "active" ? moveToListOperation : undefined;

  const mainTableContainerRef = useRef<HTMLDivElement>(null); // Main table only (for keyboard scoping)
  // The detail surface provides delete handlers consumed by the table controller,
  // but bulk-delete confirmation needs the controller's clearSelection callback.
  // This ref bridges that ordering cycle without recreating the surface after the controller is built.
  const clearSelectionRef = useRef<() => void>(() => {});
  // Same ordering cycle: the panel's J/K follow the table's visible rows.
  const panelTaskOrderRef = useRef<readonly string[]>([]);
  const getPanelTaskOrder = useCallback(() => panelTaskOrderRef.current, []);
  const taskDetails = useProjectTaskDetailSurface({
    organizationSlug,
    projectAlias,
    projectId: project._id,
    allowedStatuses,
    hiddenTaskTableColumns,
    taskSource: taskResult,
    taskRefId,
    artifactId,
    archiveFilter,
    setTaskRefId: openTask,
    selectArtifact,
    selectTaskArtifact,
    currentUserId,
    onInviteClick: openMembersSettings,
    onAddAgentClick: openAiAgentsSettings,
    onBulkDeleteConfirmed: () => clearSelectionRef.current(),
    getPanelTaskOrder,
  });
  const {
    containerRef,
    detailsSurface,
    isSidebarOpen,
    openTaskSidebar,
    deleteTaskWithUndo,
    archiveTaskWithUndo,
    bulkArchiveWithUndo,
    bulkDeleteRequest,
  } = taskDetails;
  // The shared shell hides the mobile nav bar while the detail surface is open.
  useEffect(() => {
    setDetailSurfaceOpen(isSidebarOpen);
    return () => setDetailSurfaceOpen(false);
  }, [isSidebarOpen, setDetailSurfaceOpen]);

  // Archive all completed (Done/Canceled) tasks dialog
  // Only count top-level tasks (no parentId) - subtasks cannot be archived directly
  const [showArchiveCompletedDialog, setShowArchiveCompletedDialog] = useState(false);
  const completedTasks = taskList.filter((t) => !t.parentId && isClosedStatus(t.status));
  const handleArchiveAllCompleted = useCallback(() => {
    if (completedTasks.length > 0) {
      bulkArchiveWithUndo(completedTasks.map((t) => t._id));
    }
  }, [bulkArchiveWithUndo, completedTasks]);

  const handleInviteClick = openMembersSettings;
  const handleAddAgentClick = openAiAgentsSettings;

  const { canCreateTask, canUpdateTask } = useProjectPermissions(project._id);

  // Table controller (manages selection, keyboard nav, bulk actions, table state)
  const grouping = useTaskGrouping({
    projectId: project._id, userId: currentUserId, listRef: currentMoveSourceListRef,
    groupBy: navigationState.listGroupBy, tasks: taskList, allowedStatuses,
    statusFilter, assigneeFilter, archived: archiveFilter === "archived",
    addTask, updateTask, setParent, moveTask: activeTaskResult.moveTask, reorderMultiple,
  });
  const mainTable = useTaskTableController({
    transformRows: grouping.enabled ? grouping.transformRows : undefined,
    resolveDraft: grouping.enabled ? grouping.resolveDraft : undefined,
    navigateGroups: grouping.enabled ? grouping.navigate : undefined,
    revealGroupRow: grouping.enabled ? grouping.reveal : undefined,
    onCreateSection: grouping.createSection && ((name) => {
      void grouping.createSection?.(name);
      navigationState.setListGroupBy("section");
    }),
    allTasks: taskList,
    updateTask,
    deleteTask: deleteTaskWithUndo,
    archiveTask: archiveTaskWithUndo,
    unarchiveTask,
    addTask,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    bulkArchive: bulkArchiveWithUndo,
    bulkUnarchive,
    moveToList,
    moveClosedToBottom,
    bulkDelete: bulkDeleteRequest,
    duplicateTask,
    inputRefs,
    focusInput,
    containerRef: mainTableContainerRef,
    onOpenDetails: openTaskSidebar,
    openDetailsOnNameClick: isMobile || isSidebarOpen,
    enabled: project !== undefined && project !== null && !tasksLoading,
    canUpdateTask,
    projectId: project._id,
    currentUserId,
    allowedStatuses,
    // URL-controlled filter state
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    assigneeFilter,
    onAssigneeFilterChange: setAssigneeFilter,
    selectedTaskRefId: taskRefId,
    // No add rows or drafts in the archived view or without create access
    allowAddTask: archiveFilter !== "archived" && canCreateTask,
    allowRootAddTask: grouping.allowRootCreation,
    // Preserve root order for archived view (sorted by archivedAt from backend)
    preserveRootOrder: archiveFilter === "archived",
  });
  const beginInlineTaskDraftAtTop = mainTable.beginInlineTaskDraftAtTop;
  useEffect(() => {
    clearSelectionRef.current = mainTable.clearSelection;
  }, [mainTable.clearSelection]);
  useEffect(() => {
    panelTaskOrderRef.current = mainTable.taskIds.filter((id) => !getTaskGroupTarget(id));
  }, [mainTable.taskIds]);

  useEffect(() => {
    setHeaderAddTaskAction(beginInlineTaskDraftAtTop);

    return () => {
      setHeaderAddTaskAction(null);
    };
  }, [beginInlineTaskDraftAtTop, setHeaderAddTaskAction]);
  const canMoveClosedToBottom =
    archiveFilter === "active" &&
    statusFilter === "all" &&
    assigneeFilter === null;

  // Keyboard shortcut: "C" to create task at top
  useHotkey(
    CREATE_TASK_AT_TOP_HOTKEY,
    (event) => {
      if (isEditableShortcutEvent(event)) {
        return;
      }

      event.preventDefault();
      beginInlineTaskDraftAtTop();

      const scrollContainer =
        mainTableContainerRef.current?.querySelector<HTMLElement>(
          "[data-task-table-scroll-container]"
        ) ?? mainTableContainerRef.current;

      scrollContainer?.scrollTo({ top: 0 });
    },
    {
      enabled: canCreateTask && archiveFilter !== "archived" && !!project && !tasksLoading,
    }
  );

  // Keyboard shortcut: "N" opens the task create dialog in task-list context.
  useHotkey(
    CREATE_TASK_DIALOG_HOTKEY,
    (event) => {
      if (isEditableShortcutEvent(event)) {
        return;
      }

      event.preventDefault();
      openCreateTaskDialog();
    },
    {
      enabled: canCreateTask && archiveFilter !== "archived" && !!project && !tasksLoading,
    }
  );

  useHotkey(
    ARCHIVE_COMPLETED_TASKS_HOTKEY,
    (event) => {
      if (isEditableShortcutEvent(event)) {
        return;
      }

      if (archiveFilter !== "active" || completedTasks.length === 0) {
        return;
      }

      event.preventDefault();
      setShowArchiveCompletedDialog(true);
    },
    {
      enabled: canUpdateTask && !!project && !tasksLoading,
    }
  );

  useHotkey(
    MOVE_CLOSED_TASKS_BOTTOM_HOTKEY,
    (event) => {
      if (isEditableShortcutEvent(event)) {
        return;
      }

      if (!canMoveClosedToBottom) {
        return;
      }

      event.preventDefault();
      mainTable.handleMoveClosedToBottom();
    },
    {
      enabled: canUpdateTask && !!project && !tasksLoading,
    }
  );

  return (
    <>
      <TaskTableSurface
        projectId={project._id}
        controller={mainTable}
        grouping={grouping.enabled ? grouping : undefined}
        tasks={taskList}
        isLoading={tasksLoading}
        isGroupingLoading={isListGroupingLoading || grouping.isLoading}
        ops={{
          ...taskResult,
          deleteTask: deleteTaskWithUndo,
          archiveTask: archiveTaskWithUndo,
          moveToList,
        }}
        archiveFilter={archiveFilter}
        selectedListRef={currentMoveSourceListRef}
        viewCacheScope="project-task-view"
        tableContainerRef={mainTableContainerRef}
        hiddenTaskTableColumns={hiddenTaskTableColumns}
        allowedStatuses={allowedStatuses}
        currentUserId={currentUserId}
        onOpenDetails={openTaskSidebar}
        containerRef={containerRef}
        afterTable={detailsSurface}
        resultsController={taskListResultsController}
        onInviteClick={handleInviteClick}
        onAddAgentClick={handleAddAgentClick}
        showTaskRank={showTaskRank}
        showResourceCount={project.showArtifactsCount ?? true}
        doneTaskCount={completedTasks.length}
        onArchiveAllDone={() => setShowArchiveCompletedDialog(true)}
        onLoadMore={archiveFilter === "archived" ? archivedResult.loadMore : undefined}
        hasMore={archiveFilter === "archived" ? archivedResult.hasMore : undefined}
        isLoadingMore={
          archiveFilter === "archived" ? archivedResult.isLoadingMore : undefined
        }
        mobileCardLayout={isMobile}
        maxHeight={isMobile ? "100dvh" : undefined}
      />

      {/* Archive all completed tasks confirmation dialog */}
      <ArchiveCompletedDialog
        open={showArchiveCompletedDialog && canUpdateTask}
        onOpenChange={setShowArchiveCompletedDialog}
        completedTaskCount={completedTasks.length}
        onConfirm={handleArchiveAllCompleted}
      />
    </>
  );
}
