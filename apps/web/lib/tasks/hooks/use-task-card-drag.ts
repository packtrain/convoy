"use client";

import { useState, type DragEvent, type PointerEvent } from "react";
import { isEventInsideCurrentTarget, isTaskTableInteractiveTarget } from "@/lib/tasks/table-interaction";

interface TaskCardDragOptions {
  enabled: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

export function useTaskCardDrag({ enabled, onDragStart, onDragEnd }: TaskCardDragOptions) {
  const [armed, setArmed] = useState(false);
  const isControl = (target: EventTarget) =>
    isTaskTableInteractiveTarget(target, { allowTaskCardBodyDrag: true });

  return {
    draggable: enabled && armed,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!isEventInsideCurrentTarget(event)) return;
      setArmed(
        event.pointerType === "mouse" && event.button === 0 &&
        event.isPrimary && !isControl(event.target)
      );
    },
    onPointerUp: () => setArmed(false),
    onPointerCancel: () => setArmed(false),
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      if (!isEventInsideCurrentTarget(event)) return;
      if (!enabled || !armed || isControl(event.target)) {
        event.preventDefault();
        return;
      }
      onDragStart(event);
    },
    onDragEnd: (event: DragEvent<HTMLDivElement>) => {
      if (!isEventInsideCurrentTarget(event)) return;
      setArmed(false);
      onDragEnd?.();
    },
  };
}
