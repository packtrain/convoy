"use client";

import { useTaskTableRows } from "./task-table/hooks/use-task-table-rows";
import type { TaskGrouping } from "@/components/blocks/task-grouping";
import { useCallback, type ReactNode, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { MobileTaskList } from "@/components/blocks/tasks/mobile-task-list";
import { MultiSelectToolbar } from "@/components/blocks/tasks/multi-select-toolbar";
import { TaskShortcutPicker } from "@/components/blocks/tasks/task-shortcut-picker";
import { TaskTable } from "@/components/blocks/tasks/task-table";
import type { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import { TaskListMoveProvider } from "@/components/blocks/tasks/task-table/task-list-move-context";
import { TaskViewCardsSkeleton, TaskViewTableSkeleton } from "@/components/blocks/tasks/task-view-table-skeleton";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";
import { useLastResolvedValue } from "@/hooks/react/use-last-resolved-value";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type {
  ArchiveFilter,
  ReorderMultipleFn,
  ReorderTasksFn,
  Status,
  Task,
  TaskUpdate,
} from "@/lib/tasks/types";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

type TaskTableController = ReturnType<typeof useTaskTableController>;

/**
 * Task CRUD/reorder operations the surface forwards to the table. Structurally
 * satisfied by both `useTasks` and `useArchivedTasks` results; callers needing
 * undo-wrapped handlers (project task views) compose them in.
 */
interface TaskTableSurfaceOps {
  updateTask: (id: string, updates: TaskUpdate) => void;
  deleteTask: (id: string) => void;
  addTask: (
    task: Omit<Task, "_id" | "clientId">,
    position?: { afterId?: string; beforeId?: string; parentId?: string }
  ) => string | null;
  archiveTask: (id: string) => void;
  unarchiveTask: (id: string) => void;
  reorderTasks: ReorderTasksFn;
  reorderMultiple: ReorderMultipleFn;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  setParentMultiple: (ids: string[], parentId: string | null, afterTaskId?: string) => void;
  duplicateTask: (id: string) => string | null;
  moveToList?: (rootIds: string[], listRef: string, sectionId?: Id<"taskSections">) => void;
  moveActiveToList?: (listRef: string) => void;
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
}

interface TaskTableSurfaceProps {
  grouping?: TaskGrouping;
  projectId: Id<"projects">;
  /** Controller built by the caller (its options differ per route: undo handlers, URL filters, hotkey scoping). */
  controller: TaskTableController;
  tasks: Task[];
  isLoading: boolean;
  /** Groups aren't known yet; the skeleton shows even over cached tasks so they don't render ungrouped. */
  isGroupingLoading?: boolean;
  ops: TaskTableSurfaceOps;
  archiveFilter: ArchiveFilter;
  selectedListRef: string | null;
  /**
   * Distinct per surface (e.g. "project-task-view" vs "thread-tasks-panel-view")
   * so one surface's loaded state can't suppress another's transition skeleton.
   */
  viewCacheScope: string;
  /** Keyboard-navigation scope; the controller's containerRef must point at the same element. */
  tableContainerRef: RefObject<HTMLDivElement | null>;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  allowedStatuses?: TaskStatus[];
  currentUserId?: string;
  onOpenDetails: (clientId: string) => void;
  containerRef?: RefObject<HTMLDivElement | null>;
  containerClassName?: string;
  /** Route-owned content rendered inside the container after the table (e.g. the task detail surface). */
  afterTable?: ReactNode;
  compact?: boolean;
  /** Render root tasks as kanban-style cards instead of the table. See docs/specs/mobile-task-list.md. */
  mobileCardLayout?: boolean;
  maxHeight?: string;
  resultsController?: TaskListResultsController;
  // Project-page extras; omitted by embedded surfaces.
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  showTaskRank?: boolean;
  showResourceCount?: boolean;
  doneTaskCount?: number;
  onArchiveAllDone?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

/**
 * Shared task-table view: transition skeleton, list-move context, the
 * controller-driven `TaskTable`, and the multi-select toolbar. Used by the
 * project task views page and the thread Tasks panel so the ~60-prop table
 * wiring lives in one place.
 */
export function TaskTableSurface({
  projectId,
  controller,
  grouping,
  tasks,
  isLoading,
  isGroupingLoading,
  ops,
  archiveFilter,
  selectedListRef,
  viewCacheScope,
  tableContainerRef,
  hiddenTaskTableColumns,
  allowedStatuses,
  currentUserId,
  onOpenDetails,
  containerRef,
  containerClassName,
  afterTable,
  compact,
  mobileCardLayout,
  maxHeight,
  resultsController,
  onInviteClick,
  onAddAgentClick,
  showTaskRank,
  showResourceCount,
  doneTaskCount,
  onArchiveAllDone,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: TaskTableSurfaceProps) {
  const {
    updateTask,
    deleteTask,
    addTask,
    archiveTask,
    unarchiveTask,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
    duplicateTask,
    moveToList,
    moveActiveToList,
    inputRefs,
    focusInput,
  } = ops;

  // Stale-cache-aware skeleton: `useTasks` keeps serving the previous view's
  // tasks while a list/archive switch reloads, so plain `isLoading &&
  // tasks.length === 0` never fires on a switch. Show the skeleton whenever
  // the loading view differs from the last fully-loaded one.
  const taskViewKey = `${projectId}:${archiveFilter}:${selectedListRef ?? ""}`;
  const lastLoadedTaskViewKey = useLastResolvedValue({
    cacheKey: `${viewCacheScope}:${projectId}`,
    enabled: true,
    value: isLoading ? undefined : taskViewKey,
  });
  const isViewTransitionLoading =
    isLoading &&
    Boolean(lastLoadedTaskViewKey && lastLoadedTaskViewKey !== taskViewKey);
  const presentedRows = useTaskTableRows(controller.flattenedTasks, grouping?.presentRows);
  const showSkeleton =
    isGroupingLoading ||
    (isLoading && (tasks.length === 0 || isViewTransitionLoading));

  const navigateRow = controller.navigateRow;
  const focusPreviousRow = controller.focusPreviousRow;
  const renderGroupRow = useCallback((row: import("@/lib/tasks/types").TaskSectionRow) => grouping?.renderHeader(row, { onNavigate: navigateRow, onFocusPrevious: focusPreviousRow }), [grouping, navigateRow, focusPreviousRow]);
  const collapseTasks = controller.collapseAll;
  const collapseGroups = grouping?.collapseAll;
  const handleCollapseAll = useCallback(() => {
    collapseTasks();
    collapseGroups?.();
  }, [collapseTasks, collapseGroups]);

  const handleDuplicate = useCallback(
    (task: Task) => {
      duplicateTask(String(task._id));
    },
    [duplicateTask]
  );
  const handleUpdateStatus = useCallback(
    (id: string, status: Status) => {
      updateTask(id, { status });
    },
    [updateTask]
  );
  const handleContextMoveTaskToList = useCallback(
    (taskId: string, listRef: string, sectionId?: Id<"taskSections">) => {
      moveToList?.([taskId], listRef, sectionId);
    },
    [moveToList]
  );

  const canMoveClosedToBottom =
    archiveFilter === "active" &&
    controller.statusFilter === "all" &&
    controller.assigneeFilter === null;
  const activeRootTaskCount = tasks.filter(
    (task) => !task.parentId && !isClosedStatus(task.status)
  ).length;

  return (
    <TaskListMoveProvider
      projectId={projectId}
      enabled={archiveFilter === "active"}
      resultsController={resultsController}
      selectedListRef={selectedListRef}
      moveTaskToList={handleContextMoveTaskToList}
      moveSelectionToList={controller.handleMoveSelectedToList}
    >
      {showSkeleton ? (
        mobileCardLayout ? <TaskViewCardsSkeleton /> : <TaskViewTableSkeleton />
      ) : (
        <div
          ref={containerRef}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            containerClassName
          )}
        >
          <div ref={tableContainerRef} className="h-full">
            {mobileCardLayout ? (
              <MobileTaskList
                projectId={projectId}
                controller={controller}
                grouping={grouping}
                archiveFilter={archiveFilter}
                allowedStatuses={allowedStatuses}
                hiddenTaskTableColumns={hiddenTaskTableColumns}
                onOpenDetails={onOpenDetails}
                onInviteClick={onInviteClick}
                onAddAgentClick={onAddAgentClick}
                doneTaskCount={doneTaskCount}
                onArchiveAllDone={onArchiveAllDone}
                onCollapseAll={handleCollapseAll}
                canMoveClosedToBottom={canMoveClosedToBottom}
                activeRootTaskCount={activeRootTaskCount}
                onMoveActiveToList={
                  canMoveClosedToBottom ? moveActiveToList : undefined
                }
                moveSourceListRef={selectedListRef}
                onLoadMore={onLoadMore}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                maxHeight={maxHeight}
              />
            ) : (
            <TaskTable
              tasks={presentedRows}
              renderSectionRow={grouping ? renderGroupRow : undefined}
              getRowStyle={grouping?.getRowStyle}
              onGroupDrop={grouping?.drop}
              taskTree={controller.taskTree}
              inputRefs={inputRefs}
              registerRow={controller.registerRow}
              focusRequest={controller.focusRequest}
              rowSelection={controller.rowSelection}
              onRowSelectionChange={controller.setRowSelection}
              sorting={controller.sorting}
              onSortingChange={controller.setSorting}
              statusFilter={controller.statusFilter}
              assigneeFilter={controller.assigneeFilter}
              currentUserId={currentUserId}
              projectId={projectId}
              allowedStatuses={allowedStatuses}
              hiddenTaskTableColumns={hiddenTaskTableColumns}
              selectedIds={controller.selectedIds}
              onRowClick={controller.handleRowClick}
              onSelectRow={controller.handleSelectRow}
              onContextMenuSelectRow={controller.handleContextMenuSelection}
              expandedIds={controller.expandedIds}
              toggleExpanded={controller.toggleExpanded}
              isDndEnabled={controller.isDndEnabled && archiveFilter !== "archived" && (!grouping || grouping.canMove)}
              canUpdateTask={controller.canUpdateTask}
              reorderTasks={reorderTasks}
              reorderMultiple={reorderMultiple}
              setParent={setParent}
              setParentMultiple={setParentMultiple}
              addTaskValue={controller.addTaskValue}
              onAddTaskChange={controller.setAddTaskValue}
              onAddTaskKeyDown={controller.handleAddTaskKeyDown}
              onAddTaskBlur={controller.handleAddTaskBlur}
              getAddTaskInputValue={controller.getAddTaskInputValue}
              onAddTaskInputChange={controller.setAddTaskInputValue}
              onAddTaskInputKeyDown={controller.handleAddTaskInputKeyDown}
              onAddTaskInputBlur={controller.handleAddTaskInputBlur}
              onInlineDraftChange={controller.updateInlineTaskDraftValue}
              onInlineDraftCommit={controller.commitInlineTaskDraft}
              onInlineDraftCancel={controller.cancelInlineTaskDraft}
              defaultParentId={controller.defaultParentId as Id<"tasks"> | undefined}
              updateTask={updateTask}
              deleteTask={deleteTask}
              addTask={addTask}
              beginInlineTaskDraft={controller.beginInlineTaskDraft}
              focusInput={focusInput}
              getAdjacentId={controller.getAdjacentId}
              getPreviousTaskId={controller.getPreviousTaskId}
              onDuplicate={handleDuplicate}
              onUpdateStatus={handleUpdateStatus}
              onOpenDetails={onOpenDetails}
              onBulkContextUpdateStatus={controller.handleBulkStatusChange}
              onBulkContextUpdatePriority={controller.handleBulkPriorityChange}
              onBulkContextUpdateAssignee={controller.handleBulkAssigneeChange}
              onBulkContextUpdateLabel={controller.handleBulkLabelChange}
              onBulkContextArchive={
                archiveFilter === "active" ? controller.handleBulkArchive : undefined
              }
              onBulkContextUnarchive={
                archiveFilter === "archived" ? controller.handleBulkUnarchive : undefined
              }
              onBulkContextDelete={controller.handleBulkDelete}
              onInviteClick={onInviteClick}
              onAddAgentClick={onAddAgentClick}
              showTaskRank={showTaskRank}
              showResourceCount={showResourceCount}
              registerAddTaskInput={controller.registerAddTaskInput}
              archiveTask={archiveTask}
              unarchiveTask={unarchiveTask}
              allowAddTask={controller.allowAddTask && (!grouping || grouping.allowRootCreation)}
              archiveFilter={archiveFilter}
              doneTaskCount={doneTaskCount}
              onArchiveAllDone={onArchiveAllDone}
              onCollapseAll={handleCollapseAll}
              canMoveClosedToBottom={canMoveClosedToBottom}
              onMoveClosedToBottom={controller.handleMoveClosedToBottom}
              activeRootTaskCount={activeRootTaskCount}
              onMoveActiveToList={
                canMoveClosedToBottom ? moveActiveToList : undefined
              }
              moveSourceListRef={selectedListRef}
              shortcutPalette={controller.shortcutPalette}
              onLoadMore={onLoadMore}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              compact={compact}
              maxHeight={maxHeight}
            />
            )}
          </div>
          {afterTable}
        </div>
      )}

      {controller.isBulkSelection && (
        <MultiSelectToolbar
          readOnly={!controller.canUpdateTask}
          selectedCount={controller.selectedIds.size}
          projectId={projectId}
          allowedStatuses={allowedStatuses}
          onInviteClick={onInviteClick}
          onAddAgentClick={onAddAgentClick}
          onMarkComplete={controller.handleBulkComplete}
          onStatusChange={controller.handleBulkStatusChange}
          onPriorityChange={controller.handleBulkPriorityChange}
          onAssigneeChange={controller.handleBulkAssigneeChange}
          onDueDateChange={controller.handleBulkDueDateChange}
          onLabelChange={controller.handleBulkLabelChange}
          onArchive={
            archiveFilter === "active" ? controller.handleBulkArchive : undefined
          }
          onUnarchive={
            archiveFilter === "archived" ? controller.handleBulkUnarchive : undefined
          }
          onDelete={controller.handleBulkDelete}
          onClearSelection={controller.clearSelection}
        />
      )}
      <TaskShortcutPicker
        request={controller.propertyShortcut}
        projectId={projectId}
        onTaskUpdate={controller.updateTask}
        onInviteClick={onInviteClick}
        onAddAgentClick={onAddAgentClick}
        onClose={controller.closePropertyShortcut}
      />
    </TaskListMoveProvider>
  );
}
