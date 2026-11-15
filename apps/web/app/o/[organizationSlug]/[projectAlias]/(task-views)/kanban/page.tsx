"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BoardGroupBy } from "@/lib/navigation";
import { useProjectTaskViews } from "../project-task-views-context";
import { useProjectTaskDetailSurface } from "../use-project-task-detail-surface";
import { BoardSkeleton } from "@/components/blocks/board/board-skeleton";
import { KanbanBoard, type KanbanCardContextMenuActions } from "./kanban-board";
import { TaskListMoveProvider } from "@/components/blocks/tasks/task-table/task-list-move-context";
import { getHiddenTaskTableColumns } from "@/lib/tasks/task-table-columns";
import { calculateRankBetween } from "@/lib/tasks/rank";
import { getChildren } from "@/lib/tasks/tree";
import type { ReorderPosition, Status, Task, TaskUpdate } from "@/lib/tasks/types";
import { useAssignableTaskAssignees } from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { useSectionBoard } from "@/components/blocks/task-grouping";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";

export default function KanbanPage() {
  const {
    organizationSlug,
    projectAlias,
    allowedStatuses,
    project,
    navigationState,
    activeTaskResult,
    currentUserId,
    currentMoveSourceListRef,
    taskListResultsController,
    openMembersSettings,
    openAiAgentsSettings,
    setDetailSurfaceOpen,
  } = useProjectTaskViews();
  const {
    boardGroupBy,
    boardRowGroupBy,
    statusFilter,
    assigneeFilter,
    taskRefId,
    artifactId,
    openTask,
    selectArtifact,
    selectTaskArtifact,
  } = navigationState;
  const projectHiddenTaskTableColumns = project.hiddenTaskTableColumns;
  const hiddenTaskTableColumns = useMemo(
    () => getHiddenTaskTableColumns(projectHiddenTaskTableColumns),
    [projectHiddenTaskTableColumns]
  );
  const assigneeDirectory = useAssignableTaskAssignees(project._id);
  const projectLabels = useProjectLabels(project._id);
  const usesAxis = (dimension: BoardGroupBy) => boardGroupBy === dimension || boardRowGroupBy === dimension;
  const sectionBoard = useSectionBoard(project._id, currentMoveSourceListRef, usesAxis("section"));
  const { canEditProject, myRole } = useProjectPermissions(project._id);
  const canCreateTask = hasProjectPermission(myRole, ProjectPermission.TASK_CREATE);
  const canUpdateTask = hasProjectPermission(myRole, ProjectPermission.TASK_UPDATE);
  const reorderLabelMutation = useMutation(api.tasks.labels.reorder);

  // Column-header drags reorder labels (column order = label rank order).
  const handleLabelReorder = useCallback(
    (labelId: Id<"projectLabels">, rank: string) => {
      reorderLabelMutation({ labelId, rank }).catch((error) =>
        showConvexErrorToast(error, "Failed to reorder label")
      );
    },
    [reorderLabelMutation]
  );

  // Panel J/K walk the cards in DOM order: column by column, top to bottom.
  const boardTasks = activeTaskResult.tasks;
  const getPanelTaskOrder = useCallback(() => {
    const clientIdById = new Map(boardTasks.map((task) => [String(task._id), task.clientId]));
    const ids = Array.from(
      document.querySelectorAll<HTMLElement>("[data-board-task-id]"),
      (card) => clientIdById.get(card.dataset.boardTaskId ?? "")
    ).filter((id): id is string => id !== undefined);
    return [...new Set(ids)];
  }, [boardTasks]);

  const {
    containerRef,
    detailsSurface,
    detailsSurfaceWidth,
    isSidebarOpen,
    openTaskSidebar,
    deleteTaskWithUndo,
    archiveTaskWithUndo,
  } = useProjectTaskDetailSurface({
    organizationSlug,
    projectAlias,
    projectId: project._id,
    allowedStatuses,
    hiddenTaskTableColumns,
    taskSource: activeTaskResult,
    taskRefId,
    artifactId,
    archiveFilter: "active",
    setTaskRefId: openTask,
    selectArtifact,
    selectTaskArtifact,
    currentUserId,
    onInviteClick: openMembersSettings,
    onAddAgentClick: openAiAgentsSettings,
    getPanelTaskOrder,
  });

  // The shared shell hides the mobile nav bar while the detail surface is open.
  useEffect(() => {
    setDetailSurfaceOpen(isSidebarOpen);
    return () => setDetailSurfaceOpen(false);
  }, [isSidebarOpen, setDetailSurfaceOpen]);

  const handleTaskClick = useCallback(
    (task: Task) => {
      openTaskSidebar(task.clientId);
    },
    [openTaskSidebar]
  );

  // Card context menu mirrors the task table row context menu.
  const {
    duplicateTask,
    moveToList,
    unarchiveTask,
    updateTask,
    setParent,
    setParentMultiple,
    tasks,
  } = activeTaskResult;

  // Subtasks dragged from the detail sidebar onto a Board column: promote to root, then apply
  // the column's grouping field. A card-edge drop inserts next to that card in the true root
  // rank order (hidden siblings included); a column-body drop appends.
  //
  // ponytail: reparent + field update are two mutations, not atomic; both are optimistic and a
  // partial failure self-corrects on the next server sync.
  const handleExternalTasksDrop = useCallback(
    (
      taskIds: string[],
      fieldUpdates: TaskUpdate,
      rankTarget?: { targetTaskId: string; position: ReorderPosition }
    ) => {
      const droppedIds = new Set(taskIds);
      const rootSiblings = getChildren(null, tasks).filter(
        (task) => !droppedIds.has(String(task._id))
      );
      const targetIndex = rankTarget
        ? rootSiblings.findIndex((task) => String(task._id) === rankTarget.targetTaskId)
        : -1;

      if (rankTarget && targetIndex !== -1) {
        const insertIndex =
          rankTarget.position === "after" ? targetIndex + 1 : targetIndex;
        let prevRank = rootSiblings[insertIndex - 1]?.rank;
        const nextRank = rootSiblings[insertIndex]?.rank;
        for (const taskId of taskIds) {
          const rank = calculateRankBetween(prevRank, nextRank);
          setParent(taskId, null, rank);
          prevRank = rank;
        }
      } else {
        setParentMultiple(taskIds, null);
      }

      for (const taskId of taskIds) {
        updateTask(taskId, fieldUpdates);
      }
    },
    [setParent, setParentMultiple, tasks, updateTask]
  );

  // Card-center drop from an external drag: make the tasks subtasks of that
  // card. Skips self-drops and tasks already under that parent.
  const handleExternalTasksDropInto = useCallback(
    (taskIds: string[], parentTaskId: string) => {
      const ids = taskIds.filter((taskId) => {
        if (taskId === parentTaskId) {
          return false;
        }
        const task = tasks.find((candidate) => String(candidate._id) === taskId);
        return (task?.parentId ?? null) !== parentTaskId;
      });
      if (ids.length === 0) {
        return;
      }
      setParentMultiple(ids, parentTaskId);
    },
    [setParentMultiple, tasks]
  );
  const cardContextMenu = useMemo<KanbanCardContextMenuActions>(
    () => ({
      onDelete: deleteTaskWithUndo,
      onArchive: archiveTaskWithUndo,
      onUnarchive: (id: string) => void unarchiveTask(id),
      onDuplicate: (task: Task) => void duplicateTask(task._id),
      onUpdateStatus: (id: string, status: Status) => updateTask(id, { status }),
      onOpenDetails: openTaskSidebar,
    }),
    [
      archiveTaskWithUndo,
      deleteTaskWithUndo,
      duplicateTask,
      openTaskSidebar,
      unarchiveTask,
      updateTask,
    ]
  );

  const handleContextMoveTaskToList = useCallback(
    (taskId: string, listRef: string, sectionId?: Id<"taskSections">) => {
      moveToList?.([taskId], listRef, sectionId);
    },
    [moveToList]
  );
  const isBoardLoading =
    (activeTaskResult.isLoading && activeTaskResult.tasks.length === 0) ||
    ((usesAxis("assignee") || usesAxis("owner")) && assigneeDirectory.isLoading) ||
    (usesAxis("label") && projectLabels.isLoading) ||
    sectionBoard.isLoading;

  return (
    <TaskListMoveProvider
      projectId={project._id}
      enabled
      resultsController={taskListResultsController}
      selectedListRef={currentMoveSourceListRef}
      moveTaskToList={handleContextMoveTaskToList}
    >
      <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
        {isBoardLoading ? (
          // Keep the board-shaped skeleton up until tasks stream in, instead
          // of flashing empty columns between the shell skeleton and data.
          <BoardSkeleton />
        ) : (
          <KanbanBoard
            tasks={activeTaskResult.tasks}
            taskTree={activeTaskResult.taskTree}
            boardGroupBy={boardGroupBy}
            boardRowGroupBy={boardRowGroupBy}
            listRef={currentMoveSourceListRef}
            assignableUsers={assigneeDirectory.users.map((option) => ({
              _id: option.value.userId,
              name: option.label,
              avatarUrl: option.details.avatarUrl,
            }))}
            projectAgents={assigneeDirectory.projectAgents}
            allowedStatuses={allowedStatuses}
            labels={projectLabels.labels}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            currentUserId={currentUserId}
            projectId={project._id}
            hiddenTaskTableColumns={hiddenTaskTableColumns}
            onTaskUpdate={canUpdateTask ? activeTaskResult.updateTask : undefined}
            onTaskCreate={canCreateTask ? activeTaskResult.addTask : undefined}
            onTaskReorder={canUpdateTask ? activeTaskResult.reorderTasks : undefined}
            onTaskMove={canUpdateTask ? activeTaskResult.moveTask : undefined}
            onTaskMakeSubtask={canUpdateTask ? activeTaskResult.setParent : undefined}
            onExternalTasksDrop={canUpdateTask ? handleExternalTasksDrop : undefined}
            onExternalTasksDropInto={canUpdateTask ? handleExternalTasksDropInto : undefined}
            onLabelReorder={canEditProject ? handleLabelReorder : undefined}
            canCreateLabel={canEditProject}
            sectionBoard={sectionBoard}
            onInviteClick={openMembersSettings}
            onAddAgentClick={openAiAgentsSettings}
            onTaskClick={handleTaskClick}
            cardContextMenu={{ ...cardContextMenu, readOnly: !canUpdateTask }}
            scrollEndPaddingPx={detailsSurfaceWidth}
          />
        )}
        {detailsSurface}
      </div>
    </TaskListMoveProvider>
  );
}
