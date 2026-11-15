"use client";

import { TaskListEmptyState } from "@/components/blocks/tasks/task-list-empty-state";
import { isGroupHeaderRow } from "@/lib/tasks/types";

import { useTaskTableRows } from "./task-table/hooks/use-task-table-rows";
import type { TaskGrouping } from "@/components/blocks/task-grouping";
import { isTaskSectionRow } from "@/lib/tasks/types";
import { memo, useEffect, useRef } from "react";
import { useTaskCardDrag } from "@/lib/tasks/hooks/use-task-card-drag";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ArrowDownToLine, ChevronsDownUp, Ellipsis, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/custom/spinner";
import { KanbanCard } from "@/components/blocks/tasks/kanban-card";
import { MoveToListMenuContent } from "@/components/blocks/project/task-lists/move-to-list-menu-content";
import type { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import { useTableDnd } from "@/components/blocks/tasks/task-table/hooks/use-table-dnd";
import { areTasksEqual, type DropIndicator } from "@/components/blocks/tasks/task-table/task-row";
import { isEventInsideCurrentTarget } from "@/lib/tasks/table-interaction";
import { useShowCardDescription } from "@/lib/tasks/card-view-prefs";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type { ArchiveFilter, ProjectLabelSummary, TaskTreeNode, TaskUpdate } from "@/lib/tasks/types";
import type { Status as TaskStatus } from "@/lib/tasks/status";

type TaskTableController = ReturnType<typeof useTaskTableController>;

// Matches the table's mobile bottom padding so the last card clears the
// floating mobile nav bar.
const BOTTOM_NAV_SCROLL_PADDING_PX = 128;
const ESTIMATED_CARD_HEIGHT_PX = 96;

interface MobileTaskListProps {
  grouping?: TaskGrouping;
  projectId: Id<"projects">;
  controller: TaskTableController;
  archiveFilter: ArchiveFilter;
  allowedStatuses?: TaskStatus[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  onOpenDetails: (clientId: string) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  doneTaskCount?: number;
  onArchiveAllDone?: () => void;
  onCollapseAll?: () => void;
  canMoveClosedToBottom?: boolean;
  activeRootTaskCount?: number;
  onMoveActiveToList?: (listRef: string) => void;
  moveSourceListRef?: string | null;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  maxHeight?: string;
}

interface MobileTaskCardProps {
  node: TaskTreeNode;
  statusOptionsVersion: string;
  visibleColumnsVersion: string;
  isDragging: boolean;
  isDndEnabled: boolean;
  dropIndicator: DropIndicator;
  projectId: Id<"projects">;
  allowedStatuses?: TaskStatus[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  label?: ProjectLabelSummary | null;
  showDescription: boolean;
  /** Omitted for read-only viewers, so the card renders values only. */
  onTaskUpdate?: (id: string, updates: TaskUpdate) => void;
  onOpenDetails: (clientId: string) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onMobileDragPointerDown: (e: React.PointerEvent, id: string) => void;
  onMobileContextMenu: (e: React.MouseEvent) => void;
  shouldSuppressNextClick: () => boolean;
}

// Same contract as the table rows' shouldReuseRowContent: compare data props
// only; the drag/click handlers are stable callbacks from useTableDnd.
function shouldReuseCard(
  prev: MobileTaskCardProps,
  next: MobileTaskCardProps
): boolean {
  return (
    prev.statusOptionsVersion === next.statusOptionsVersion &&
    prev.visibleColumnsVersion === next.visibleColumnsVersion &&
    areTasksEqual(prev.node, next.node) &&
    prev.label === next.label &&
    prev.showDescription === next.showDescription &&
    (!next.showDescription || prev.node.description === next.node.description) &&
    // Flips once when the role loads.
    Boolean(prev.onTaskUpdate) === Boolean(next.onTaskUpdate) &&
    prev.isDragging === next.isDragging &&
    prev.isDndEnabled === next.isDndEnabled &&
    prev.dropIndicator === next.dropIndicator
  );
}

const MobileTaskCard = memo(function MobileTaskCard({
  node,
  isDragging,
  isDndEnabled,
  dropIndicator,
  projectId,
  allowedStatuses,
  hiddenTaskTableColumns,
  label,
  showDescription,
  onTaskUpdate,
  onOpenDetails,
  onInviteClick,
  onAddAgentClick,
  onDragStart,
  onDragEnd,
  onMobileDragPointerDown,
  onMobileContextMenu,
  shouldSuppressNextClick,
}: MobileTaskCardProps) {
  const clientId = node.clientId;
  const nativeDrag = useTaskCardDrag({
    enabled: isDndEnabled,
    onDragStart: (event) => onDragStart(event, clientId),
    onDragEnd,
  });

  // Capture phase, so a click that ends a drag never reaches the card's own
  // open-details handler.
  const handleClickCapture = (e: React.MouseEvent) => {
    if (!isEventInsideCurrentTarget(e)) return;

    if (shouldSuppressNextClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isEventInsideCurrentTarget(e)) return;
    nativeDrag.onPointerDown(e);
    onMobileDragPointerDown(e, clientId);
  };

  return (
    <div
      {...nativeDrag}
      role="listitem"
      data-task-row-id={clientId}
      onClickCapture={handleClickCapture}
      onPointerDown={handlePointerDown}
      onContextMenuCapture={onMobileContextMenu}
      style={{ WebkitTouchCallout: "none", touchAction: "manipulation" }}
      className={cn(
        "relative cursor-pointer rounded-lg",
        isDragging && "opacity-50",
        dropIndicator === "before" &&
          "before:absolute before:inset-x-0 before:-top-1 before:h-0.5 before:bg-info before:z-20",
        dropIndicator === "after" &&
          "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:bg-info after:z-20",
        dropIndicator === "inside" && "ring-1 ring-info bg-info/10"
      )}
    >
      <KanbanCard
        task={node}
        subtaskProgress={
          node.childCount > 0
            ? { completed: node.completedChildCount, total: node.childCount }
            : undefined
        }
        projectId={projectId}
        allowedStatuses={allowedStatuses}
        hiddenTaskTableColumns={hiddenTaskTableColumns}
        label={label}
        showDescription={showDescription}
        onTaskUpdate={onTaskUpdate}
        onInviteClick={onInviteClick}
        onAddAgentClick={onAddAgentClick}
        // The card's title button is the row's real button; long-press drag
        // still starts on it (allowTaskCardBodyDrag).
        onClick={() => onOpenDetails(clientId)}
        className={cn(
          node.isArchived && "opacity-60 bg-amber-50/50 dark:bg-amber-950/30"
        )}
      />
    </div>
  );
}, shouldReuseCard);

/**
 * Mobile renderer for the project task view: root tasks as kanban-style cards
 * in a virtualized list. Replaces `TaskTable` under the shared surface on
 * mobile viewports; subtasks are reached through task details, creation goes
 * through the mobile nav bar's + button, and there is no multi-select.
 * See docs/specs/mobile-task-list.md.
 */
export function MobileTaskList({
  projectId,
  controller,
  archiveFilter,
  allowedStatuses,
  hiddenTaskTableColumns,
  onOpenDetails,
  onInviteClick,
  onAddAgentClick,
  doneTaskCount,
  onArchiveAllDone,
  onCollapseAll,
  canMoveClosedToBottom,
  activeRootTaskCount,
  onMoveActiveToList,
  moveSourceListRef,
  onLoadMore,
  hasMore,
  isLoadingMore,
  maxHeight,
  grouping,
}: MobileTaskListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootTasks = controller.taskTree;
  const presentedRows = useTaskTableRows(rootTasks, grouping?.presentRows);
  const isDndEnabled = controller.isDndEnabled && archiveFilter !== "archived" && (!grouping || grouping.canMove);
  const [showDescription] = useShowCardDescription();
  const { labelsById } = useProjectLabels(projectId);

  const {
    draggedId,
    handleDragOver,
    handleDrop,
    dropPosition,
    handleDragStart,
    handleDragEnd,
    handleMobileDragPointerDown,
    handleMobileContextMenu,
    shouldSuppressNextClick,
  } = useTableDnd({
    onGroupDrop: grouping?.drop,
    tasks: rootTasks,
    taskTree: controller.taskTree,
    selectedIds: controller.selectedIds,
    isDndEnabled,
    projectId,
    reorderTasks: controller.reorderTasks,
    reorderMultiple: controller.reorderMultiple,
    setParent: controller.setParent,
    setParentMultiple: controller.setParentMultiple,
  });

  const virtualizer = useVirtualizer({
    count: presentedRows.length,
    getItemKey: (index) => presentedRows[index].clientId,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT_PX,
    overscan: 8,
    // Same React 19 escape hatch as TaskTable: avoid TanStack Virtual's
    // default sync flush during measurement.
    useFlushSync: false,
  });
  const virtualRows = virtualizer.getVirtualItems();

  // Infinite scroll (archived view): load more when the last visible card is
  // near the end of loaded data. Virtualizer state instead of scroll listeners,
  // mirroring TaskTable.
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const isNearEnd = lastVirtualRow
    ? lastVirtualRow.index >= presentedRows.length - 5
    : presentedRows.length === 0;
  const isVirtualizerScrolling = virtualizer.isScrolling;
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    if (!isNearEnd || isVirtualizerScrolling) return;

    const loadMore = onLoadMore;
    const timerId = setTimeout(() => {
      loadMore();
    }, 0);
    return () => clearTimeout(timerId);
  }, [onLoadMore, hasMore, isLoadingMore, isNearEnd, isVirtualizerScrolling]);

  const statusOptionsVersion = allowedStatuses?.join("|") ?? "";
  const visibleColumnsVersion = hiddenTaskTableColumns?.join("|") ?? "";
  const canArchiveDoneTasks = archiveFilter === "active" && (doneTaskCount ?? 0) > 0;
  const canMoveActiveToList = !!onMoveActiveToList && (activeRootTaskCount ?? 0) > 0;

  return (
    <div
      className="flex flex-col"
      style={{ height: maxHeight ?? "100%" }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pl-4 pr-2">
        <span className="text-xs font-medium text-muted-foreground">Tasks</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Task list actions"
              className="cursor-pointer"
            >
              <Ellipsis className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={!onCollapseAll} className="gap-2" onClick={onCollapseAll}>
              <ChevronsDownUp className="size-4 text-muted-foreground" />
              Collapse all
            </DropdownMenuItem>
            {controller.canUpdateTask && (
              <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canArchiveDoneTasks}
                className="gap-2"
                onClick={() => onArchiveAllDone?.()}
              >
                <Archive className="size-4 text-muted-foreground" />
                Archive done
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canMoveClosedToBottom}
                className="gap-2"
                onClick={() => controller.handleMoveClosedToBottom()}
              >
                <ArrowDownToLine className="size-4 text-muted-foreground" />
                Closed to bottom
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!canMoveActiveToList} className="gap-2">
                  <ListTree className="size-4 text-muted-foreground" />
                  Move active to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="p-0">
                  <MoveToListMenuContent
                    projectId={projectId}
                    selectedListRef={moveSourceListRef}
                    skipSections
                    onMoveToList={(listRef) => onMoveActiveToList?.(listRef)}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={scrollRef}
        data-task-table-scroll-container
        className={cn("min-h-0 flex-1 overflow-y-auto", !grouping?.enabled && "px-3 pt-3")}
      >
        {presentedRows.length === 0 ? (
          <TaskListEmptyState />
        ) : (
          <div
            role="list"
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualRows.map((virtualRow) => {
              const node = presentedRows[virtualRow.index];
              if (isTaskSectionRow(node)) {
                return (
                  <div
                    key={node.clientId}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    data-task-group-id={isGroupHeaderRow(node) ? node.clientId : undefined}
                    onDragOver={isDndEnabled && isGroupHeaderRow(node) ? event => handleDragOver(event, node.clientId) : undefined}
                    onDrop={isDndEnabled && isGroupHeaderRow(node) ? event => handleDrop(event, node.clientId) : undefined}
                    className="absolute left-0 right-0"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {grouping?.renderHeader(node, { mobile: true })}
                  </div>
                );
              }
              if ("rowType" in node) return null;
              const nextRow = presentedRows[virtualRow.index + 1];
              const followedByCreation = nextRow && isTaskSectionRow(nextRow) && nextRow.kind === "group-add";
              return (
                <div
                  key={node.clientId}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    "absolute left-0 right-0",
                    !followedByCreation && "pb-2",
                    grouping?.enabled && "px-3 pt-2"
                  )}
                  style={{ ...grouping?.getRowStyle(node), transform: `translateY(${virtualRow.start}px)` }}
                >
                  <MobileTaskCard
                    node={node}
                    statusOptionsVersion={statusOptionsVersion}
                    visibleColumnsVersion={visibleColumnsVersion}
                    isDragging={draggedId === node.clientId}
                    isDndEnabled={isDndEnabled}
                    dropIndicator={
                      dropPosition?.targetId === node.clientId &&
                      draggedId !== node.clientId
                        ? dropPosition.position
                        : null
                    }
                    projectId={projectId}
                    allowedStatuses={allowedStatuses}
                    hiddenTaskTableColumns={hiddenTaskTableColumns}
                    label={node.labelId ? labelsById.get(String(node.labelId)) ?? null : null}
                    showDescription={showDescription}
                    onTaskUpdate={controller.canUpdateTask ? controller.updateTask : undefined}
                    onOpenDetails={onOpenDetails}
                    onInviteClick={onInviteClick}
                    onAddAgentClick={onAddAgentClick}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onMobileDragPointerDown={handleMobileDragPointerDown}
                    onMobileContextMenu={handleMobileContextMenu}
                    shouldSuppressNextClick={shouldSuppressNextClick}
                  />
                </div>
              );
            })}
          </div>
        )}
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
        <div
          aria-hidden="true"
          style={{ height: BOTTOM_NAV_SCROLL_PADDING_PX }}
        />
      </div>
    </div>
  );
}
