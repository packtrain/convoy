"use client";

import { useMemo, useState, type ReactNode } from "react";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { calculateRankBetween } from "@/lib/tasks/rank";
import { showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";

type RankedItem = { _id: string; rank?: string };

/**
 * Optimistic LexoRank drag-reorder bridge shared by rank-sortable settings
 * lists (labels, task Lists). Holds the dropped order locally until the
 * reorder mutation lands and the server subscription catches up, so the row
 * doesn't snap back. Server order wins as soon as `items` updates.
 */
export function useOptimisticRankReorder<T extends RankedItem>({
  items,
  onReorder,
  errorMessage,
}: {
  items: T[];
  onReorder: (item: T, rank: string) => Promise<unknown>;
  errorMessage: string;
}) {
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);

  const orderedItems = useMemo(() => {
    if (!optimisticOrder) return items;
    const byId = new Map(items.map((item) => [String(item._id), item]));
    const ordered = optimisticOrder
      .map((id) => byId.get(id))
      .filter((item): item is T => item !== undefined);
    const orderedIds = new Set(optimisticOrder);
    return [...ordered, ...items.filter((item) => !orderedIds.has(String(item._id)))];
  }, [items, optimisticOrder]);

  // Drop computes the new LexoRank between the target slot's neighbors.
  const handleDragEnd = async (activeId: string, overId: string) => {
    if (activeId === overId) return;

    const oldIndex = orderedItems.findIndex((item) => String(item._id) === activeId);
    const newIndex = orderedItems.findIndex((item) => String(item._id) === overId);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(orderedItems, oldIndex, newIndex);
    setOptimisticOrder(reordered.map((item) => String(item._id)));
    try {
      await onReorder(
        orderedItems[oldIndex],
        calculateRankBetween(reordered[newIndex - 1]?.rank, reordered[newIndex + 1]?.rank)
      );
    } catch (error) {
      showConvexErrorToast(error, errorMessage);
    } finally {
      setOptimisticOrder(null);
    }
  };

  return { orderedItems, handleDragEnd };
}

/** Sortable row shell: drag handle on the left, row content supplied by the parent. */
export function SortableRankRow({
  id,
  dragEnabled,
  className,
  handleClassName,
  dragHandleLabel = "Drag to reorder",
  children,
}: {
  id: string;
  dragEnabled: boolean;
  className?: string;
  handleClassName?: string;
  dragHandleLabel?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !dragEnabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(className, isDragging && "relative z-10 bg-background opacity-80 shadow-md")}
    >
      {dragEnabled && (
        <button
          type="button"
          className={cn(
            "cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing",
            handleClassName
          )}
          aria-label={dragHandleLabel}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}
