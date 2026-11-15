"use client";

import { getTaskGroupTarget, isGroupHeaderRow } from "@/lib/tasks/types";

import {
  useMemo,
  useCallback,
  useEffect,
  Profiler,
  RefObject,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  SortingState,
} from "@tanstack/react-table";
import { useTaskTableVirtualizer } from "./hooks/use-task-table-virtualizer";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { TableDiv, TableDivBody, TableDivHead, TableDivHeader, TableDivRow } from "@/components/ui/table-div";
import { cn } from "@/lib/utils";
import { readLocalString } from "@/lib/browser/local-storage";
import type { Task, TaskTreeNode, StatusFilterKey, AssigneeFilter, FlattenedRow, TaskSectionRow, Status, ArchiveFilter, Priority, TaskUpdate, ReorderTasksFn, ReorderMultipleFn } from "@/lib/tasks/types";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import { isAddTaskPlaceholder, isInlineTaskDraftRow, isTaskSectionRow } from "@/lib/tasks/types";
import type { Id } from "@/convex/_generated/dataModel";
import { useResourceTaskDrop } from "@/components/blocks/tasks/use-resource-task-drop";
import { useTableDnd, type GroupDropHandler } from "./hooks/use-table-dnd";
import { useNameColumnResize, MIN_NAME_COLUMN_WIDTH } from "./hooks/use-name-column-resize";
import { createColumns, COLUMN_STYLES, COLUMN_STYLES_AUTO } from "./columns";
import { TaskContextMenuProvider, type TaskContextMenuSelectionActions } from "./task-context-menu";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { MemoizedTaskRow } from "./task-row";
import { AddTaskRow } from "../add-task-row";
import { Kbd } from "@/components/ui/kbd";
import type { ShortcutPaletteState } from "./hooks/use-keyboard-navigation";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
// Import types to ensure TableMeta extension is loaded
import "@/lib/tasks/types";

const BOTTOM_ADD_TASK_SCROLL_PADDING_PX = 192;
const MOBILE_BOTTOM_ADD_TASK_SCROLL_PADDING_PX = 128;
const EMPTY_HIDDEN_TASK_TABLE_COLUMNS: readonly TaskTableColumnId[] = [];

interface TaskTableProps {
  /** Scrolls the row into view, then focuses it unless `focus` is false. */
  focusRequest?: { id: string; focus?: boolean };
  tasks: (FlattenedRow | TaskSectionRow)[];
  taskTree: TaskTreeNode[];
  /** Group headers stay separate from task selection and tree depth. */
  onGroupDrop?: GroupDropHandler;
  renderSectionRow?: (row: TaskSectionRow) => ReactNode;
  /** Row decoration, e.g. section color; applied to the positioned row wrapper. */
  getRowStyle?: (row: FlattenedRow) => CSSProperties | undefined;
  inputRefs: RefObject<Map<string, HTMLInputElement> | null>;
  registerRow: (id: string, el: HTMLElement | null) => void;
  // Table state
  rowSelection: Record<string, boolean>;
  onRowSelectionChange: (value: Record<string, boolean>) => void;
  sorting: SortingState;
  onSortingChange: (value: SortingState) => void;
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  currentUserId?: string;
  projectId?: Id<"projects">;
  allowedStatuses?: Status[];
  selectedIds: Set<string>;
  onRowClick: (e: React.MouseEvent, taskId: string) => void;
  onSelectRow: (e: React.MouseEvent, taskId: string) => void;
  onContextMenuSelectRow: (taskId: string) => void;
  // Tree expansion
  expandedIds?: Set<string>;
  toggleExpanded?: (id: string) => void;
  // DnD
  isDndEnabled: boolean;
  /** False for read-only viewers: cells render values and rows take no resource drops. */
  canUpdateTask?: boolean;
  reorderTasks: ReorderTasksFn;
  reorderMultiple: ReorderMultipleFn;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  setParentMultiple: (ids: string[], parentId: string | null) => void;
  // Add task
  addTaskValue: string;
  onAddTaskChange: (value: string) => void;
  onAddTaskKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onAddTaskBlur: () => void;
  getAddTaskInputValue?: (id: string) => string;
  onAddTaskInputChange?: (id: string, value: string) => void;
  onAddTaskInputKeyDown?: (
    id: string,
    parentId: string | null | undefined,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => void;
  onAddTaskInputBlur?: (id: string, parentId: string | null | undefined) => void;
  onInlineDraftChange: (value: string) => void;
  onInlineDraftCommit: (value: string, reason: "enter" | "blur") => void;
  onInlineDraftCancel: (reason?: "escape" | "backspace-empty") => void;
  // Default parent for new tasks created via "Add task" input
  defaultParentId?: Id<"tasks">;
  // Actions (passed to table meta)
  updateTask: (id: string, updates: TaskUpdate) => void;
  deleteTask: (id: string) => void;
  archiveTask: (id: string) => void;
  unarchiveTask: (id: string) => void;
  addTask: (
    task: Omit<Task, "_id" | "clientId">,
    position?: { afterId?: string; beforeId?: string; parentId?: string }
  ) => string | null;
  beginInlineTaskDraft: (options: {
    parentId?: string | null;
    beforeClientId?: string;
    afterClientId?: string;
  }) => void;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
  getAdjacentId: (currentId: string, direction: "prev" | "next") => string | null;
  getPreviousTaskId: (addTaskClientId: string) => string | null;
  // Context menu actions
  onDuplicate: (task: Task) => void;
  onUpdateStatus: (id: string, status: Status) => void;
  onOpenDetails: (clientId: string) => void;
  onBulkContextUpdateStatus?: (status: Status) => void;
  onBulkContextUpdatePriority?: (priority: Priority) => void;
  onBulkContextUpdateAssignee?: (change: TaskAssigneeChange) => void;
  onBulkContextUpdateLabel?: (labelId: Id<"projectLabels"> | null) => void;
  onBulkContextArchive?: () => void;
  onBulkContextUnarchive?: () => void;
  onBulkContextDelete?: () => void;
  /** Opens project settings to invite members (used by assignee dropdown footer) */
  onInviteClick?: () => void;
  /** Opens project settings to manage AI agents (used by assignee dropdown footer) */
  onAddAgentClick?: () => void;
  // Layout options
  /** Custom max height for scroll container (default: calc(100vh - 97px)) */
  maxHeight?: string;
  /** Force compact mode - hides header and uses narrow columns */
  compact?: boolean;
  /** Show the raw LexoRank in the task name cell */
  showTaskRank?: boolean;
  /** Show the resource count indicator (attachments + artifacts) after the task name */
  showResourceCount?: boolean;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  // Keyboard navigation for add-task inputs
  registerAddTaskInput?: (id: string, el: HTMLInputElement | null) => void;
  // Whether to show "add task" rows (default: true)
  allowAddTask?: boolean;
  // Archive all done tasks
  archiveFilter?: ArchiveFilter;
  doneTaskCount?: number;
  onArchiveAllDone?: () => void;
  onCollapseAll?: () => void;
  canMoveClosedToBottom?: boolean;
  onMoveClosedToBottom?: () => void;
  activeRootTaskCount?: number;
  onMoveActiveToList?: (listRef: string) => void;
  moveSourceListRef?: string | null;
  shortcutPalette?: ShortcutPaletteState | null;
  // Infinite scroll (paginated views)
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

interface InfiniteLoadState {
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  isNearEnd: boolean;
  isVirtualizerScrolling: boolean;
  hasBufferedRows?: boolean;
}

interface ShortcutPaletteViewProps {
  shortcutPalette: ShortcutPaletteState;
  anchorRef: RefObject<HTMLDivElement | null>;
}

function ShortcutPaletteView({
  shortcutPalette,
  anchorRef,
}: ShortcutPaletteViewProps) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    let animationFrameId: number | null = null;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      setStyle({
        bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
        left: rect.left + rect.width / 2,
        maxWidth: Math.max(240, rect.width - 24),
      });
    };

    const scheduleUpdate = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(updatePosition);
    };

    scheduleUpdate();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleUpdate)
        : null;
    resizeObserver?.observe(anchor);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [anchorRef]);

  if (typeof document === "undefined" || !style) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-foreground shadow-lg backdrop-blur-sm"
      style={style}
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
        <Kbd>{shortcutPalette.prefix}</Kbd>
        <span>{shortcutPalette.title}</span>
      </div>
      <div className="grid max-w-xl grid-cols-4 gap-x-3 gap-y-1">
        {shortcutPalette.options.map((option) => (
          <span
            key={option.key}
            className="flex min-w-0 items-center gap-1.5 text-xs"
          >
            <Kbd>{option.key}</Kbd>
            <span className="truncate text-muted-foreground">
              {option.label}
            </span>
          </span>
        ))}
      </div>
    </div>,
    document.body
  );
}

// Drop-target id for the bottom add-task row. In a subtask table the table is
// scoped to a parent (defaultParentId), so dropping onto the bottom row must
// keep the task under that parent (`add-{parentId}`) rather than moving it to
// the root (`add-root`). See OS-884.
export function getBottomAddRowDropTargetId(
  defaultParentId?: string | null
): string {
  return defaultParentId ? `add-${defaultParentId}` : "add-root";
}

export function shouldTriggerInfiniteLoad({
  onLoadMore,
  hasMore,
  isLoadingMore,
  isNearEnd,
  isVirtualizerScrolling,
  hasBufferedRows,
}: InfiniteLoadState): boolean {
  return Boolean(
    onLoadMore &&
      hasMore &&
      !isLoadingMore &&
      isNearEnd &&
      !isVirtualizerScrolling &&
      !hasBufferedRows
  );
}

export { getRowHeight } from "./hooks/use-task-table-virtualizer";

export function TaskTable({
  focusRequest,
  tasks,
  taskTree,
  renderSectionRow,
  getRowStyle,
  onGroupDrop,
  inputRefs,
  registerRow,
  rowSelection,
  onRowSelectionChange,
  sorting,
  onSortingChange,
  statusFilter,
  assigneeFilter,
  currentUserId,
  projectId,
  allowedStatuses,
  selectedIds,
  onRowClick,
  onSelectRow,
  onContextMenuSelectRow,
  expandedIds,
  toggleExpanded,
  isDndEnabled,
  canUpdateTask = true,
  reorderTasks,
  reorderMultiple,
  setParent,
  setParentMultiple,
  addTaskValue,
  onAddTaskChange,
  onAddTaskKeyDown,
  onAddTaskBlur,
  getAddTaskInputValue,
  onAddTaskInputChange,
  onAddTaskInputKeyDown,
  onAddTaskInputBlur,
  onInlineDraftChange,
  onInlineDraftCommit,
  onInlineDraftCancel,
  defaultParentId,
  updateTask,
  deleteTask,
  archiveTask,
  unarchiveTask,
  addTask,
  beginInlineTaskDraft,
  focusInput,
  getAdjacentId,
  getPreviousTaskId,
  onDuplicate,
  onUpdateStatus,
  onOpenDetails,
  onBulkContextUpdateStatus,
  onBulkContextUpdatePriority,
  onBulkContextUpdateAssignee,
  onBulkContextUpdateLabel,
  onBulkContextArchive,
  onBulkContextUnarchive,
  onBulkContextDelete,
  onInviteClick,
  onAddAgentClick,
  maxHeight,
  compact = false,
  showTaskRank = false,
  showResourceCount = true,
  hiddenTaskTableColumns = EMPTY_HIDDEN_TASK_TABLE_COLUMNS,
  registerAddTaskInput,
  allowAddTask = true,
  archiveFilter,
  doneTaskCount,
  onArchiveAllDone,
  onCollapseAll,
  canMoveClosedToBottom,
  onMoveClosedToBottom,
  activeRootTaskCount,
  onMoveActiveToList,
  moveSourceListRef,
  shortcutPalette,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: TaskTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Resizable name (task title) column. Only active in full (non-compact) mode
  // at the @4xl breakpoint. In auto mode the column flexes to fill (responsive,
  // the default); in fixed mode the --task-name-w CSS variable below applies.
  const { nameWidth, isAutoWidth, isResizing, guideLeft, handleResizeStart, cycleWidth, resetToAuto } =
    useNameColumnResize(parentRef, projectId);
  // Swap the name column's flex/fixed styles based on the active sizing mode.
  // Both are module constants, so the reference is stable per mode (which the row
  // memo's identity check relies on); dragging only changes the CSS var, not this.
  const columnStyles = isAutoWidth ? COLUMN_STYLES_AUTO : COLUMN_STYLES;
  // Bottom add-task row is parent-scoped in subtask tables (see OS-884).
  const bottomAddRowDropTargetId = getBottomAddRowDropTargetId(defaultParentId);
  // Buffer virtualizer count while scrolling to avoid react-virtual sync flushes
  // when paginated archived rows arrive mid-scroll.
  const [virtualizedCount, setVirtualizedCount] = useState(tasks.length);

  const effectiveVirtualizedCount = onLoadMore
    ? Math.min(virtualizedCount, tasks.length)
    : tasks.length;

  // Filter out add-task placeholders to get actual tasks for TanStack Table and DnD
  const actualTasks = useMemo(
    () =>
      tasks.filter(
        (row): row is TaskTreeNode =>
          !isTaskSectionRow(row) && !isAddTaskPlaceholder(row) && !isInlineTaskDraftRow(row)
      ),
    [tasks]
  );

  const resourceDrop = useResourceTaskDrop(projectId);

  // DnD hook
  const {
    draggedId,
    dropPosition,
    dragImageRef,
    setDropPosition,
    handleDragStart,
    handleDragOver,
    handleContainerDragOver,
    handleContainerDrop,
    handleDragEnd,
    handleDrop,
    handleMobileDragPointerDown,
    handleMobileContextMenu,
    shouldSuppressNextClick,
  } = useTableDnd({
    onGroupDrop,
    tasks: actualTasks,
    taskTree,
    selectedIds,
    isDndEnabled,
    projectId,
    resourceDrop: canUpdateTask ? resourceDrop : undefined,
    reorderTasks,
    reorderMultiple,
    setParent,
    setParentMultiple,
  });

  const contextMenuSelectionActions = useMemo<
    TaskContextMenuSelectionActions | undefined
  >(() => {
    if (
      selectedIds.size <= 1 ||
      !onBulkContextUpdateStatus ||
      !onBulkContextDelete
    ) {
      return undefined;
    }

    return {
      selectedCount: selectedIds.size,
      onUpdateStatus: onBulkContextUpdateStatus,
      onUpdatePriority: onBulkContextUpdatePriority,
      onUpdateAssignee: onBulkContextUpdateAssignee,
      onUpdateLabel: onBulkContextUpdateLabel,
      onArchive: onBulkContextArchive,
      onUnarchive: onBulkContextUnarchive,
      onDelete: onBulkContextDelete,
    };
  }, [
    onBulkContextArchive,
    onBulkContextDelete,
    onBulkContextUnarchive,
    onBulkContextUpdateStatus,
    onBulkContextUpdatePriority,
    onBulkContextUpdateAssignee,
    onBulkContextUpdateLabel,
    selectedIds.size,
  ]);

  // Profiler
  const shouldProfile = useMemo(() => {
    return readLocalString("task:perf") === "1";
  }, []);

  const handleProfilerRender = useCallback(
    (
      id: string,
      phase: "mount" | "update" | "nested-update",
      actualDuration: number,
      baseDuration: number
    ) => {
      if (!shouldProfile) return;
      if (phase !== "update") return;
      console.log(
        `[Profiler:${id}] ${phase} actual=${actualDuration.toFixed(2)}ms base=${baseDuration.toFixed(2)}ms`
      );
    },
    [shouldProfile]
  );

  const shortcutPaletteView = shortcutPalette ? (
    <ShortcutPaletteView
      shortcutPalette={shortcutPalette}
      anchorRef={parentRef}
    />
  ) : null;

  // Shared labels for the Label column — one subscription per table, cells
  // resolve by id from the map. Skipped while the column is hidden.
  const isLabelColumnHidden = hiddenTaskTableColumns.includes("label");
  const { labels: projectLabels, labelsById: projectLabelsById } = useProjectLabels(
    isLabelColumnHidden ? undefined : projectId
  );
  // The Runs column opens threads only with threads access (one subscription per table).
  const { canUseThreads } = useProjectPermissions(projectId ?? null);

  // Columns
  // Includes every flag the column cell closures depend on, so memoized rows
  // rerender when the column definitions change. Label renames/recolors flow
  // through the version string too, since rows memo on the task alone.
  const labelsVersion = projectLabels
    .map((label) => `${label._id}${label.name}${label.color}`)
    .join(",");
  const hiddenTaskTableColumnsVersion = `${hiddenTaskTableColumns.join("|")}:${showResourceCount}:${canUpdateTask}:${canUseThreads}:${labelsVersion}`;
  const columns = useMemo(
    () => createColumns(inputRefs, showTaskRank, hiddenTaskTableColumns, showResourceCount),
    [inputRefs, showTaskRank, hiddenTaskTableColumns, showResourceCount]
  );

  // Table meta
  const tableMeta = useMemo(
    () => ({
      updateTask,
      deleteTask,
      beginInlineTaskDraft,
      focusInput,
      getAdjacentId,
      statusFilter,
      assigneeFilter,
      currentUserId,
      projectId,
      allowedStatuses,
      onInviteClick,
      onAddAgentClick,
      expandedIds,
      toggleExpanded,
      defaultParentId,
      archiveFilter,
      doneTaskCount,
      onArchiveAllDone,
      onCollapseAll,
      canMoveClosedToBottom,
      onMoveClosedToBottom,
      activeRootTaskCount,
      onMoveActiveToList,
      moveSourceListRef,
      isNameColumnAutoWidth: isAutoWidth,
      onSetNameColumnAutoWidth: resetToAuto,
      projectLabels,
      projectLabelsById,
      canUpdateTask,
      canUseThreads,
    }),
    [
      updateTask,
      deleteTask,
      beginInlineTaskDraft,
      focusInput,
      getAdjacentId,
      statusFilter,
      assigneeFilter,
      currentUserId,
      projectId,
      allowedStatuses,
      onInviteClick,
      onAddAgentClick,
      expandedIds,
      toggleExpanded,
      defaultParentId,
      archiveFilter,
      doneTaskCount,
      onArchiveAllDone,
      onCollapseAll,
      canMoveClosedToBottom,
      onMoveClosedToBottom,
      activeRootTaskCount,
      onMoveActiveToList,
      moveSourceListRef,
      isAutoWidth,
      resetToAuto,
      projectLabels,
      projectLabelsById,
      canUpdateTask,
      canUseThreads,
    ]
  );

  // Table instance - uses actualTasks (without placeholders)
  // Note: Filtering is done upstream in useTaskTableController, not here
  const table = useReactTable({
    data: actualTasks,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    onRowSelectionChange: (updater) => {
      const newValue = typeof updater === "function" ? updater(rowSelection) : updater;
      onRowSelectionChange(newValue);
    },
    onSortingChange: (updater) => {
      const newValue = typeof updater === "function" ? updater(sorting) : updater;
      onSortingChange(newValue);
    },
    state: {
      rowSelection,
      sorting,
    },
    getRowId: (row) => row.clientId,
    meta: tableMeta,
  });

  const { rows } = table.getRowModel();
  const statusOptionsVersion = useMemo(
    () => allowedStatuses?.join("|") ?? "",
    [allowedStatuses]
  );
  // Build a map from clientId to TanStack row for quick lookup
  const rowMap = useMemo(() => {
    const map = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      map.set(row.original.clientId, row);
    }
    return map;
  }, [rows]);

  const virtualizer = useTaskTableVirtualizer(tasks, effectiveVirtualizedCount, parentRef, renderSectionRow !== undefined, focusRequest);

  const virtualRows = virtualizer.getVirtualItems();

  // Infinite scroll: load more when the last visible row is near the end of loaded data.
  // Uses the virtualizer's own state instead of scroll listeners to avoid flushSync
  // conflicts with @tanstack/react-virtual's internal measurement cycle.
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const isNearEnd = lastVirtualRow
    ? lastVirtualRow.index >= effectiveVirtualizedCount - 5
    : effectiveVirtualizedCount === 0;
  const isVirtualizerScrolling = virtualizer.isScrolling;
  const hasBufferedRows = tasks.length > effectiveVirtualizedCount;

  useEffect(() => {
    if (onLoadMore && isVirtualizerScrolling) return;
    if (virtualizedCount === tasks.length) return;
    setVirtualizedCount(tasks.length);
  }, [onLoadMore, isVirtualizerScrolling, tasks.length, virtualizedCount]);

  useEffect(() => {
    if (!onLoadMore) return;

    if (
      !shouldTriggerInfiniteLoad({
        onLoadMore,
        hasMore,
        isLoadingMore,
        isNearEnd,
        isVirtualizerScrolling,
        hasBufferedRows,
      })
    ) {
      return;
    }

    const loadMore = onLoadMore;
    const timerId = setTimeout(() => {
      loadMore();
    }, 0);
    return () => clearTimeout(timerId);
  }, [onLoadMore, hasMore, isLoadingMore, isNearEnd, isVirtualizerScrolling, hasBufferedRows]);

  return (
    <TaskContextMenuProvider
      projectId={projectId}
      allowedStatuses={allowedStatuses}
      updateTask={updateTask}
      onInviteClick={onInviteClick}
      onAddAgentClick={onAddAgentClick}
    >
      {/* Hidden drag image element */}
      <div
        ref={dragImageRef}
        className="fixed -top-[1000px] bg-background border border-border shadow-lg rounded px-3 py-2 text-sm"
      />

      <Profiler id="TaskTable" onRender={handleProfilerRender}>
        {/* Single scroll container owns both axes so the sticky header and the
            virtualized rows share the same content width. Without this, the
            body's vertical scrollbar (Windows/classic scrollbars) steals
            horizontal width from data rows while the header keeps full width,
            visibly misaligning the columns (OS-849). */}
        <div
          ref={parentRef}
          data-task-table-scroll-container
          className={cn(
            "relative overflow-y-auto",
            !compact && "@container overflow-x-auto",
            isResizing && "cursor-col-resize select-none"
          )}
          style={{
            height: maxHeight ?? (compact ? "auto" : "100%"),
            // Only set the fixed-width variables in fixed mode; auto mode flexes.
            // `--task-name-min-w` drives the CSS floor from the single source of
            // truth (MIN_NAME_COLUMN_WIDTH) instead of a hardcoded class value.
            ...(!compact && nameWidth !== null
              ? ({
                  "--task-name-w": `${nameWidth}px`,
                  "--task-name-min-w": `${MIN_NAME_COLUMN_WIDTH}px`,
                } as React.CSSProperties)
              : {}),
          }}
          onDragOver={(e) => handleContainerDragOver(e, parentRef.current)}
          onDrop={handleContainerDrop}
        >
          {shortcutPaletteView}
          {/* Fixed mode: at @4xl the table sizes to its columns (`w-max`) so the
              scroll container can scroll horizontally to reach every column when
              the window is too narrow to fit them — while `min-w-full` keeps it
              filling the container (leftover space empty) when there's room.
              Auto mode stays fully responsive (name column flexes), so it keeps
              the plain `min-w-[800px]` floor and never forces horizontal scroll.
              `relative` anchors the resize guide so it spans the table's full
              content height (see guide below). */}
          <TableDiv
            className={cn(
              !compact && "relative min-w-[800px]",
              !compact && !isAutoWidth && "@4xl:w-max @4xl:min-w-full"
            )}
          >
            {/* Drag guide for name-column resize (drop to apply). Lives inside
                TableDiv (not the scroll container) so `top-0 bottom-0` spans the
                full content height: it stays visible across the viewport even
                when the list is scrolled vertically. `left` is in content
                coordinates (includes scrollLeft) so it tracks the column edge
                when scrolled horizontally too. */}
            {!compact && isResizing && guideLeft !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-info"
                style={{ left: guideLeft }}
              />
            )}
            {/* Header: hidden in compact mode, sticky inside the scroll
                container in full mode so it stays aligned with data rows. */}
            <TableDivHeader
              className={cn(
                compact && "hidden",
                "sticky top-0 z-10 bg-background"
              )}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <TableDivRow
                  key={headerGroup.id}
                  className="border-b border-border bg-background hover:bg-background"
                >
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const colStyle = columnStyles[header.id];
                    const isNameColumn = header.id === "name";
                    return (
                      <TableDivHead
                        key={header.id}
                        className={cn(
                          "text-xs font-medium text-muted-foreground",
                          isNameColumn && "relative",
                          colStyle?.header
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            className="flex items-center gap-1 hover:text-foreground"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : sorted === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                        {/* Drag handle to resize the name column (full mode only). */}
                        {isNameColumn && (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize task name column"
                            title="Drag to resize · double-click to shrink, again for auto width"
                            onPointerDown={handleResizeStart}
                            onDoubleClick={cycleWidth}
                            className={cn(
                              "absolute right-0 top-0 hidden h-full w-2 translate-x-1/2 cursor-col-resize touch-none @4xl:block",
                              "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-info/50",
                              isResizing && "after:bg-info"
                            )}
                          />
                        )}
                      </TableDivHead>
                    );
                  })}
                </TableDivRow>
              ))}
            </TableDivHeader>

            <TableDivBody>
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                  {virtualRows.map((virtualRow) => {
                    const item = tasks[virtualRow.index];

                    if (isTaskSectionRow(item)) {
                      const header = isGroupHeaderRow(item);
                      // Headers and "Add task..." footers accept task drops for their group.
                      const groupDrop = isDndEnabled && getTaskGroupTarget(item.clientId) !== null;
                      return (
                        <div
                          key={item.clientId}
                          data-task-group-id={header ? item.clientId : undefined}
                          onDragOver={groupDrop ? event => handleDragOver(event, item.clientId) : undefined}
                          onDrop={groupDrop ? event => handleDrop(event, item.clientId) : undefined}
                          className={cn(
                            "absolute left-0 right-0",
                            dropPosition?.targetId === item.clientId &&
                              (header
                                ? "ring-2 ring-inset ring-primary"
                                : "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-info before:z-20")
                          )}
                          style={{
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderSectionRow?.(item)}
                        </div>
                      );
                    }

                    // Render inline add-task placeholder row
                    if (isAddTaskPlaceholder(item)) {
                      return (
                        <div
                          key={item.clientId}
                          className="absolute left-0 right-0"
                          style={{
                            ...getRowStyle?.(item),
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <AddTaskRow
                            parentId={item.parentId}
                            depth={item.depth}
                            placeholder="Add subtask..."
                            value={getAddTaskInputValue?.(item.clientId)}
                            onChange={
                              onAddTaskInputChange
                                ? (value) => onAddTaskInputChange(item.clientId, value)
                                : undefined
                            }
                            onKeyDown={
                              onAddTaskInputKeyDown
                                ? (e) =>
                                    onAddTaskInputKeyDown(
                                      item.clientId,
                                      item.parentId,
                                      e
                                    )
                                : undefined
                            }
                            onBlur={
                              onAddTaskInputBlur
                                ? () =>
                                    onAddTaskInputBlur(
                                      item.clientId,
                                      item.parentId
                                    )
                                : undefined
                            }
                            addTask={addTask}
                            statusFilter={statusFilter}
                            assigneeFilter={assigneeFilter}
                            currentUserId={currentUserId}
                            isDropTarget={dropPosition?.targetId === item.clientId && draggedId !== null}
                            onDragOver={(e: React.DragEvent) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDropPosition({ targetId: item.clientId, position: "before" });
                            }}
                            onDragLeave={() => setDropPosition(null)}
                            onDrop={(e: React.DragEvent) => handleDrop(e, item.clientId)}
                            clientId={item.clientId}
                            registerInput={registerAddTaskInput}
                            onNavigatePrevious={
                              onAddTaskInputKeyDown
                                ? undefined
                                : () => {
                                    const prevId = getPreviousTaskId(item.clientId);
                                    if (prevId) focusInput(prevId, "end");
                                  }
                            }
                          />
                        </div>
                      );
                    }

                    if (isInlineTaskDraftRow(item)) {
                      return (
                        <div
                          key={item.clientId}
                          className="absolute left-0 right-0"
                          style={{
                            ...getRowStyle?.(item),
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <AddTaskRow
                            parentId={item.parentId}
                            depth={item.depth}
                            value={item.value}
                            onChange={onInlineDraftChange}
                            onCommit={onInlineDraftCommit}
                            onCancel={onInlineDraftCancel}
                            clientId={item.clientId}
                            registerInput={registerAddTaskInput}
                            onNavigatePrevious={() => {
                              const prevId = getPreviousTaskId(item.clientId);
                              if (prevId) focusInput(prevId, "end");
                            }}
                          />
                        </div>
                      );
                    }

                    // Render task row
                    const row = rowMap.get(item.clientId);
                    if (!row) return null; // Shouldn't happen if data is consistent

                    const task = row.original;
                    return (
                      <MemoizedTaskRow
                        key={row.id}
                        row={row}
                        virtualStart={virtualRow.start}
                        virtualSize={virtualRow.size}
                        style={getRowStyle?.(item)}
                        statusOptionsVersion={statusOptionsVersion}
                        visibleColumnsVersion={hiddenTaskTableColumnsVersion}
                        isDragging={draggedId === task.clientId}
                        dropIndicator={
                          dropPosition?.targetId === task.clientId && draggedId !== task.clientId
                            ? dropPosition.position
                            : null
                        }
                        isSelected={selectedIds.has(task.clientId)}
                        isDndEnabled={isDndEnabled}
                        columnStyles={columnStyles}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragEnd={handleDragEnd}
                        onDrop={handleDrop}
                        onMobileDragPointerDown={handleMobileDragPointerDown}
                        onMobileContextMenu={handleMobileContextMenu}
                        shouldSuppressNextClick={shouldSuppressNextClick}
                        onRowClick={onRowClick}
                        onSelectRow={onSelectRow}
                        onContextMenuSelectRow={onContextMenuSelectRow}
                        onDelete={deleteTask}
                        onArchive={archiveTask}
                        onUnarchive={unarchiveTask}
                        onDuplicate={onDuplicate}
                        onUpdateStatus={onUpdateStatus}
                        onOpenDetails={onOpenDetails}
                        selectionActions={
                          selectedIds.has(task.clientId)
                            ? contextMenuSelectionActions
                            : undefined
                        }
                        registerRow={registerRow}
                        readOnly={!canUpdateTask}
                      />
                    );
                  })}
                </div>
                {/* Loading indicator for infinite scroll */}
                {isLoadingMore && (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Spinner
                      text="Loading more…"
                      textPlacement="inline"
                      className="text-muted-foreground"
                      textClassName="text-current"
                    />
                  </div>
                )}
                {/* Add task row at the bottom - also serves as drop zone for root-level tasks */}
                {allowAddTask && (
                  <AddTaskRow
                    value={addTaskValue}
                    onChange={onAddTaskChange}
                    onKeyDown={onAddTaskKeyDown}
                    onBlur={onAddTaskBlur}
                    isDropTarget={dropPosition?.targetId === bottomAddRowDropTargetId && draggedId !== null}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropPosition({ targetId: bottomAddRowDropTargetId, position: "before" });
                    }}
                    onDragLeave={() => setDropPosition(null)}
                    onDrop={(e) => handleDrop(e, bottomAddRowDropTargetId)}
                    // clientId is the keyboard-nav / input-registration identity and must stay the
                    // literal "add-root" the controller registers. It intentionally diverges from
                    // bottomAddRowDropTargetId, which is parent-scoped for drop handling (OS-884).
                    // Do not align them.
                    clientId="add-root"
                    registerInput={registerAddTaskInput}
                  />
                )}
                {allowAddTask && !compact && (
                  <>
                    <div
                      aria-hidden="true"
                      className="md:hidden"
                      style={{ height: MOBILE_BOTTOM_ADD_TASK_SCROLL_PADDING_PX }}
                    />
                    <div
                      aria-hidden="true"
                      className="hidden md:block"
                      style={{ height: BOTTOM_ADD_TASK_SCROLL_PADDING_PX }}
                    />
                  </>
                )}
            </TableDivBody>
          </TableDiv>
        </div>
      </Profiler>
    </TaskContextMenuProvider>
  );
}
