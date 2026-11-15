"use client";

import { useCallback, useState, type DragEvent } from "react";
import type { BoardRankTarget } from "./board-dnd-planning";
import {
  dragHasTasksForProject,
  readTaskDragPayload,
} from "@/lib/tasks/task-drag";
import type { TaskUpdate } from "@/lib/tasks/types";

export interface BoardExternalDropProps {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export type ExternalTasksDropFn = (
  taskIds: string[],
  fieldUpdates: TaskUpdate,
  rankTarget?: BoardRankTarget
) => void;

export type ExternalTasksDropIntoFn = (
  taskIds: string[],
  parentTaskId: string
) => void;

export type BoardExternalCardZone = "before" | "into" | "after";

export interface BoardExternalCardTarget {
  taskId: string;
  zone: BoardExternalCardZone;
}

// Same 25/50/25 vertical split as the table rows and the board's dnd-kit card
// zones: edge bands insert next to the card, the center band drops into it.
export function getExternalCardDropZone(
  rect: { top: number; height: number },
  clientY: number
): BoardExternalCardZone {
  const y = clientY - rect.top;
  if (y < rect.height * 0.25) {
    return "before";
  }
  if (y > rect.height * 0.75) {
    return "after";
  }
  return "into";
}

// Makes Board columns and cards drop targets for native task drags from outside the board — e.g.
// subtasks dragged out of the detail sidebar's subtask table (OS-979). A column-body drop
// promotes the tasks to root and applies the column's grouping field; a card edge does the same
// but inserts next to that card; a card center makes them its subtasks. Native HTML5 drags never
// collide with the board's dnd-kit pointer drags, so both systems coexist.
export function useBoardExternalTaskDrop({
  projectId,
  onDropTasks,
  onDropTasksInto,
}: {
  projectId?: string;
  onDropTasks?: ExternalTasksDropFn;
  onDropTasksInto?: ExternalTasksDropIntoFn;
}): {
  externalDropColumnId: string | null;
  externalCardTarget: BoardExternalCardTarget | null;
  getColumnDropProps: (
    columnId: string,
    dropTarget?: TaskUpdate
  ) => BoardExternalDropProps | undefined;
  getCardDropProps: (
    taskId: string,
    dropTarget?: TaskUpdate
  ) => BoardExternalDropProps | undefined;
} {
  const [externalDropColumnId, setExternalDropColumnId] = useState<string | null>(null);
  const [externalCardTarget, setExternalCardTarget] =
    useState<BoardExternalCardTarget | null>(null);

  const clearCardTarget = useCallback((taskId: string) => {
    setExternalCardTarget((current) =>
      current?.taskId === taskId ? null : current
    );
  }, []);

  const getColumnDropProps = useCallback(
    (columnId: string, dropTarget?: TaskUpdate): BoardExternalDropProps | undefined => {
      // Columns without a grouping-field payload (legacy/stale groups) are not
      // external drop targets either — a promoted task would land elsewhere.
      if (!projectId || !onDropTasks || !dropTarget) {
        return undefined;
      }

      return {
        onDragOver: (event) => {
          if (!dragHasTasksForProject(event.dataTransfer, projectId)) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setExternalDropColumnId(columnId);
        },
        onDragLeave: (event) => {
          const related = event.relatedTarget;
          if (related instanceof Node && event.currentTarget.contains(related)) {
            return;
          }
          setExternalDropColumnId((current) =>
            current === columnId ? null : current
          );
        },
        onDrop: (event) => {
          setExternalDropColumnId((current) =>
            current === columnId ? null : current
          );
          const payload = readTaskDragPayload(event.dataTransfer);
          if (!payload || payload.projectId !== projectId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onDropTasks(payload.taskIds, dropTarget);
        },
      };
    },
    [onDropTasks, projectId]
  );

  const getCardDropProps = useCallback(
    (taskId: string, dropTarget?: TaskUpdate): BoardExternalDropProps | undefined => {
      // Card zones follow the same gating as the column: edge drops write the
      // column's grouping field, so non-droppable groups stay inert.
      if (!projectId || !onDropTasks || !onDropTasksInto || !dropTarget) {
        return undefined;
      }

      return {
        onDragOver: (event) => {
          if (!dragHasTasksForProject(event.dataTransfer, projectId)) {
            return;
          }
          event.preventDefault();
          // Card zones win over the enclosing column-body drop.
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const zone = getExternalCardDropZone(
            event.currentTarget.getBoundingClientRect(),
            event.clientY
          );
          setExternalCardTarget((current) =>
            current?.taskId === taskId && current.zone === zone
              ? current
              : { taskId, zone }
          );
        },
        onDragLeave: (event) => {
          const related = event.relatedTarget;
          if (related instanceof Node && event.currentTarget.contains(related)) {
            return;
          }
          clearCardTarget(taskId);
        },
        onDrop: (event) => {
          clearCardTarget(taskId);
          // The card swallows the drop, so the column's own dragleave never
          // fires — clear its highlight here.
          setExternalDropColumnId(null);
          const payload = readTaskDragPayload(event.dataTransfer);
          if (!payload || payload.projectId !== projectId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();

          const zone = getExternalCardDropZone(
            event.currentTarget.getBoundingClientRect(),
            event.clientY
          );
          if (zone === "into") {
            onDropTasksInto(payload.taskIds, taskId);
            return;
          }
          onDropTasks(payload.taskIds, dropTarget, {
            targetTaskId: taskId,
            position: zone,
          });
        },
      };
    },
    [clearCardTarget, onDropTasks, onDropTasksInto, projectId]
  );

  return {
    externalDropColumnId,
    externalCardTarget,
    getColumnDropProps,
    getCardDropProps,
  };
}
