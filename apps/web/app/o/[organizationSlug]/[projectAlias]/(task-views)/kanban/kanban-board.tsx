"use client";

import { useCallback, useMemo, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { BoardAddLabel } from "./board-add-label";
import { BoardColumn, type BoardColumnData } from "@/components/blocks/board/board-column";
import { BoardDndCard } from "./board-dnd-card";
import { BoardDndColumn } from "./board-dnd-column";
import { useBoardShortcuts } from "./use-board-shortcuts";
import { BoardLayout } from "@/components/blocks/board/board-layout";
import { BoardSwimlanes } from "@/components/blocks/board/board-swimlanes";
import { boardColumnDragId, boardColumnReorderDropId, getBoardMoveUpdates, planBoardColumnReorder } from "./board-dnd-planning";
import {
  useBoardDnd,
  type BoardColumnDropSide,
  type TaskMakeSubtaskFn,
  type TaskMoveFn,
} from "./use-board-dnd";
import {
  useBoardExternalTaskDrop,
  type ExternalTasksDropFn,
  type ExternalTasksDropIntoFn,
} from "./use-board-external-task-drop";
import { CreateTaskLabelDialog } from "@/components/blocks/tasks/create-task-label-dialog";
import { KanbanCard } from "@/components/blocks/tasks/kanban-card";
import { TaskContextMenu, TaskContextMenuProvider } from "@/components/blocks/tasks/task-table/task-context-menu";
import { TaskShortcutPicker } from "@/components/blocks/tasks/task-shortcut-picker";
import type {
  KanbanCardItem,
} from "@/components/blocks/tasks/kanban-card";
import { createDefaultTaskFromInput, getFilterDefaultsFromFilters } from "@/lib/tasks/defaults";
import { MAX_LABELS_PER_PROJECT } from "@/lib/tasks/constants";
import { useShowCardDescription } from "@/lib/tasks/card-view-prefs";
import { type Status as TaskStatus } from "@/lib/tasks/status";
import type { Id } from "@/convex/_generated/dataModel";
import type { BoardGroupBy, BoardRowGroupBy } from "@/lib/navigation/project-state";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type {
  AddTaskOptions,
  AssigneeFilter,
  ReorderTasksFn,
  StatusFilterKey,
  Task,
  TaskTreeNode,
  TaskUpdate,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/** Card right-click menu actions; mirrors the task table row context menu. */
export interface KanbanCardContextMenuActions {
  readOnly?: boolean;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDuplicate: (task: Task) => void;
  onUpdateStatus: (id: string, status: TaskStatus) => void;
  onOpenDetails: (clientId: string) => void;
}

import { buildBoardCells, buildBoardTaskColumns, NO_LABEL_COLUMN_ID, useCollapsedGroups, type BoardAssignableUser, type BoardAssignableProjectAgent, type BoardLabel, type BoardTaskColumn, type SectionBoard } from "@/components/blocks/task-grouping";
export type { BoardAssignableUser, BoardAssignableProjectAgent, BoardTaskColumn, BoardLabel, BoardStatusColumn, BoardStatusColumnConfig } from "@/components/blocks/task-grouping";

const LABEL_COLUMN_PREFIX = "label:";
// Stable default: an inline `[]` would rebuild the column model every render.
const NO_LABELS: readonly BoardLabel[] = [];

function labelIdFromColumnId(columnId: string): string | null {
  if (columnId === NO_LABEL_COLUMN_ID || !columnId.startsWith(LABEL_COLUMN_PREFIX)) {
    return null;
  }
  return columnId.slice(LABEL_COLUMN_PREFIX.length);
}

/**
 * Draggable + drop-target shell for label-grouping columns: the whole column
 * header is the drag handle, and the blue drop line marks the boundary the
 * dragged column will land on.
 */
function ColumnReorderShell({
  columnId,
  dragEnabled,
  dropIndicatorSide,
  children,
}: {
  columnId: string;
  dragEnabled: boolean;
  dropIndicatorSide: BoardColumnDropSide | null;
  children: (drag: {
    containerRef: Ref<HTMLElement>;
    headerDragHandleProps?: HTMLAttributes<HTMLElement>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: boardColumnDragId(columnId),
    disabled: !dragEnabled,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: boardColumnReorderDropId(columnId),
  });

  return (
    // `flex` keeps the column height chain intact: this div is the stretched
    // flex item, and the column section's min-h-full resolves through it.
    <div ref={setDropRef} className="relative flex">
      {dropIndicatorSide ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 z-20 w-0.5 rounded-full bg-blue-500",
            dropIndicatorSide === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
          )}
        />
      ) : null}
      {children({
        containerRef: setNodeRef,
        headerDragHandleProps: dragEnabled ? { ...attributes, ...listeners } : undefined,
        isDragging,
      })}
    </div>
  );
}

export function KanbanBoard({
  tasks = [],
  taskTree,
  boardGroupBy = "status",
  boardRowGroupBy = "none",
  listRef = null,
  assignableUsers,
  projectAgents,
  allowedStatuses,
  labels = NO_LABELS,
  statusFilter,
  assigneeFilter,
  currentUserId,
  projectId,
  hiddenTaskTableColumns,
  onTaskUpdate,
  onInviteClick,
  onAddAgentClick,
  onTaskClick,
  onTaskCreate,
  onTaskReorder,
  onTaskMove,
  onTaskMakeSubtask,
  onExternalTasksDrop,
  onExternalTasksDropInto,
  onLabelReorder,
  canCreateLabel = false,
  sectionBoard,
  cardContextMenu,
  scrollEndPaddingPx = 0,
}: {
  tasks?: Task[];
  taskTree?: TaskTreeNode[];
  boardGroupBy?: BoardGroupBy;
  /** Optional horizontal rows; each card sits in a row × column cell. */
  boardRowGroupBy?: BoardRowGroupBy;
  /** Scopes the per-user row collapse state. */
  listRef?: string | null;
  assignableUsers?: readonly BoardAssignableUser[];
  projectAgents?: readonly BoardAssignableProjectAgent[];
  allowedStatuses?: TaskStatus[];
  labels?: readonly BoardLabel[];
  statusFilter?: StatusFilterKey;
  assigneeFilter?: AssigneeFilter;
  currentUserId?: string;
  projectId?: Id<"projects">;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  onTaskUpdate?: (taskId: Task["_id"], updates: TaskUpdate) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  onTaskClick?: (task: Task) => void;
  onTaskCreate?: (
    task: Omit<Task, "_id" | "clientId">,
    options?: AddTaskOptions
  ) => string | null;
  onTaskReorder?: ReorderTasksFn;
  onTaskMove?: TaskMoveFn;
  /** Dropping a card onto another card's center makes it that card's subtask. */
  onTaskMakeSubtask?: TaskMakeSubtaskFn;
  /** Native cross-surface drop (e.g. sidebar subtasks): promote to root + apply column field. */
  onExternalTasksDrop?: ExternalTasksDropFn;
  /** Native cross-surface drop onto a card center: make subtasks of that card. */
  onExternalTasksDropInto?: ExternalTasksDropIntoFn;
  /** Label-grouping column reorder: receives the label id and its new LexoRank. */
  onLabelReorder?: (labelId: Id<"projectLabels">, rank: string) => void;
  /** Enables the trailing "+" that creates a label (= a new column) in label grouping. */
  canCreateLabel?: boolean;
  /** Section grouping: List sections plus their header, reorder and add wiring. */
  sectionBoard?: SectionBoard;
  cardContextMenu?: KanbanCardContextMenuActions;
  /** Extra horizontal scroll space, e.g. the width of the open task sidebar. */
  scrollEndPaddingPx?: number;
}) {
  // Cached so drag state changes keep card objects, letting memoized cards skip.
  const sections = sectionBoard?.sections;
  const grid = useMemo(() => {
    const args = {
      boardGroupBy,
      assignableUsers,
      projectAgents,
      allowedStatuses,
      labels,
      sections,
      tasks,
      taskTree,
      statusFilter,
      assigneeFilter,
      currentUserId,
    };
    return boardRowGroupBy === "none"
      ? { rows: null, columns: buildBoardTaskColumns(args), cells: null }
      : buildBoardCells({ ...args, boardRowGroupBy });
  }, [
    boardGroupBy,
    boardRowGroupBy,
    assignableUsers,
    projectAgents,
    allowedStatuses,
    labels,
    sections,
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  ]);
  const boardColumns = grid.columns;
  const [showDescription] = useShowCardDescription();
  const updateTaskById = useCallback(
    (id: string, updates: TaskUpdate) => onTaskUpdate?.(id as Task["_id"], updates),
    [onTaskUpdate]
  );
  const { shortcutRequest, closeShortcutRequest } = useBoardShortcuts({
    tasks,
    currentUserId,
    onTaskUpdate,
  });
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [String(label._id), label])),
    [labels]
  );
  // Drop and create targets: the cells when rows are on, else the columns.
  const targets: BoardTaskColumn[] = grid.cells ?? boardColumns;
  const rowCollapse = useCollapsedGroups(
    `board-rows:${currentUserId ?? "anonymous"}:${projectId}:${listRef ?? "default"}:${boardRowGroupBy}`
  );
  // Column decorations, reordering and add affordances are column-only.
  const sectionGrouping = boardGroupBy === "section" && !grid.rows ? sectionBoard : undefined;
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  // Label columns are editable in place: the header count swaps for a pencil.
  const [editingLabel, setEditingLabel] = useState<BoardLabel | null>(null);
  const editableLabelsByColumnId = new Map<string, BoardLabel>(
    boardGroupBy === "label" && canCreateLabel && !grid.rows
      ? labels.map((label) => [`${LABEL_COLUMN_PREFIX}${String(label._id)}`, label])
      : []
  );

  // Column reordering = label reordering; only label columns drag, and only
  // in label grouping. Drops around "No label" (always first) mean "the start".
  const areColumnsReorderable =
    (boardGroupBy === "label" && !grid.rows && Boolean(onLabelReorder)) || Boolean(sectionGrouping?.reorder);
  const handleColumnReorder = (columnId: string, targetColumnId: string, side: BoardColumnDropSide) => {
    if (sectionGrouping?.reorder) return sectionGrouping.reorder(columnId, targetColumnId, side);
    if (!onLabelReorder) return;
    const draggedId = labelIdFromColumnId(columnId);
    if (!draggedId) return;

    const plan = planBoardColumnReorder({
      orderedRanks: labels.map((label) => ({ id: String(label._id), rank: label.rank })),
      draggedLabelId: draggedId,
      targetLabelId: labelIdFromColumnId(targetColumnId),
      side,
    });
    if (!plan) return;

    onLabelReorder(draggedId as Id<"projectLabels">, plan.rank);
  };

  const {
    isDragEnabled,
    sensors,
    accessibility,
    collisionDetection,
    activeItem,
    activeSourceColumnId,
    activeColumnId,
    columnDropTarget,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnd({
    columns: targets,
    onTaskReorder,
    onTaskMove,
    onTaskMakeSubtask,
    onColumnReorder: areColumnsReorderable ? handleColumnReorder : undefined,
  });
  const hasActiveDrag = activeItem !== null;
  const activeColumnTitle = activeColumnId
    ? targetsById.get(activeColumnId)?.title
    : null;
  const activeSource = activeSourceColumnId ? targetsById.get(activeSourceColumnId) : undefined;
  const {
    externalDropColumnId,
    externalCardTarget,
    getColumnDropProps,
    getCardDropProps,
  } = useBoardExternalTaskDrop({
    projectId: projectId ? String(projectId) : undefined,
    onDropTasks: onExternalTasksDrop,
    onDropTasksInto: onExternalTasksDropInto,
  });

  const toColumnData = (column: BoardTaskColumn): BoardColumnData<KanbanCardItem> => {
    const editableLabel = editableLabelsByColumnId.get(column.id);

    return {
      id: column.id,
      title: column.title,
      metadata: column.metadata,
      showCount: true,
      onEdit: editableLabel ? () => setEditingLabel(editableLabel) : undefined,
      items: column.cards,
      // Cells explain why they can't take tasks, e.g. an impossible Owner × Assignee pair.
      emptyState: (grid.cells && column.createDisabledReason) || "No tasks",
      canCreate: Boolean(onTaskCreate && column.createDefaults),
      createDisabledReason: column.createDisabledReason,
      onCreateTask: (titleValue, position) => {
        if (!onTaskCreate || !column.createDefaults) {
          return;
        }

        const filterDefaults = getFilterDefaultsFromFilters(
          statusFilter ?? "all",
          assigneeFilter ?? null,
          currentUserId
        );
        const newTask = createDefaultTaskFromInput(titleValue, {
          ...filterDefaults,
          ...column.createDefaults,
        });
        if (!newTask) {
          return;
        }

        // Cards are rendered in List rank order, so first/last are the group rank extremes.
        const rankAnchor =
          position === "top"
            ? column.cards[0]?.task._id
            : column.cards[column.cards.length - 1]?.task._id;
        const options =
          position === "top" && rankAnchor
            ? { beforeId: String(rankAnchor) }
            : position === "bottom" && rankAnchor
              ? { afterId: String(rankAnchor) }
              : undefined;

        onTaskCreate(newTask, column.createOptions ? { ...options, ...column.createOptions } : options);
      },
      ...sectionGrouping?.decorate(column),
    };
  };

  const renderTarget = (column: BoardColumnData<KanbanCardItem>, isCell: boolean, drag?: {
    containerRef: Ref<HTMLElement>;
    headerDragHandleProps?: HTMLAttributes<HTMLElement>;
    isDragging: boolean;
  }) => {
    const target = targetsById.get(column.id);
    const isDropAllowed =
      hasActiveDrag &&
      (column.id === activeSourceColumnId ||
        Boolean(activeSource && target && getBoardMoveUpdates(activeSource, target)));

    return (
      <BoardDndColumn
        columnId={column.id}
        hasActiveDrag={hasActiveDrag}
        isDropAllowed={isDropAllowed}
        showTopZone={!isCell}
        externalDropProps={getColumnDropProps(column.id, target?.dropTarget)}
        // Card-level indicators take over while a card is hovered.
        isExternalDropTarget={
          externalDropColumnId === column.id && externalCardTarget === null
        }
      >
        <BoardColumn
          column={column}
          variant={isCell ? "cell" : "column"}
          containerRef={drag?.containerRef}
          headerDragHandleProps={drag?.headerDragHandleProps}
          className={cn(drag?.isDragging && "opacity-50")}
          hideCreateAffordances={hasActiveDrag}
          getItemKey={(card) => card.task.clientId}
          renderItem={(card) => {
            const cardTaskId = String(card.task._id);
            const cardContent = (
              <KanbanCard
                task={card.task}
                subtaskProgress={card.subtaskProgress}
                presentation={card.presentation}
                projectId={projectId}
                allowedStatuses={allowedStatuses}
                hiddenTaskTableColumns={hiddenTaskTableColumns}
                label={card.task.labelId ? labelsById.get(String(card.task.labelId)) : null}
                showDescription={showDescription}
                onTaskUpdate={onTaskUpdate}
                onInviteClick={onInviteClick}
                onAddAgentClick={onAddAgentClick}
                onClick={onTaskClick}
              />
            );

            return (
              <BoardDndCard
                item={card}
                isDragEnabled={isDragEnabled}
                showDropZones={isDropAllowed}
                showSubtaskDropZone={Boolean(onTaskMakeSubtask)}
                externalDropProps={getCardDropProps(cardTaskId, target?.dropTarget)}
                externalDropZone={
                  externalCardTarget?.taskId === cardTaskId
                    ? externalCardTarget.zone
                    : null
                }
              >
                {cardContextMenu ? (
                  <TaskContextMenu task={card.task} {...cardContextMenu} shortcutHints="board">
                    {/* Radix needs a DOM element trigger to attach to. */}
                    <div>{cardContent}</div>
                  </TaskContextMenu>
                ) : (
                  cardContent
                )}
              </BoardDndCard>
            );
          }}
        />
      </BoardDndColumn>
    );
  };

  const board = (
    <DndContext
      sensors={sensors}
      accessibility={accessibility}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {grid.rows ? (
        <BoardSwimlanes
          rows={grid.rows.map((row) => ({ ...row, count: row.cards.length }))}
          columns={boardColumns.map((column) => ({ ...column, count: column.cards.length }))}
          collapsedRowIds={rowCollapse.collapsed}
          onToggleRow={rowCollapse.toggle}
          className={hasActiveDrag ? "snap-none" : undefined}
          trackStyle={
            scrollEndPaddingPx > 0 ? { paddingRight: scrollEndPaddingPx } : undefined
          }
          renderCell={(row, column) => {
            const cell = targetsById.get(`${row.id}|${column.id}`);
            return cell ? renderTarget(toColumnData(cell), true) : null;
          }}
        />
      ) : (
      <BoardLayout
        columns={boardColumns.map(toColumnData)}
        // Mobile scroll snapping fights dnd auto-scroll at the container
        // edges, so it pauses while a card or column is being dragged.
        className={hasActiveDrag || activeColumnId ? "snap-none" : undefined}
        trackStyle={
          scrollEndPaddingPx > 0 ? { paddingRight: scrollEndPaddingPx } : undefined
        }
        trailing={
          sectionGrouping ? sectionGrouping.trailing : boardGroupBy === "label" && canCreateLabel && projectId ? (
            <BoardAddLabel
              projectId={projectId}
              labelCount={labels.length}
              disabledReason={
                labels.length >= MAX_LABELS_PER_PROJECT
                  ? `Projects can have up to ${MAX_LABELS_PER_PROJECT} labels`
                  : undefined
              }
            />
          ) : undefined
        }
        renderColumn={(column) => (
          <ColumnReorderShell
            columnId={column.id}
            dragEnabled={
              areColumnsReorderable &&
              (sectionGrouping ? sectionGrouping.isReorderable(column.id) : labelIdFromColumnId(column.id) !== null)
            }
            dropIndicatorSide={
              columnDropTarget?.columnId === column.id ? columnDropTarget.side : null
            }
          >
            {(drag) => renderTarget(column, false, drag)}
          </ColumnReorderShell>
        )}
      />
      )}
      <DragOverlay
        dropAnimation={null}
        // The overlay tracks the dragged node's rect (the whole column for
        // column drags), which would park the small pill at the column's left
        // edge — snap it under the cursor instead. Card drags keep the
        // rect-aligned default.
        modifiers={activeColumnTitle ? [snapCenterToCursor] : undefined}
      >
        {activeColumnTitle ? (
          <div className="w-fit cursor-grabbing rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium shadow-lg">
            {activeColumnTitle}
          </div>
        ) : null}
        {activeItem ? (
          // Mirror the board card's props so the lifted clone renders
          // pixel-identically (editable controls change footer styling).
          <KanbanCard
            task={activeItem.task}
            subtaskProgress={activeItem.subtaskProgress}
            presentation={activeItem.presentation}
            projectId={projectId}
            allowedStatuses={allowedStatuses}
            hiddenTaskTableColumns={hiddenTaskTableColumns}
            label={activeItem.task.labelId ? labelsById.get(String(activeItem.task.labelId)) : null}
            showDescription={showDescription}
            onTaskUpdate={onTaskUpdate}
            onInviteClick={onInviteClick}
            onAddAgentClick={onAddAgentClick}
            onClick={onTaskClick}
            className="shadow-lg"
          />
        ) : null}
      </DragOverlay>
      {onTaskUpdate ? (
        <TaskShortcutPicker
          request={shortcutRequest}
          projectId={projectId}
          onTaskUpdate={onTaskUpdate}
          onInviteClick={onInviteClick}
          onAddAgentClick={onAddAgentClick}
          onClose={closeShortcutRequest}
        />
      ) : null}
      {editingLabel && projectId ? (
        <CreateTaskLabelDialog
          projectId={projectId}
          label={editingLabel}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditingLabel(null);
            }
          }}
        />
      ) : null}
    </DndContext>
  );

  // Card menus get the same property submenus as table rows.
  return onTaskUpdate ? (
    <TaskContextMenuProvider
      projectId={projectId}
      allowedStatuses={allowedStatuses}
      updateTask={updateTaskById}
      onInviteClick={onInviteClick}
      onAddAgentClick={onAddAgentClick}
    >
      {board}
    </TaskContextMenuProvider>
  ) : (
    board
  );
}
