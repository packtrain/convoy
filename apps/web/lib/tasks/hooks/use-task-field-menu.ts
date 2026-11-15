"use client";

import { useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Marker attribute for task-field selector triggers (type, status, priority,
 * assignee). Presses on marked triggers may start a Board card drag or a
 * Table row drag instead of opening the menu; the menu opens on click.
 */
export const TASK_FIELD_DRAG_ATTRIBUTE = "data-task-field-drag";
export const TASK_FIELD_DRAG_SELECTOR = `[${TASK_FIELD_DRAG_ATTRIBUTE}]`;

export function isTaskFieldDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(TASK_FIELD_DRAG_SELECTOR))
  );
}

// Max pointer travel between press and release for the release to still count
// as a click that opens the menu. Matches the Board drag activation distance.
const CLICK_MOVE_TOLERANCE_PX = 5;

// A touch release later than this is a long-press (the Board lifts a card at
// 400 ms, the Table row at 450 ms), not a tap that should open the menu.
const TOUCH_TAP_MAX_DURATION_MS = 350;

type PressState = {
  x: number;
  y: number;
  timeStamp: number;
  pointerType: string;
  wasOpen: boolean;
};

/**
* Trigger props for a task-field dropdown that must coexist with dragging (OS-1381). Radix's
* DropdownMenuTrigger opens on pointerdown and calls preventDefault(), and neither dnd-kit nor
* native drag starts from a default-prevented event, so a press-drag used to never drag.
*
* For mouse and touch, opening is deferred to click: pointerdown marks only the *React
* synthetic* event prevented, so Radix skips its pointerdown-open while drag sensors can still
* arm. A click ending a still press opens; one ending a drag, a long-press or a dismiss does
* not. The owning component must render its DropdownMenu controlled with the same
* `open`/`onOpenChange` pair.
*/
export function useTaskFieldMenuTrigger({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pressRef = useRef<PressState | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      (event.pointerType !== "mouse" && event.pointerType !== "touch") ||
      event.button !== 0 ||
      event.ctrlKey
    ) {
      return;
    }

    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timeStamp: event.timeStamp,
      pointerType: event.pointerType,
      wasOpen: open,
    };

    // Synthetic flag only — nativeEvent.defaultPrevented must stay false so
    // dnd-kit / native drag still see an unprevented press (see JSDoc).
    event.defaultPrevented = true;
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    const press = pressRef.current;
    pressRef.current = null;

    // No recorded press: keyboard activation, handled by Radix.
    if (!press) {
      return;
    }

    // The press dismissed an already-open menu; reopening would undo that.
    if (press.wasOpen) {
      return;
    }

    // The press became a drag that ended back over the trigger.
    const distance = Math.hypot(
      event.clientX - press.x,
      event.clientY - press.y
    );
    if (distance > CLICK_MOVE_TOLERANCE_PX) {
      return;
    }

    // A touch held long enough to lift the row/card is a drag, not a tap —
    // even when the finger never moved and a click still fires on release.
    if (
      press.pointerType === "touch" &&
      event.timeStamp - press.timeStamp > TOUCH_TAP_MAX_DURATION_MS
    ) {
      return;
    }

    onOpenChange(true);
  };

  return {
    [TASK_FIELD_DRAG_ATTRIBUTE]: "",
    onPointerDown,
    onClick,
  };
}
