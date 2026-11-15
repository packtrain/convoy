import { memo, useCallback } from "react";
import { Row, flexRender } from "@tanstack/react-table";
import { GripVertical } from "lucide-react";
import { TableDivRow, TableDivCell } from "@/components/ui/table-div";
import { cn } from "@/lib/utils";
import type { Task, TaskTreeNode, Status } from "@/lib/tasks/types";
import type { TaskExternalLink } from "@/lib/tasks/external-links";
import { taskAssigneeToKey } from "@/lib/tasks/assignees";
import { isEventInsideCurrentTarget, isTaskTableInteractiveTarget } from "@/lib/tasks/table-interaction";
import {
  TASK_FIELD_DRAG_SELECTOR,
  isTaskFieldDragTarget,
} from "@/lib/tasks/hooks/use-task-field-menu";
import { COLUMN_STYLES, type ColumnStyle } from "./columns";
import {
  TaskContextMenu,
  type TaskContextMenuSelectionActions,
} from "./task-context-menu";

// Desktop rows are not draggable; native drag normally starts only from the grip handle. A
// mouse press on a task-field selector trigger arms `draggable` on it for the duration of the
// press: the trigger defers its menu open to click (use-task-field-menu), so a press that moves
// becomes a native row drag instead (OS-1381). Disarmed on release/cancel.
function armTaskFieldDrag(e: React.PointerEvent) {
  if (e.pointerType !== "mouse" || e.button !== 0 || !e.isPrimary) return;
  const trigger =
    e.target instanceof Element
      ? e.target.closest<HTMLElement>(TASK_FIELD_DRAG_SELECTOR)
      : null;
  if (!trigger) return;

  trigger.draggable = true;
  const disarm = () => {
    trigger.draggable = false;
    window.removeEventListener("pointerup", disarm);
    window.removeEventListener("pointercancel", disarm);
  };
  window.addEventListener("pointerup", disarm);
  window.addEventListener("pointercancel", disarm);
}

// Compare task data by value instead of reference (needed because buildTaskTree creates new objects)
function areTaskPullRequestLinksEqual(
  a: TaskExternalLink[] | undefined,
  b: TaskExternalLink[] | undefined
): boolean {
  if (a === b) return true;

  const aPullRequests = (a ?? []).filter(
    (
      link
    ): link is Extract<TaskExternalLink, { kind: "pull_request" }> =>
      link.kind === "pull_request"
  );
  const bPullRequests = (b ?? []).filter(
    (
      link
    ): link is Extract<TaskExternalLink, { kind: "pull_request" }> =>
      link.kind === "pull_request"
  );

  if (aPullRequests.length !== bPullRequests.length) return false;

  for (let i = 0; i < aPullRequests.length; i++) {
    const aLink = aPullRequests[i];
    const bLink = bPullRequests[i];
    if (
      aLink.id !== bLink.id ||
      aLink.url !== bLink.url ||
      aLink.title !== bLink.title ||
      aLink.identifier !== bLink.identifier
    ) {
      return false;
    }
  }

  return true;
}

export function areTasksEqual(a: Task, b: Task): boolean {
  // Fast path: same reference
  if (a === b) return true;

  const aTree = a as TaskTreeNode;
  const bTree = b as TaskTreeNode;

  // Compare primitive fields (cheapest checks first)
  if (
    a._id !== b._id ||
    a.name !== b.name ||
    a.status !== b.status ||
    a.priority !== b.priority ||
    a.dueDate !== b.dueDate ||
    a.rank !== b.rank ||
    (a.labelId ?? null) !== (b.labelId ?? null) ||
    a.isArchived !== b.isArchived ||
    (a.attachmentCount ?? 0) !== (b.attachmentCount ?? 0) ||
    (a.artifactCount ?? 0) !== (b.artifactCount ?? 0) ||
    aTree.depth !== bTree.depth ||
    aTree.hasChildren !== bTree.hasChildren ||
    aTree.childCount !== bTree.childCount ||
    aTree.completedChildCount !== bTree.completedChildCount ||
    aTree.isExpanded !== bTree.isExpanded
  ) {
    return false;
  }

  if (
    a.taskType.key !== b.taskType.key ||
    a.taskType.name !== b.taskType.name ||
    a.taskType.icon !== b.taskType.icon ||
    a.taskType.color !== b.taskType.color ||
    a.taskType.isSystem !== b.taskType.isSystem
  ) {
    return false;
  }

  // Compare nullable strings
  if (
    taskAssigneeToKey(a.assignee) !== taskAssigneeToKey(b.assignee) ||
    taskAssigneeToKey(a.delegatedToAgent) !== taskAssigneeToKey(b.delegatedToAgent) ||
    a.parentId !== b.parentId
  ) {
    return false;
  }

  // Compare tags (reference first, then length, then elements)
  if (a.tags !== b.tags) {
    if (a.tags.length !== b.tags.length) return false;
    for (let i = 0; i < a.tags.length; i++) {
      if (a.tags[i] !== b.tags[i]) return false;
    }
  }

  if (!areTaskPullRequestLinksEqual(a.externalLinks, b.externalLinks)) {
    return false;
  }

  // Compare agent thread work (drives the agent-work column badges)
  const aWork = a.agentThreadWork ?? [];
  const bWork = b.agentThreadWork ?? [];
  if (aWork !== bWork) {
    if (aWork.length !== bWork.length) return false;
    for (let i = 0; i < aWork.length; i++) {
      if (
        aWork[i].threadId !== bWork[i].threadId ||
        aWork[i].updatedAt !== bWork[i].updatedAt ||
        aWork[i].status !== bWork[i].status ||
        aWork[i].threadTitle !== bWork[i].threadTitle
      ) {
        return false;
      }
    }
  }

  return true;
}

export { ROW_HEIGHT } from "@/lib/tasks/constants";

export type DropIndicator = "before" | "inside" | "after" | null;

export interface TaskRowProps {
  row: Row<Task>;
  style?: React.CSSProperties;
  virtualStart: number;
  virtualSize: number;
  statusOptionsVersion: string;
  visibleColumnsVersion: string;
  isDragging: boolean;
  dropIndicator: DropIndicator;
  isSelected: boolean;
  isDndEnabled: boolean;
  columnStyles?: Record<string, ColumnStyle>;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onMobileDragPointerDown: (e: React.PointerEvent, id: string) => void;
  onMobileContextMenu: (e: React.MouseEvent) => void;
  shouldSuppressNextClick: () => boolean;
  onRowClick: (e: React.MouseEvent, id: string) => void;
  onSelectRow: (e: React.MouseEvent, id: string) => void;
  onContextMenuSelectRow: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDuplicate: (task: Task) => void;
  onUpdateStatus: (id: string, status: Status) => void;
  onOpenDetails: (clientId: string) => void;
  selectionActions?: TaskContextMenuSelectionActions;
  registerRow: (id: string, el: HTMLElement | null) => void;
  /** No write items in the row menu (read-only-viewer-ux.md). */
  readOnly: boolean;
}

// Inner content component - memoized separately from positioning
export interface RowContentProps {
  row: Row<Task>;
  task: Task;
  clientId: string;
  statusOptionsVersion: string;
  visibleColumnsVersion: string;
  isDragging: boolean;
  dropIndicator: DropIndicator;
  isSelected: boolean;
  isDndEnabled: boolean;
  columnStyles: Record<string, ColumnStyle>;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onMobileDragPointerDown: (e: React.PointerEvent, id: string) => void;
  onMobileContextMenu: (e: React.MouseEvent) => void;
  shouldSuppressNextClick: () => boolean;
  onRowClick: (e: React.MouseEvent, id: string) => void;
  onSelectRow: (e: React.MouseEvent, id: string) => void;
  onContextMenuSelectRow: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDuplicate: (task: Task) => void;
  onUpdateStatus: (id: string, status: Status) => void;
  onOpenDetails: (clientId: string) => void;
  selectionActions?: TaskContextMenuSelectionActions;
  registerRow: (id: string, el: HTMLElement | null) => void;
  readOnly: boolean;
}

export function shouldReuseRowContent(
  prevProps: RowContentProps,
  nextProps: RowContentProps
): boolean {
  return (
    prevProps.statusOptionsVersion === nextProps.statusOptionsVersion &&
    prevProps.visibleColumnsVersion === nextProps.visibleColumnsVersion &&
    areTasksEqual(prevProps.task, nextProps.task) &&
    prevProps.isDragging === nextProps.isDragging &&
    prevProps.dropIndicator === nextProps.dropIndicator &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isDndEnabled === nextProps.isDndEnabled &&
    prevProps.selectionActions === nextProps.selectionActions &&
    prevProps.readOnly === nextProps.readOnly &&
    // Stable within a mode (dragging only changes the CSS var, not the class
    // strings); changes only when the name column flips between auto and fixed.
    prevProps.columnStyles === nextProps.columnStyles
  );
}

const RowContent = memo(
  function RowContent(props: RowContentProps) {
    const {
      row,
      task,
      clientId,
      isDragging,
      dropIndicator,
      isSelected,
      isDndEnabled,
      columnStyles,
      onDragStart,
      onDragOver,
      onDragEnd,
      onDrop,
      onMobileDragPointerDown,
      onMobileContextMenu,
      shouldSuppressNextClick,
      onRowClick,
      onSelectRow,
      onContextMenuSelectRow,
      onDelete,
      onArchive,
      onUnarchive,
      onDuplicate,
      onUpdateStatus,
      onOpenDetails,
      selectionActions,
      registerRow,
      readOnly,
    } = props;
    const handleRowClick = useCallback(
      (e: React.MouseEvent) => {
        // Events bubbling out of overlays portalled from this row (agent
        // threads drawer, menus) are not clicks on the row itself.
        if (!isEventInsideCurrentTarget(e)) return;

        const suppressClick = shouldSuppressNextClick();
        const target = e.target as HTMLElement;
        const isInteractiveTarget = isTaskTableInteractiveTarget(target);

        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (!isInteractiveTarget) {
          (e.currentTarget as HTMLElement).focus();
        }

        onRowClick(e, clientId);
      },
      [onRowClick, clientId, shouldSuppressNextClick]
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      if (!isEventInsideCurrentTarget(e)) return;
      (e.currentTarget as HTMLElement).focus();
      onContextMenuSelectRow(clientId);
    }, [clientId, onContextMenuSelectRow]);

    return (
      <TaskContextMenu
        readOnly={readOnly}
        task={task}
        onDelete={onDelete}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDuplicate={onDuplicate}
        onUpdateStatus={onUpdateStatus}
        onOpenDetails={onOpenDetails}
        selectionActions={selectionActions}
      >
        <TableDivRow
          ref={(el) => registerRow(clientId, el)}
          data-task-row-id={clientId}
          onDragOver={(e) => onDragOver(e, clientId)}
          onDrop={(e) => onDrop(e, clientId)}
          onDragStart={(e) => {
            // Only drags armed from a task-field trigger; the grip handle has
            // its own handler and other row content is not draggable.
            if (!isTaskFieldDragTarget(e.target)) return;
            onDragStart(e, clientId);
          }}
          onDragEnd={onDragEnd}
          onPointerDown={(e) => {
            if (!isEventInsideCurrentTarget(e)) return;
            if (isDndEnabled) armTaskFieldDrag(e);
            onMobileDragPointerDown(e, clientId);
          }}
          onContextMenuCapture={onMobileContextMenu}
          onContextMenu={handleContextMenu}
          onClick={handleRowClick}
          tabIndex={0}
          style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
          className={cn(
            "group cursor-pointer outline-none w-full h-full border-b border-border",
            // Selection styling (disable hover when focused to avoid ring/bg mismatch)
            isSelected
              ? "bg-accent after:absolute after:left-0 after:top-0 after:bottom-0 after:w-0.5 after:bg-info"
              : "hover:bg-muted/50",
            // Archived styling - amber background + reduced opacity for all content
            task.isArchived && !isSelected && "bg-amber-50/50 dark:bg-amber-950/30 hover:bg-amber-100/50 dark:hover:bg-amber-950/50",
            task.isArchived && "[&>*]:opacity-60",
            // Focus styling (inset so it's not clipped on first/last rows)
            "ring-0 focus:ring-1 focus:ring-inset focus:ring-info focus:z-10",
            "focus-within:ring-1 focus-within:ring-inset focus-within:ring-info focus-within:z-10",
            // Drag styling
            isDragging && "opacity-50 bg-muted",
            // Drop indicators based on position
            dropIndicator === "before" &&
              "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-info before:z-20",
            dropIndicator === "after" &&
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-info after:z-20",
            dropIndicator === "inside" &&
              "bg-info/10 ring-1 ring-inset ring-info"
          )}
        >
          {row.getVisibleCells().map((cell) => {
            const colStyle = columnStyles[cell.column.id];
            return (
              <TableDivCell key={cell.id} data-column-id={cell.column.id} className={colStyle?.cell}>
                {cell.column.id === "drag" ? (
                  isDndEnabled ? (
                    <button
                      type="button"
                      aria-label="Drag to reorder"
                      data-drag-handle
                      draggable
                      onDragStart={(e) => onDragStart(e, clientId)}
                      onDragEnd={onDragEnd}
                      onClick={(e) => onSelectRow(e, clientId)}
                      className="touch-none [@media(pointer:coarse)]:pointer-events-none flex items-center justify-center h-full w-full cursor-pointer cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                    </button>
                  ) : null
                ) : (
                  flexRender(cell.column.columnDef.cell, cell.getContext())
                )}
              </TableDivCell>
            );
          })}
        </TableDivRow>
      </TaskContextMenu>
    );
  },
  // Compare content-relevant props only (not position)
  shouldReuseRowContent
);

// Outer wrapper - handles positioning only (cheap to re-render)
export function MemoizedTaskRow({
  row,
  virtualStart,
  virtualSize,
  statusOptionsVersion,
  visibleColumnsVersion,
  isDragging,
  dropIndicator,
  isSelected,
  isDndEnabled,
  columnStyles = COLUMN_STYLES,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onMobileDragPointerDown,
  onMobileContextMenu,
  shouldSuppressNextClick,
  onRowClick,
  onSelectRow,
  onContextMenuSelectRow,
  onDelete,
  onArchive,
  onUnarchive,
  onDuplicate,
  onUpdateStatus,
  onOpenDetails,
  selectionActions,
  registerRow,
  readOnly,
  style,
}: TaskRowProps) {
  const clientId = row.original.clientId;

  return (
    <div
      className="absolute left-0 right-0"
      style={{
        ...style,
        height: `${virtualSize}px`,
        transform: `translateY(${virtualStart}px)`,
      }}
    >
      <RowContent
        row={row}
        task={row.original}
        clientId={clientId}
        statusOptionsVersion={statusOptionsVersion}
        visibleColumnsVersion={visibleColumnsVersion}
        isDragging={isDragging}
        dropIndicator={dropIndicator}
        isSelected={isSelected}
        isDndEnabled={isDndEnabled}
        columnStyles={columnStyles}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        onMobileDragPointerDown={onMobileDragPointerDown}
        onMobileContextMenu={onMobileContextMenu}
        shouldSuppressNextClick={shouldSuppressNextClick}
        onRowClick={onRowClick}
        onSelectRow={onSelectRow}
        onContextMenuSelectRow={onContextMenuSelectRow}
        onDelete={onDelete}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDuplicate={onDuplicate}
        onUpdateStatus={onUpdateStatus}
        onOpenDetails={onOpenDetails}
        selectionActions={selectionActions}
        registerRow={registerRow}
        readOnly={readOnly}
      />
    </div>
  );
}
