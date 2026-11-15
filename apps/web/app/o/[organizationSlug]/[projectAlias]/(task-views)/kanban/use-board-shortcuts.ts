"use client";

import { useCallback, useEffect, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskShortcutPickerRequest } from "@/components/blocks/tasks/task-shortcut-picker";
import { isEditableHotkeyTarget } from "@/lib/browser/hotkeys";
import { matchTaskPropertyShortcut } from "@/lib/tasks/metadata-shortcuts";
import type { Task, TaskUpdate } from "@/lib/tasks/types";

/**
 * P/A/I/L/D/M on the focused Board card, the same keys as the task table
 * (docs/specs/keyboard-navigation.md). Off for read-only boards.
 */
export function useBoardShortcuts({
  tasks,
  currentUserId,
  onTaskUpdate,
}: {
  tasks: readonly Task[];
  currentUserId?: string;
  onTaskUpdate?: (taskId: Task["_id"], updates: TaskUpdate) => void;
}) {
  const [request, setRequest] = useState<TaskShortcutPickerRequest | null>(null);
  const closeRequest = useCallback(() => setRequest(null), []);

  useEffect(() => {
    if (!onTaskUpdate) return;

    // Capture phase claims the key before document-level single-key shortcuts.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableHotkeyTarget(event.target)) return;
      const property = matchTaskPropertyShortcut(event);
      if (!property) return;
      const active = document.activeElement;
      const card = active instanceof Element ? active.closest<HTMLElement>("[data-board-task-id]") : null;
      const task = card ? tasks.find((candidate) => String(candidate._id) === card.dataset.boardTaskId) : undefined;
      if (!card || !task) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (property === "assignToMe") {
        if (currentUserId) onTaskUpdate(task._id, { assigneeId: currentUserId as Id<"users"> });
        return;
      }
      const anchor = card.querySelector<HTMLElement>("[data-task-card-body]") ?? card;
      setRequest({ property, tasks: [task], anchor });
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [currentUserId, onTaskUpdate, tasks]);

  return { shortcutRequest: request, closeShortcutRequest: closeRequest };
}
