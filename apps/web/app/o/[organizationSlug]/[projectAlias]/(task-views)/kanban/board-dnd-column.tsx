"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { boardColumnBodyDropId, boardColumnTopDropId } from "./board-dnd-planning";
import type { BoardExternalDropProps } from "./use-board-external-task-drop";
import { cn } from "@/lib/utils";

// Matches the column header height plus the items-area top padding, so the
// top zone reads as "before the first card".
const COLUMN_TOP_ZONE_CLASS = "h-14";

function ColumnDropZones({ columnId, showTopZone }: { columnId: string; showTopZone: boolean }) {
  const { setNodeRef: setTopZoneRef, isOver: isOverTop } = useDroppable({
    id: boardColumnTopDropId(columnId),
  });
  const { setNodeRef: setBodyZoneRef, isOver: isOverBody } = useDroppable({
    id: boardColumnBodyDropId(columnId),
  });

  return (
    <>
      {showTopZone ? (
        <div
          ref={setTopZoneRef}
          className={cn("pointer-events-none absolute inset-x-0 top-0", COLUMN_TOP_ZONE_CLASS)}
        >
          {isOverTop ? (
            <div className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-blue-500" />
          ) : null}
        </div>
      ) : null}
      {/* Spans the whole column so the highlight has no untinted strip behind
          the header; the top zone still wins in collision priority. */}
      <div
        ref={setBodyZoneRef}
        className={cn("pointer-events-none absolute inset-0", isOverBody && "bg-blue-500/5")}
      />
    </>
  );
}

export function BoardDndColumn({
  columnId,
  hasActiveDrag,
  isDropAllowed,
  externalDropProps,
  isExternalDropTarget = false,
  showTopZone = true,
  children,
}: {
  columnId: string;
  hasActiveDrag: boolean;
  isDropAllowed: boolean;
  /** Native HTML5 drop handlers for cross-surface task drags (OS-979). */
  externalDropProps?: BoardExternalDropProps;
  isExternalDropTarget?: boolean;
  /** Headerless row cells rely on the first card's "before" zone instead. */
  showTopZone?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative",
        hasActiveDrag && !isDropAllowed && "opacity-60"
      )}
      {...externalDropProps}
    >
      {children}
      {hasActiveDrag && isDropAllowed ? <ColumnDropZones columnId={columnId} showTopZone={showTopZone} /> : null}
      {isExternalDropTarget ? (
        <div className="pointer-events-none absolute inset-0 bg-blue-500/5" />
      ) : null}
    </div>
  );
}
