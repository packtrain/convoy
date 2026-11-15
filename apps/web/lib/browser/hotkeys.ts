export const CREATE_TASK_AT_TOP_HOTKEY = "C";
// N is intentionally context-dependent: task list opens task create, threads open thread create.
export const CREATE_TASK_DIALOG_HOTKEY = "N";
export const NEW_THREAD_HOTKEY = "N";
// Quick-thread composer (docs/specs/quick-thread-composer.md).
export const QUICK_THREAD_HOTKEY = "Shift+N";
export const QUICK_THREAD_SEND_AND_OPEN_SHORTCUT = "Mod+Enter";
export const ARCHIVE_COMPLETED_TASKS_HOTKEY = "Mod+Shift+A";
// "Closed" task ordering is defined by planClosedTasksToBottom: Done and Canceled.
export const MOVE_CLOSED_TASKS_BOTTOM_HOTKEY = "Mod+Shift+B";
export const PLAN_MODE_TOGGLE_SHORTCUT = "Shift+Tab";
export const THREAD_ATTACH_FILES_SHORTCUT = "Mod+U";
export const THREAD_TASKS_SIDEBAR_HOTKEY = "T";
export const THREAD_LIST_TOGGLE_HOTKEY = "[";
export const THREAD_TOGGLE_DONE_HOTKEY = "D";
export const THREAD_TOGGLE_READ_HOTKEY = "R";
// GitHub's stack shortcuts in the PR reader.
export const PR_STACK_LAYER_ABOVE_HOTKEY = "Shift+K";
export const PR_STACK_LAYER_BELOW_HOTKEY = "Shift+J";
export const IMAGE_UPLOAD_SHORTCUT_KEY = "Mod+Shift+I";
export const COLOR_HIGHLIGHT_SHORTCUT_KEY = "Mod+Shift+H";
export const SIDEBAR_TOGGLE_SHORTCUT = "Mod+B";
export const TASK_QUICK_OPEN_HOTKEY = "Mod+K";

export const TASK_TABLE_HOTKEYS = {
  navigateUp: "ArrowUp",
  navigateDown: "ArrowDown",
  navigateUpAlt: "K",
  navigateDownAlt: "J",
  extendUp: "Shift+ArrowUp",
  extendDown: "Shift+ArrowDown",
  reorderUp: "Mod+ArrowUp",
  reorderDown: "Mod+ArrowDown",
  expand: "ArrowRight",
  collapse: "ArrowLeft",
  indent: "Tab",
  outdent: "Shift+Tab",
  edit: "Enter",
  clearSelection: "Escape",
  openDetails: "Mod+Enter",
  toggleStatus: "Space",
  setStatusPrefix: "S",
  setTypePrefix: "T",
  delete: "Mod+Backspace",
  duplicate: "Mod+D",
  // Single keys on the focused or selected task; table and board (lib/tasks/metadata-shortcuts.ts).
  setPriority: "P",
  setAssignee: "A",
  assignToMe: "I",
  setLabel: "L",
  setDueDate: "D",
  moveToList: "M",
} as const;

// Open task panel (docs/specs/keyboard-navigation.md#task-panel).
export const TASK_PANEL_HOTKEYS = {
  close: "Escape",
  next: "J",
  previous: "K",
} as const;

// Global: ? opens the shortcuts sheet; G then a key jumps to a page.
export const SHORTCUTS_SHEET_HOTKEY = "?";
export const GO_TO_PREFIX_HOTKEY = "G";
export const GO_TO_HOTKEYS = {
  inbox: "I",
  watchTower: "W",
  threads: "T",
  settings: "S",
} as const;

type HotkeyPlatform = "mac" | "windows";

function getHotkeyPlatform(): HotkeyPlatform {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "mac" : "windows";
}

function formatHotkeyToken(token: string, platform: HotkeyPlatform = getHotkeyPlatform()): string {
  if (token === "Mod") {
    return platform === "mac" ? "⌘" : "Ctrl";
  }

  switch (token) {
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "Space":
      return "Space";
    default:
      return token;
  }
}

export function getHotkeyKeycaps(hotkey: string, platform: HotkeyPlatform = getHotkeyPlatform()): string[] {
  return hotkey.split("+").map((token) => formatHotkeyToken(token, platform));
}

export function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    const inputType = target.type.toLowerCase();
    return inputType !== "button" && inputType !== "submit" && inputType !== "reset";
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  if (!element) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  return (
    element.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null
  );
}

const OVERLAY_LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** True inside a dialog, popover, menu or listbox; the task panel's own drawer does not count. */
export function isOverlayHotkeyTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const layer = element?.closest(OVERLAY_LAYER_SELECTOR);
  return layer != null && !layer.hasAttribute("data-task-panel");
}

export function formatHotkeyForPlatformLabel(hotkey: string): string {
  return getHotkeyKeycaps(hotkey).join("+");
}

export function formatHotkeyForCrossPlatformLabel(hotkey: string): string {
  return hotkey
    .split("+")
    .map((token) => (token === "Mod" ? "⌘/Ctrl" : formatHotkeyToken(token, "windows")))
    .join("+");
}
