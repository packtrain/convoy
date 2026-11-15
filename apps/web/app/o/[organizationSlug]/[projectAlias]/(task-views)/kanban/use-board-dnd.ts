"use client";

import { useCallback, useMemo, useState } from "react";
import {
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type KeyboardSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  isBoardColumnReorderDropId,
  isPointWithinRect,
  parseBoardColumnDragId,
  parseBoardColumnReorderDropId,
  parseBoardDropId,
  parseBoardTaskDragId,
  planBoardDrop,
  planBoardKeyboardTarget,
  type BoardKeyboardDirection,
  type BoardRankTarget,
} from "./board-dnd-planning";
import type { KanbanCardItem } from "@/components/blocks/tasks/kanban-card";
import { isTaskFieldDragTarget } from "@/lib/tasks/hooks/use-task-field-menu";
import type { ReorderTasksFn, TaskUpdate } from "@/lib/tasks/types";

// Mouse-downs on interactive card controls must not arm a drag — except the task-field selector
// triggers, which defer their menu open to click (use-task-field-menu) so a press that moves
// lifts the card instead (OS-1381). Touch is intentionally not filtered: a tap still activates
// the control and only a still long-press lifts, so the whole card stays grabbable (OS-1001).
const NON_DRAGGABLE_SELECTOR = "button, a, input, textarea, select, [data-board-no-drag]";

function isNonDraggableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (isTaskFieldDragTarget(target)) {
    return false;
  }
  // The card title button opens details on click but is still the card's grab surface.
  const control = target.closest(NON_DRAGGABLE_SELECTOR);
  return Boolean(control) && !control?.hasAttribute("data-task-card-body");
}

const KEYBOARD_DIRECTIONS: Partial<Record<string, BoardKeyboardDirection>> = {
  [KeyboardCode.Up]: "up",
  [KeyboardCode.Down]: "down",
  [KeyboardCode.Left]: "left",
  [KeyboardCode.Right]: "right",
};

// Cards are plain draggables over custom zones, not a sortable list, so arrow
// keys jump between drop zones instead of nudging the card by pixels.
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableContainers, droppableRects, active }, currentCoordinates }
) => {
  const direction = KEYBOARD_DIRECTIONS[event.code];
  if (!direction || !collisionRect) {
    return undefined;
  }
  event.preventDefault();

  const isColumnDrag = active ? parseBoardColumnDragId(String(active)) !== null : false;
  const zones = droppableContainers.getEnabled().flatMap((container) => {
    const rect = droppableRects.get(container.id);
    const id = String(container.id);
    if (!rect) return [];
    if (isColumnDrag) {
      // Column drags only move sideways, onto the column-reorder zones.
      const columnId = parseBoardColumnReorderDropId(id);
      return columnId ? [{ id: `column:${columnId}`, rect }] : [];
    }
    return [{ id, rect }];
  });
  const center = {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };
  const target = planBoardKeyboardTarget({ direction, center, zones });
  if (!target) {
    return currentCoordinates;
  }
  return {
    x: currentCoordinates.x + target.x - center.x,
    y: currentCoordinates.y + target.y - center.y,
  };
};

// Space lifts from the focused card title only; Enter on the title still opens details.
class BoardKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: "onKeyDown" as const,
      handler: (
        event: ReactKeyboardEvent,
        options: KeyboardSensorOptions,
        context: Parameters<(typeof KeyboardSensor.activators)[number]["handler"]>[2]
      ) => {
        if (!(event.target instanceof Element) || !event.target.hasAttribute("data-task-card-body")) {
          return false;
        }
        return KeyboardSensor.activators[0].handler(event, options, context);
      },
    },
  ];
}

const BOARD_KEYBOARD_SENSOR_OPTIONS: KeyboardSensorOptions = {
  keyboardCodes: {
    start: [KeyboardCode.Space],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space, KeyboardCode.Enter],
  },
  coordinateGetter: boardKeyboardCoordinates,
};

class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent<Element>) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) {
          return false;
        }

        // Touch drags activate through the long-press touch sensor; letting
        // the pointer sensor race it would fight native scrolling.
        if (nativeEvent.pointerType === "touch") {
          return false;
        }

        return !isNonDraggableTarget(nativeEvent.target);
      },
    },
  ];
}

// Card half-zones win over the column top strip, which wins over the column
// body. Zones overlap by design, so collision priority is explicit instead of
// relying on dnd-kit's default ordering.
const boardCollisionDetection: CollisionDetection = (args) => {
  // Column drags only ever target the dedicated column-reorder zones.
  if (parseBoardColumnDragId(String(args.active.id)) !== null) {
    const containers = args.droppableContainers.filter((container) =>
      isBoardColumnReorderDropId(String(container.id))
    );
    const collisions = pointerWithin({ ...args, droppableContainers: containers });
    if (collisions.length > 0) {
      return collisions;
    }
    return rectIntersection({ ...args, droppableContainers: containers });
  }

  // Keyboard drags have no pointer: the dragged card's center stands in for it.
  const pointerCoordinates =
    args.pointerCoordinates ??
    (args.collisionRect
      ? {
          x: args.collisionRect.left + args.collisionRect.width / 2,
          y: args.collisionRect.top + args.collisionRect.height / 2,
        }
      : null);
  args = { ...args, pointerCoordinates };

  // While the pointer is still over the dragged card's original position
  // (e.g. a long-press released without moving), the only zones underneath
  // are the column strips, which would teleport the card to the group edge.
  // Treat it as "no drop target" so the release is a no-op.
  const initialRect = args.active.rect.current.initial;
  if (
    args.pointerCoordinates &&
    initialRect &&
    isPointWithinRect(args.pointerCoordinates, initialRect)
  ) {
    return [];
  }

  const byPrefix = (prefix: string) =>
    args.droppableContainers.filter((container) =>
      String(container.id).startsWith(prefix)
    );

  for (const containers of [
    byPrefix("card:"),
    byPrefix("card-into:"),
    byPrefix("column-top:"),
    byPrefix("column:"),
  ]) {
    const collisions = pointerWithin({ ...args, droppableContainers: containers });
    if (collisions.length > 0) {
      return collisions;
    }
  }

  return rectIntersection(args);
};

export type BoardDndColumnInput = {
  id: string;
  /** Spoken in drag announcements. */
  title?: string;
  cards: readonly KanbanCardItem[];
  dropTarget?: TaskUpdate;
};

function describeBoardDropTarget(
  overId: UniqueIdentifier,
  taskName: (taskId: string) => string,
  columnTitle: (columnId: string) => string
): string | null {
  const intent = parseBoardDropId(String(overId));
  if (!intent) return null;
  switch (intent.type) {
    case "card":
      return `${intent.position} ${taskName(intent.targetTaskId)}`;
    case "card-into":
      return `inside ${taskName(intent.targetTaskId)} as a subtask`;
    case "group-top":
      return `at the top of ${columnTitle(intent.columnId)}`;
    case "group-bottom":
      return `in ${columnTitle(intent.columnId)}`;
  }
}

export type TaskMoveFn = (
  sourceTaskId: string,
  fieldUpdates: TaskUpdate,
  rankTarget?: BoardRankTarget
) => void;

export type TaskMakeSubtaskFn = (taskId: string, parentId: string) => void;

export type BoardColumnDropSide = "left" | "right";

export type BoardColumnDropTarget = {
  columnId: string;
  side: BoardColumnDropSide;
};

export type ColumnReorderFn = (
  columnId: string,
  targetColumnId: string,
  side: BoardColumnDropSide
) => void;

export function useBoardDnd({
  columns,
  onTaskReorder,
  onTaskMove,
  onTaskMakeSubtask,
  onColumnReorder,
}: {
  columns: readonly BoardDndColumnInput[];
  onTaskReorder?: ReorderTasksFn;
  onTaskMove?: TaskMoveFn;
  onTaskMakeSubtask?: TaskMakeSubtaskFn;
  /** Column-header drags (label grouping) land here; absent = columns not draggable. */
  onColumnReorder?: ColumnReorderFn;
}) {
  const [activeItem, setActiveItem] = useState<KanbanCardItem | null>(null);
  const [activeSourceColumnId, setActiveSourceColumnId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<BoardColumnDropTarget | null>(null);
  const isDragEnabled = Boolean(onTaskReorder);

  const sensors = useSensors(
    useSensor(BoardPointerSensor, {
      // Keep plain clicks (open task details) from starting a drag.
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      // Long-press to lift a card on touch; a finger that starts moving sooner cancels the lift,
      // so swiping between columns still feels native. The tolerance absorbs a pressed finger's
      // natural drift: tighter cancels the pending lift, which also drops dnd-kit's contextmenu
      // suppression, so Android's long-press haptic fires with no card lifted (OS-1001).
      activationConstraint: { delay: 400, tolerance: 10 },
    }),
    useSensor(BoardKeyboardSensor, BOARD_KEYBOARD_SENSOR_OPTIONS)
  );

  const accessibility = useMemo(() => {
    const taskNames = new Map<string, string>();
    const columnTitles = new Map<string, string>();
    for (const column of columns) {
      columnTitles.set(column.id, column.title ?? column.id);
      for (const card of column.cards) taskNames.set(String(card.task._id), card.task.name);
    }
    const taskName = (taskId: string) => taskNames.get(taskId) ?? "the task";
    const columnTitle = (columnId: string) => columnTitles.get(columnId) ?? columnId;
    const activeName = (id: UniqueIdentifier) => {
      const taskId = parseBoardTaskDragId(String(id));
      if (taskId) return taskName(taskId);
      const columnId = parseBoardColumnDragId(String(id));
      return columnId ? columnTitle(columnId) : "the item";
    };
    const describe = (id: UniqueIdentifier) => describeBoardDropTarget(id, taskName, columnTitle);

    const announcements: Announcements = {
      onDragStart: ({ active }) => `Picked up ${activeName(active.id)}.`,
      onDragOver: ({ active, over }) => {
        const where = over ? describe(over.id) : null;
        return where ? `${activeName(active.id)} is ${where}.` : `${activeName(active.id)} is not over a drop target.`;
      },
      onDragEnd: ({ active, over }) => {
        const where = over ? describe(over.id) : null;
        return where
          ? `${activeName(active.id)} was dropped ${where}.`
          : `${activeName(active.id)} was dropped where it started.`;
      },
      onDragCancel: ({ active }) => `Moving ${activeName(active.id)} was canceled.`,
    };
    return {
      announcements,
      screenReaderInstructions: {
        draggable:
          "To pick up a card, press Space. Use the arrow keys to move it between cards and columns. Press Space or Enter to drop it, or Escape to cancel.",
      },
    };
  }, [columns]);

  const clearActiveDrag = useCallback(() => {
    setActiveItem(null);
    setActiveSourceColumnId(null);
    setActiveColumnId(null);
    setColumnDropTarget(null);
  }, []);

  // Tracks the boundary the dragged column would land on, for the drop line.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const columnId = parseBoardColumnDragId(String(event.active.id));
    if (!columnId) {
      return;
    }

    const overColumnId = event.over ? parseBoardColumnReorderDropId(String(event.over.id)) : null;
    if (!overColumnId || overColumnId === columnId) {
      setColumnDropTarget(null);
      return;
    }

    // Side comes from comparing horizontal centers of the dragged column and
    // the hovered one — no pointer coordinates in DragOverEvent.
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect;
    if (!activeRect || !overRect) {
      setColumnDropTarget(null);
      return;
    }

    const side: BoardColumnDropSide =
      activeRect.left + activeRect.width / 2 < overRect.left + overRect.width / 2 ? "left" : "right";
    setColumnDropTarget({ columnId: overColumnId, side });
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const columnId = parseBoardColumnDragId(String(event.active.id));
      if (columnId) {
        setActiveColumnId(columnId);
        return;
      }

      const taskId = parseBoardTaskDragId(String(event.active.id));
      if (!taskId) {
        return;
      }

      // Haptic confirmation that the long-press lifted the card (Android;
      // iOS ignores vibrate).
      if (
        typeof TouchEvent !== "undefined" &&
        event.activatorEvent instanceof TouchEvent
      ) {
        navigator.vibrate?.(30);
      }

      for (const column of columns) {
        const card = column.cards.find((item) => String(item.task._id) === taskId);
        if (card) {
          setActiveItem(card);
          setActiveSourceColumnId(column.id);
          return;
        }
      }
    },
    [columns]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const droppedColumnId = parseBoardColumnDragId(String(event.active.id));
      const finalColumnDropTarget = columnDropTarget;
      clearActiveDrag();

      if (droppedColumnId) {
        if (finalColumnDropTarget && finalColumnDropTarget.columnId !== droppedColumnId) {
          onColumnReorder?.(droppedColumnId, finalColumnDropTarget.columnId, finalColumnDropTarget.side);
        }
        return;
      }

      const sourceTaskId = parseBoardTaskDragId(String(event.active.id));
      if (!sourceTaskId || !event.over) {
        return;
      }

      const plan = planBoardDrop({
        sourceTaskId,
        dropId: String(event.over.id),
        columns,
      });
      if (!plan) {
        return;
      }

      if (plan.kind === "reorder") {
        // Board cards are root tasks; rank resolves in the root sibling scope.
        onTaskReorder?.(
          sourceTaskId,
          plan.rankTarget.targetTaskId,
          null,
          plan.rankTarget.position
        );
        return;
      }

      if (plan.kind === "make-subtask") {
        onTaskMakeSubtask?.(sourceTaskId, plan.parentTaskId);
        return;
      }

      onTaskMove?.(sourceTaskId, plan.fieldUpdates, plan.rankTarget);
    },
    [clearActiveDrag, columnDropTarget, columns, onColumnReorder, onTaskMakeSubtask, onTaskMove, onTaskReorder]
  );

  return useMemo(
    () => ({
      isDragEnabled,
      sensors,
      accessibility,
      collisionDetection: boardCollisionDetection,
      activeItem,
      activeSourceColumnId,
      activeColumnId,
      columnDropTarget,
      handleDragStart,
      handleDragOver,
      handleDragEnd,
      handleDragCancel: clearActiveDrag,
    }),
    [
      accessibility,
      activeColumnId,
      activeItem,
      activeSourceColumnId,
      clearActiveDrag,
      columnDropTarget,
      handleDragEnd,
      handleDragOver,
      handleDragStart,
      isDragEnabled,
      sensors,
    ]
  );
}
