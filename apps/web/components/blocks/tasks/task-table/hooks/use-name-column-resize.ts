import { useCallback, useRef, useState, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  readLocalString,
  removeLocalValue,
  writeLocalString,
} from "@/lib/browser/local-storage";

/**
* Name (task title) column sizing. **Auto** (`nameWidth === null`, the default) flexes to fill,
* as it did before the resize feature; **fixed** (a number ≥ MIN) applies via `--task-name-w` at
* `@4xl`, so virtualized rows need no per-cell inline styles.
*
* Dragging switches to fixed and commits on pointer-up ("drop to apply" — the drag only moves a
* guide line, avoiding a reflow per pointer move). Double-click cycles: fixed → MIN → auto.
*/
export const MIN_NAME_COLUMN_WIDTH = 480;

/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

function storageKey(projectId?: Id<"projects">) {
  return `task-table:name-col-width:${projectId ?? "default"}`;
}

// Enforce the lower bound only; expansion is unbounded (the table scrolls
// horizontally rather than capping the width — see the fixed-mode layout notes in
// columns.tsx / the resize spec).
function clampWidth(value: number) {
  return Math.max(MIN_NAME_COLUMN_WIDTH, value);
}

/** `null` => auto/responsive (no stored width), a number => fixed width. */
function getStoredWidth(projectId?: Id<"projects">): number | null {
  const stored = readLocalString(storageKey(projectId));
  if (!stored) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? clampWidth(parsed) : null;
}

export interface NameColumnResize {
  /** Fixed width in px, or `null` when the column is in auto/responsive mode. */
  nameWidth: number | null;
  /** Convenience flag: `true` when the column flexes to fill (no fixed width). */
  isAutoWidth: boolean;
  isResizing: boolean;
  /** Content-relative x (px, within the scroll container, includes scroll offset) of the drag guide, or null when idle. */
  guideLeft: number | null;
  handleResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
  /** Double-click handler: cycles fixed → smallest → auto. */
  cycleWidth: () => void;
  /** Switch directly to auto/responsive mode (clears any fixed width). */
  resetToAuto: () => void;
}

export function useNameColumnResize(
  parentRef: RefObject<HTMLDivElement | null>,
  projectId?: Id<"projects">
): NameColumnResize {
  // Lazy-read persisted width (matches the useResizePanel convention).
  const [nameWidth, setNameWidth] = useState<number | null>(() => getStoredWidth(projectId));
  const [isResizing, setIsResizing] = useState(false);
  const [guideLeft, setGuideLeft] = useState<number | null>(null);

  const persist = useCallback(
    (width: number) => {
      writeLocalString(storageKey(projectId), String(width));
    },
    [projectId]
  );

  const clearPersisted = useCallback(() => {
    removeLocalValue(storageKey(projectId));
  }, [projectId]);

  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    nameLeft: number;
    moved: boolean;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const container = parentRef.current;
      const headEl = e.currentTarget.closest<HTMLElement>("[data-slot=table-head]");
      if (!container || !headEl) return;

      const handleEl = e.currentTarget;
      const pointerId = e.pointerId;

      const containerRect = container.getBoundingClientRect();
      const headRect = headEl.getBoundingClientRect();
      // Content-relative (not viewport-relative) x: the guide is absolutely
      // positioned inside the scroll container, so it scrolls with the content.
      // Adding scrollLeft keeps it aligned with the column edge after the table
      // has been scrolled horizontally.
      const nameLeft = headRect.left - containerRect.left + container.scrollLeft;
      // Start from the actual rendered width so the guide tracks the real handle
      // position even when the column is currently shrunk by space pressure or
      // flexing to fill (auto mode).
      const startWidth = headRect.width;
      dragStateRef.current = { startX: e.clientX, startWidth, nameLeft, moved: false };

      // Capture the pointer so move/up still reach us when the cursor leaves the 2px handle or the
      // window, and so a stray `pointercancel` can't strand the resize state — the col-resize
      // cursor and guide used to linger until the next click, since only `pointerup` was handled.
      try {
        handleEl.setPointerCapture(pointerId);
      } catch {
        // setPointerCapture throws if the pointer is already gone; ignore.
      }

      const onMove = (ev: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state) return;
        const delta = ev.clientX - state.startX;
        // Defer all visual feedback until the press is unambiguously a drag, so
        // the clicks of a double-click don't flash the guide or commit a width.
        if (!state.moved) {
          if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
          state.moved = true;
          setIsResizing(true);
        }
        setGuideLeft(state.nameLeft + clampWidth(state.startWidth + delta));
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        try {
          handleEl.releasePointerCapture(pointerId);
        } catch {
          // Already released (e.g. by the native pointerup); ignore.
        }
        dragStateRef.current = null;
        setIsResizing(false);
        setGuideLeft(null);
      };
      const onUp = (ev: PointerEvent) => {
        const state = dragStateRef.current;
        cleanup();
        // A press with no movement is a click (e.g. part of a double-click), not
        // a resize — leave the current mode untouched so cycleWidth can act.
        if (!state || !state.moved) return;
        const candidate = clampWidth(state.startWidth + (ev.clientX - state.startX));
        setNameWidth(candidate);
        persist(candidate);
      };
      // Abort without committing a new width if the gesture is cancelled.
      const onCancel = () => {
        cleanup();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [parentRef, persist]
  );

  const resetToAuto = useCallback(() => {
    clearPersisted();
    setNameWidth(null);
  }, [clearPersisted]);

  const cycleWidth = useCallback(() => {
    setNameWidth((prev) => {
      // Already at the smallest fixed width → clear to auto/responsive mode.
      if (prev !== null && prev <= MIN_NAME_COLUMN_WIDTH) {
        clearPersisted();
        return null;
      }
      // Auto, or any larger fixed width → shrink to the smallest fixed width.
      persist(MIN_NAME_COLUMN_WIDTH);
      return MIN_NAME_COLUMN_WIDTH;
    });
  }, [persist, clearPersisted]);

  return {
    nameWidth,
    isAutoWidth: nameWidth === null,
    isResizing,
    guideLeft,
    handleResizeStart,
    cycleWidth,
    resetToAuto,
  };
}
