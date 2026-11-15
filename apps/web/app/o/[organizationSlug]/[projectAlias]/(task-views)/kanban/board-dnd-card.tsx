"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { boardCardDropId, boardCardIntoDropId, boardTaskDragId } from "./board-dnd-planning";
import type {
  BoardExternalCardZone,
  BoardExternalDropProps,
} from "./use-board-external-task-drop";
import type { KanbanCardItem } from "@/components/blocks/tasks/kanban-card";
import type { ReorderPosition } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

function CardDropZone({
  id,
  edge,
  shrinkForIntoZone,
}: {
  id: string;
  edge: ReorderPosition;
  shrinkForIntoZone: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Zones extend into half the column gap so the space between two cards
        // always resolves to a before/after intent instead of the column body.
        // When the center make-subtask zone is active, the edge zones shrink
        // to the outer quarters (mirroring the table's 25/50/25 row split).
        "pointer-events-none absolute inset-x-0",
        edge === "before" && (shrinkForIntoZone ? "-top-1.5 bottom-3/4" : "-top-1.5 bottom-1/2"),
        edge === "after" && (shrinkForIntoZone ? "top-3/4 -bottom-1.5" : "top-1/2 -bottom-1.5")
      )}
    >
      {isOver ? (
        // Centered on the zone's outer edge (the middle of the column gap), so
        // the before-line of one card and the after-line of its neighbor render
        // at the same pixel position.
        <div
          className={cn(
            "absolute inset-x-0 h-0.5 rounded-full bg-blue-500",
            edge === "before" ? "-top-px" : "-bottom-px"
          )}
        />
      ) : null}
    </div>
  );
}

// Whole-card highlight signals "drop inside" (make subtask), matching the
// card's own rounding. Shared by the dnd-kit center zone and native external
// drags.
function CardIntoHighlight() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-lg bg-blue-500/5 ring-2 ring-blue-500" />
  );
}

// Insertion line centered in the column gap next to the card; mirrors the
// dnd-kit edge-zone line position (6px gap-half + 1px line-half).
function CardEdgeIndicator({ edge }: { edge: ReorderPosition }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-blue-500",
        edge === "before" ? "-top-[7px]" : "-bottom-[7px]"
      )}
    />
  );
}

function CardIntoDropZone({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <>
      <div
        ref={setNodeRef}
        className="pointer-events-none absolute inset-x-0 top-1/4 bottom-1/4"
      />
      {isOver ? <CardIntoHighlight /> : null}
    </>
  );
}

export function BoardDndCard({
  item,
  isDragEnabled,
  showDropZones,
  showSubtaskDropZone = false,
  externalDropProps,
  externalDropZone = null,
  children,
}: {
  item: KanbanCardItem;
  isDragEnabled: boolean;
  showDropZones: boolean;
  /** Adds the center "drop into card = make subtask" zone between the edge zones. */
  showSubtaskDropZone?: boolean;
  /** Native HTML5 drop handlers for cross-surface task drags (OS-979). */
  externalDropProps?: BoardExternalDropProps;
  /** Hovered zone of an active external drag over this card, for indicators. */
  externalDropZone?: BoardExternalCardZone | null;
  children: ReactNode;
}) {
  const taskId = String(item.task._id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: boardTaskDragId(taskId),
    disabled: !isDragEnabled,
  });
  const didDragRef = useRef(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const describedBy = isDragEnabled ? attributes["aria-describedby"] : undefined;

  // The card's title button is the keyboard drag handle, so it carries the
  // screen reader drag instructions.
  useEffect(() => {
    const title = nodeRef.current?.querySelector("[data-task-card-body]");
    if (!title) return;
    if (describedBy) title.setAttribute("aria-describedby", describedBy);
    else title.removeAttribute("aria-describedby");
  }, [describedBy]);

  useEffect(() => {
    if (isDragging) {
      didDragRef.current = true;
      return;
    }

    if (!didDragRef.current) {
      return;
    }

    // The browser click that follows a completed drag is suppressed in
    // handleClickCapture; this clears the flag when no click arrives (e.g.
    // Escape-canceled drags) so the next real click is not swallowed.
    const timeout = window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!didDragRef.current) {
      return;
    }

    didDragRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // Android fires contextmenu on long-press (~500ms) after the touch sensor
  // has already lifted the card (250ms); swallow it while dragging.
  const handleContextMenuCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      ref={(node) => {
        nodeRef.current = node;
        setNodeRef(node);
      }}
      data-board-task-id={taskId}
      data-board-dnd-card={isDragEnabled ? "enabled" : "disabled"}
      className={cn(
        // touch-manipulation keeps native panning before long-press
        // activation; select-none/touch-callout suppression stop iOS text
        // selection and the callout during the long-press.
        "relative touch-manipulation max-md:select-none max-md:[-webkit-touch-callout:none]",
        isDragging && "opacity-50"
      )}
      onClickCapture={handleClickCapture}
      onContextMenuCapture={handleContextMenuCapture}
      {...listeners}
      {...externalDropProps}
    >
      {children}
      {externalDropZone === "into" ? <CardIntoHighlight /> : null}
      {externalDropZone === "before" || externalDropZone === "after" ? (
        <CardEdgeIndicator edge={externalDropZone} />
      ) : null}
      {showDropZones && !isDragging ? (
        <>
          <CardDropZone
            id={boardCardDropId(taskId, "before")}
            edge="before"
            shrinkForIntoZone={showSubtaskDropZone}
          />
          <CardDropZone
            id={boardCardDropId(taskId, "after")}
            edge="after"
            shrinkForIntoZone={showSubtaskDropZone}
          />
          {showSubtaskDropZone ? (
            <CardIntoDropZone id={boardCardIntoDropId(taskId)} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
