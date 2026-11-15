"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import type { ThreadWorkspaceTab } from "@/components/blocks/thread/thread-sidebar-tabs";
import { THREAD_TASKS_SIDEBAR_HOTKEY, isEditableHotkeyTarget } from "@/lib/browser/hotkeys";

interface UseThreadTasksHotkeyOptions {
  /** False while the view is still loading, where there is no pane to toggle. */
  enabled: boolean;
  /** The panel actually showing, already resolved against the view's default. */
  activePanel: ThreadWorkspaceTab;
  isFullView: boolean;
  toggleSidebar: () => void;
  /** Reveals the Tasks panel — each view's own transition (see callers). */
  revealTasks: () => void;
  /** Full view has no pane: T swaps the Tasks tab against the thread. */
  showThread: () => void;
}

/**
 * The `T` shortcut, shared by both threads views so they can't drift (they had
 * two differently-bodied registrations before OS-1660) while each still supplies
 * its own readiness gate and Tasks transition.
 */
export function useThreadTasksHotkey({
  enabled,
  activePanel,
  isFullView,
  toggleSidebar,
  revealTasks,
  showThread,
}: UseThreadTasksHotkeyOptions) {
  useHotkey(
    THREAD_TASKS_SIDEBAR_HOTKEY,
    (event) => {
      if (isEditableHotkeyTarget(document.activeElement)) {
        return;
      }

      event.preventDefault();
      if (isFullView) {
        if (activePanel === "tasks") {
          showThread();
          return;
        }
        revealTasks();
        return;
      }

      if (activePanel === "tasks") {
        toggleSidebar();
        return;
      }

      revealTasks();
    },
    { enabled }
  );
}
