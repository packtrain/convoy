"use client";

import { useEffect, useRef } from "react";
import { isEditableHotkeyTarget, isOverlayHotkeyTarget, TASK_PANEL_HOTKEYS } from "@/lib/browser/hotkeys";

interface UseTaskPanelHotkeysOptions {
  isOpen: boolean;
  /** Client id of the task the panel shows. */
  currentTaskId: string | null;
  /** Client ids in the view's visible order, read at key time. */
  getTaskOrder: () => readonly string[];
  onOpenTask: (clientId: string) => void;
  onClose: () => void;
}

/**
 * Esc closes the open task panel; J/K open the next/previous task in view order.
 * Window bubble phase, so keys a table, menu or dialog already claimed are skipped.
 */
export function useTaskPanelHotkeys(options: UseTaskPanelHotkeysOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const { isOpen } = options;
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableHotkeyTarget(event.target) || isOverlayHotkeyTarget(event.target)) return;

      const { currentTaskId, getTaskOrder, onOpenTask, onClose } = optionsRef.current;
      if (event.key === TASK_PANEL_HOTKEYS.close) {
        event.preventDefault();
        onClose();
        return;
      }

      const key = event.key.toUpperCase();
      const step = key === TASK_PANEL_HOTKEYS.next ? 1 : key === TASK_PANEL_HOTKEYS.previous ? -1 : 0;
      if (step === 0 || !currentTaskId) return;
      const order = getTaskOrder();
      const index = order.indexOf(currentTaskId);
      const target = index === -1 ? undefined : order[index + step];
      if (!target) return;
      event.preventDefault();
      onOpenTask(target);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);
}
