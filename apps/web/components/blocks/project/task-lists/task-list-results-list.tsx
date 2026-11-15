"use client";

import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ActionButton } from "@/components/custom/action-button";
import { SortableRankRow } from "@/components/custom/sortable-rank-list";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskListRowActions } from "./task-list-actions-menu";
import type { TaskListItem } from "./task-list-types";
import { TaskListRow } from "./task-list-row";
import type { TaskListResultsController } from "./use-task-list-results";

interface TaskListResultsListProps {
  data: TaskListResultsController;
  emptyText: string;
  className: string;
  compactRows?: boolean;
  createRowPlacement?: "top" | "bottom";
  beforeList?: ReactNode;
  createRow?: ReactNode;
  rowActions?: TaskListRowActions;
  showEmptyState?: boolean;
  onSelectList?: (list: TaskListItem) => void;
  selectedListRef?: string | null;
  isListDisabled?: (list: TaskListItem) => boolean;
  isListHidden?: (list: TaskListItem) => boolean;
  getOpenTasksHref?: (list: TaskListItem) => string | undefined;
  actionsMenuSide?: "top" | "right" | "bottom" | "left";
  actionsMenuAlign?: "start" | "center" | "end";
  sortable?: {
    enabled: boolean;
    onDragEnd: (activeId: string, overId: string) => void;
  };
}

export function TaskListResultsList({
  data,
  emptyText,
  className,
  compactRows = false,
  createRowPlacement = "top",
  beforeList,
  createRow,
  rowActions,
  showEmptyState = true,
  onSelectList,
  selectedListRef = null,
  isListDisabled,
  isListHidden,
  getOpenTasksHref,
  actionsMenuSide,
  actionsMenuAlign,
  sortable,
}: TaskListResultsListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );
  const visibleResults = isListHidden
    ? data.results.filter((list) => !isListHidden(list))
    : data.results;
  const shouldShowEmptyState =
    !data.isLoading && visibleResults.length === 0 && showEmptyState;
  const shouldRenderResults =
    Boolean(createRow) ||
    data.isLoading ||
    shouldShowEmptyState ||
    visibleResults.length > 0;
  const renderedRows = (
    <>
      {data.isLoading ? (
        <TaskListRowsSkeleton compact={compactRows} />
      ) : shouldShowEmptyState ? (
        <div className="px-2 py-1 text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        visibleResults.map((list) => {
          const row = (
            <TaskListRow
              list={list}
              compact={compactRows}
              selected={selectedListRef === list.ref}
              disabled={isListDisabled?.(list) ?? false}
              openTasksHref={getOpenTasksHref?.(list)}
              actions={rowActions}
              actionsMenuSide={actionsMenuSide}
              actionsMenuAlign={actionsMenuAlign}
              onSelect={onSelectList}
            />
          );

          return sortable ? (
            <SortableRankRow
              key={list._id}
              id={String(list._id)}
              dragEnabled={sortable.enabled}
              className="flex items-center gap-1 rounded-md"
              dragHandleLabel="Drag to reorder list"
            >
              <div className="min-w-0 flex-1">{row}</div>
            </SortableRankRow>
          ) : (
            <div key={list._id}>{row}</div>
          );
        })
      )}
    </>
  );

  const rows = sortable ? (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={(event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
          return;
        }
        sortable.onDragEnd(String(active.id), String(over.id));
      }}
    >
      <SortableContext
        items={visibleResults.map((list) => String(list._id))}
        strategy={verticalListSortingStrategy}
      >
        {renderedRows}
      </SortableContext>
    </DndContext>
  ) : (
    renderedRows
  );

  // Scrolls with the rows as the last entry (after the create row) instead of
  // being pinned under the viewport, where a floating mobile nav bar would
  // cover it.
  const loadMoreButton = data.hasMore ? (
    <ActionButton
      type="button"
      variant="ghost"
      size="sm"
      className="w-full cursor-pointer"
      busy={data.isLoadingMore}
      onClick={data.loadMore}
      showIcon={false}
    >
      Load more
    </ActionButton>
  ) : null;

  return (
    <>
      {beforeList}

      {shouldRenderResults ? (
        <div className={className} role={onSelectList ? "listbox" : undefined}>
          <div className="min-w-0 space-y-1">
            {createRowPlacement === "top" ? createRow : null}

            {rows}

            {createRowPlacement === "bottom" ? createRow : null}

            {loadMoreButton}
          </div>
        </div>
      ) : (
        loadMoreButton
      )}
    </>
  );
}

function TaskListRowsSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="space-y-1 px-1 py-1">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded-md px-1 py-1"
        >
          <Skeleton
            className={
              compact
                ? "size-4 shrink-0 rounded-full"
                : "size-5 shrink-0 rounded-full"
            }
          />
          <Skeleton
            className={
              compact
                ? "h-3 flex-1 rounded-sm"
                : "h-4 flex-1 rounded-sm"
            }
          />
        </div>
      ))}
    </div>
  );
}
