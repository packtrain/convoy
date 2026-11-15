import { RefObject, useCallback, useMemo } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { TASK_TABLE_HOTKEYS } from "@/lib/browser/hotkeys";
import { useMetadataShortcutPalette } from "./use-metadata-shortcut-palette";
import type { BuiltInTaskTypeKey } from "@/lib/tasks/task-types";
import type { TaskPropertyShortcut } from "@/lib/tasks/metadata-shortcuts";
import type { Status } from "@/lib/tasks/types";
export type { ShortcutPaletteState } from "./use-metadata-shortcut-palette";

function focusRowElement(
  rowRefs: RefObject<Map<string, HTMLElement>>,
  id: string
) {
  const row = rowRefs.current?.get(id);
  if (row) {
    row.focus();
  }
}

function getFocusedTaskIdFromRefs(
  inputRefs: RefObject<Map<string, HTMLInputElement>>,
  rowRefs: RefObject<Map<string, HTMLElement>>
): string | null {
  const activeElement = document.activeElement;
  if (!activeElement) return null;

  if (activeElement.hasAttribute("data-task-input")) {
    for (const [taskId, inputEl] of inputRefs.current?.entries() ?? []) {
      if (inputEl === activeElement) {
        return taskId;
      }
    }
  }

  for (const [taskId, rowEl] of rowRefs.current?.entries() ?? []) {
    if (rowEl === activeElement) {
      return taskId;
    }
  }

  return null;
}

function getFocusedRowIdFromRefs(
  rowRefs: RefObject<Map<string, HTMLElement>>
): string | null {
  const activeElement = document.activeElement;
  if (!activeElement) return null;

  for (const [taskId, rowEl] of rowRefs.current?.entries() ?? []) {
    if (rowEl === activeElement) {
      return taskId;
    }
  }

  return null;
}

function getFocusedAddInputId(
  addTaskInputRefs?: RefObject<Map<string, HTMLInputElement>>
): string | null {
  const activeElement = document.activeElement;
  if (!activeElement?.hasAttribute("data-add-task-input")) {
    return null;
  }

  for (const [id, element] of addTaskInputRefs?.current?.entries() ?? []) {
    if (element === activeElement) {
      return id;
    }
  }

  return null;
}

interface UseKeyboardNavigationOptions {
  /** Ordered list of task IDs for selection (excludes add-task placeholders) */
  taskIds: string[];
  /** Ordered list of all navigable IDs (includes add-task placeholders). Defaults to taskIds if not provided. */
  navigableIds?: string[];
  onNavigate?: (id: string, direction: "prev" | "next") => boolean;
  /** Currently selected IDs */
  selectedIds: Set<string>;
  /** Update selected IDs */
  setSelectedIds: (ids: Set<string>) => void;
  /** Last selected ID (anchor for range selection) */
  lastSelectedId: string | null;
  /** Update last selected ID */
  setLastSelectedId: (id: string | null) => void;
  /** Focus an input field */
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
  /** Reorder a single task (targetId=null means append to end) */
  reorderTasks: (sourceId: string, targetId: string | null) => void;
  /** Reference to input elements map */
  inputRefs: RefObject<Map<string, HTMLInputElement>>;
  /** Reference to row elements map */
  rowRefs: RefObject<Map<string, HTMLElement>>;
  /** Container ref to check if focus is within */
  containerRef: RefObject<HTMLElement | null>;
  /** Whether keyboard navigation is enabled */
  enabled?: boolean;
  /** False for read-only viewers: write hotkeys are not registered (docs/specs/keyboard-navigation.md). */
  canUpdateTask?: boolean;
  /** Toggle status for selected tasks (space bar) */
  onToggleStatus?: (ids: string[]) => void;
  /** Set status for selected/focused tasks via two-key shortcut */
  onSetStatus?: (ids: string[], status: Status) => void;
  /** Set task type for selected/focused tasks via two-key shortcut */
  onSetTaskType?: (ids: string[], taskTypeKey: BuiltInTaskTypeKey) => void;
  /** Project-specific statuses available for status shortcuts */
  allowedStatuses?: Status[];
  /** P/A/I/L/D/M on the selected or focused rows (write shortcut). */
  onPropertyShortcut?: (property: TaskPropertyShortcut, ids: string[]) => void;
  /** Delete selected tasks (Cmd/Ctrl + Backspace) */
  onDelete?: (ids: string[]) => void;
  /** Clear current selection (Escape) */
  onClearSelection?: () => void;
  /** Duplicate selected task (Cmd/Ctrl + D) - only for single selection */
  onDuplicate?: (id: string) => void;
  /** Open details sidebar (Cmd/Ctrl + Enter) - only for single selection */
  onOpenDetails?: (id: string) => void;
  /** Toggle expansion for a task (Right/Left arrow) */
  onToggleExpand?: (id: string) => void;
  /** Check if a task can be expanded (has children) */
  canExpand?: (id: string) => boolean;
  /** Check if a task is currently expanded */
  isExpanded?: (id: string) => boolean;
  /** Refs for add-task inputs (for keyboard navigation) */
  addTaskInputRefs?: RefObject<Map<string, HTMLInputElement>>;
  /** Indent task(s) (Tab) - make children of previous sibling */
  onIndent?: (ids: string[]) => void;
  /** Outdent task(s) (Shift+Tab) - move to parent's level */
  onOutdent?: (ids: string[]) => void;
  /** Check if task(s) can be indented */
  canIndent?: (ids: string[]) => boolean;
  /** Check if task(s) can be outdented */
  canOutdent?: (ids: string[]) => boolean;
  /** Move a focused add-task input one level deeper/shallower */
  onMoveAddTaskInputHierarchy?: (
    id: string,
    direction: "deeper" | "shallower"
  ) => void;
}

export function useKeyboardNavigation({
  taskIds,
  navigableIds: navigableIdsProp,
  onNavigate,
  selectedIds,
  setSelectedIds,
  lastSelectedId,
  setLastSelectedId,
  focusInput,
  reorderTasks,
  inputRefs,
  rowRefs,
  containerRef,
  enabled = true,
  canUpdateTask = true,
  onToggleStatus,
  onSetStatus,
  onSetTaskType,
  allowedStatuses,
  onPropertyShortcut,
  onDelete,
  onClearSelection,
  onDuplicate,
  onOpenDetails,
  onToggleExpand,
  canExpand,
  isExpanded,
  addTaskInputRefs,
  onIndent,
  onOutdent,
  canIndent,
  canOutdent,
  onMoveAddTaskInputHierarchy,
}: UseKeyboardNavigationOptions) {
  const hotkeyTarget = typeof document === "undefined" ? null : document;
  const navigableIds = navigableIdsProp ?? taskIds;
  const hasSelection = selectedIds.size > 0;

  const isFocusOnInput = useCallback((): boolean => {
    const activeElement = document.activeElement;
    return Boolean(
      activeElement?.hasAttribute("data-task-input") ||
        activeElement?.hasAttribute("data-add-task-input")
    );
  }, []);

  const isFocusOnAddTaskInput = useCallback((): boolean => {
    const activeElement = document.activeElement;
    return Boolean(activeElement?.hasAttribute("data-add-task-input"));
  }, []);

  const isFocusOnAnyTextInput = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
      return true;
    }

    return Boolean(
      activeElement?.hasAttribute("data-task-input") ||
        activeElement?.hasAttribute("data-add-task-input") ||
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.tagName === "SELECT"
    );
  }, []);

  const isAddTaskId = useCallback((id: string) => id.startsWith("add-"), []);

  const getShortcutTargetIds = useCallback((): string[] => {
    const selectedArray = Array.from(selectedIds);
    if (selectedArray.length > 0) {
      return selectedArray;
    }

    const focusedRowId = getFocusedRowIdFromRefs(rowRefs);
    return focusedRowId && !isAddTaskId(focusedRowId) ? [focusedRowId] : [];
  }, [isAddTaskId, rowRefs, selectedIds]);

  const getAdjacentIndex = useCallback(
    (currentId: string, direction: "prev" | "next"): number => {
      const currentIndex = navigableIds.indexOf(currentId);
      if (currentIndex === -1) return -1;

      if (direction === "prev") {
        return currentIndex > 0 ? currentIndex - 1 : -1;
      }
      return currentIndex < navigableIds.length - 1 ? currentIndex + 1 : -1;
    },
    [navigableIds]
  );

  const getAdjacentTaskId = useCallback(
    (currentId: string, direction: "prev" | "next"): string | null => {
      const currentIndex = navigableIds.indexOf(currentId);
      if (currentIndex === -1) return null;

      const step = direction === "prev" ? -1 : 1;
      for (
        let index = currentIndex + step;
        index >= 0 && index < navigableIds.length;
        index += step
      ) {
        const id = navigableIds[index];
        if (!isAddTaskId(id)) {
          return id;
        }
      }

      return null;
    },
    [isAddTaskId, navigableIds]
  );

  const handleActionHotkey = useCallback(
    (hotkey: string, event: KeyboardEvent): boolean => {
      const selectedArray = Array.from(selectedIds);
      const hasSingleSelection = selectedIds.size === 1;

      if (
        hotkey === TASK_TABLE_HOTKEYS.indent ||
        hotkey === TASK_TABLE_HOTKEYS.outdent
      ) {
        if (isFocusOnAddTaskInput()) {
          if (!onMoveAddTaskInputHierarchy) {
            return false;
          }

          const focusedAddInputId = getFocusedAddInputId(addTaskInputRefs);
          if (!focusedAddInputId) {
            return false;
          }

          event.preventDefault();
          onMoveAddTaskInputHierarchy(
            focusedAddInputId,
            hotkey === TASK_TABLE_HOTKEYS.indent ? "deeper" : "shallower"
          );
          return true;
        }

        const focusedTaskId = getFocusedTaskIdFromRefs(inputRefs, rowRefs);
        const tabTargetIds =
          selectedArray.length > 0
            ? selectedArray
            : focusedTaskId && !isAddTaskId(focusedTaskId)
              ? [focusedTaskId]
              : [];
        if (tabTargetIds.length === 0) return false;

        if (hotkey === TASK_TABLE_HOTKEYS.indent && onIndent && canIndent) {
          event.preventDefault();
          if (canIndent(tabTargetIds)) {
            onIndent(tabTargetIds);
          }
          return true;
        }

        if (hotkey === TASK_TABLE_HOTKEYS.outdent && onOutdent && canOutdent) {
          event.preventDefault();
          if (canOutdent(tabTargetIds)) {
            onOutdent(tabTargetIds);
          }
          return true;
        }

        return false;
      }

      if (hotkey === TASK_TABLE_HOTKEYS.openDetails) {
        if (onOpenDetails && hasSingleSelection && !isFocusOnInput()) {
          event.preventDefault();
          onOpenDetails(selectedArray[0]);
          return true;
        }
        return false;
      }

      if (hotkey === TASK_TABLE_HOTKEYS.edit) {
        const focusedRowId = getFocusedRowIdFromRefs(rowRefs);
        if (
          focusedRowId &&
          selectedIds.has(focusedRowId) &&
          !isFocusOnInput()
        ) {
          event.preventDefault();
          focusInput(focusedRowId, "end");
          return true;
        }
        return false;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.expand &&
        onToggleExpand &&
        canExpand &&
        isExpanded &&
        hasSingleSelection
      ) {
        if (!isFocusOnInput()) {
          const selectedId = selectedArray[0];
          if (canExpand(selectedId) && !isExpanded(selectedId)) {
            event.preventDefault();
            onToggleExpand(selectedId);
            return true;
          }
        }
        return false;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.collapse &&
        onToggleExpand &&
        isExpanded &&
        hasSingleSelection
      ) {
        if (!isFocusOnInput()) {
          const selectedId = selectedArray[0];
          if (isExpanded(selectedId)) {
            event.preventDefault();
            onToggleExpand(selectedId);
            return true;
          }
        }
        return false;
      }

      if (hotkey === TASK_TABLE_HOTKEYS.toggleStatus && onToggleStatus) {
        const focusedRowId = getFocusedRowIdFromRefs(rowRefs);
        if (
          focusedRowId &&
          selectedIds.has(focusedRowId) &&
          !isFocusOnInput()
        ) {
          event.preventDefault();
          onToggleStatus(selectedArray);
          return true;
        }
        return false;
      }

      if (hotkey === TASK_TABLE_HOTKEYS.delete && onDelete && hasSelection) {
        if (!isFocusOnAnyTextInput()) {
          event.preventDefault();
          onDelete(selectedArray);
          return true;
        }
        return false;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.clearSelection &&
        onClearSelection &&
        hasSelection
      ) {
        if (!isFocusOnAnyTextInput()) {
          event.preventDefault();
          onClearSelection();
          return true;
        }
        return false;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.duplicate &&
        onDuplicate &&
        hasSingleSelection
      ) {
        if (!isFocusOnAnyTextInput()) {
          event.preventDefault();
          onDuplicate(selectedArray[0]);
          return true;
        }
        return false;
      }

      return false;
    },
    [
      addTaskInputRefs,
      canExpand,
      canIndent,
      canOutdent,
      focusInput,
      hasSelection,
      inputRefs,
      isAddTaskId,
      isExpanded,
      isFocusOnAddTaskInput,
      isFocusOnAnyTextInput,
      isFocusOnInput,
      onClearSelection,
      onDelete,
      onDuplicate,
      onIndent,
      onMoveAddTaskInputHierarchy,
      onOpenDetails,
      onOutdent,
      onToggleExpand,
      onToggleStatus,
      rowRefs,
      selectedIds,
    ]
  );

  const handleNavigationHotkey = useCallback(
    (hotkey: string, event: KeyboardEvent) => {
      const isReorder =
        hotkey === TASK_TABLE_HOTKEYS.reorderUp ||
        hotkey === TASK_TABLE_HOTKEYS.reorderDown;
      const isExtend =
        hotkey === TASK_TABLE_HOTKEYS.extendUp ||
        hotkey === TASK_TABLE_HOTKEYS.extendDown;
      const direction =
        hotkey === TASK_TABLE_HOTKEYS.navigateUp ||
        hotkey === TASK_TABLE_HOTKEYS.extendUp ||
        hotkey === TASK_TABLE_HOTKEYS.reorderUp
          ? "prev"
          : "next";

      const focusedAddInputId = getFocusedAddInputId(addTaskInputRefs);
      if (focusedAddInputId) {
        const adjacentIndex = getAdjacentIndex(focusedAddInputId, direction);
        if (adjacentIndex === -1) return;

        const adjacentId = navigableIds[adjacentIndex];
        event.preventDefault();

        if (isAddTaskId(adjacentId)) {
          addTaskInputRefs?.current?.get(adjacentId)?.focus();
        } else {
          setSelectedIds(new Set([adjacentId]));
          setLastSelectedId(adjacentId);
          focusRowElement(rowRefs, adjacentId);
        }
        return;
      }

      const currentId =
        getFocusedTaskIdFromRefs(inputRefs, rowRefs) ||
        lastSelectedId ||
        Array.from(selectedIds)[0] ||
        null;
      if (!currentId) return;
      if (!isReorder && !isExtend && onNavigate?.(currentId, direction)) {
        event.preventDefault();
        return;
      }

      const adjacentIndex = getAdjacentIndex(currentId, direction);
      if (adjacentIndex === -1) return;

      const adjacentId = navigableIds[adjacentIndex];

      event.preventDefault();

      if (isReorder) {
        if (selectedIds.size > 1) {
          return;
        }

        let targetId: string | null = adjacentId;
        if (direction === "next") {
          const targetIndex = adjacentIndex + 1;
          targetId = targetIndex < taskIds.length ? taskIds[targetIndex] : null;
        }

        reorderTasks(currentId, targetId);
        focusRowElement(rowRefs, currentId);
        return;
      }

      if (isExtend) {
        const anchorId = lastSelectedId || currentId;
        const anchorIndex = taskIds.indexOf(anchorId);
        const cursorId = getAdjacentTaskId(currentId, direction);
        if (!cursorId || anchorIndex === -1) return;

        const newCursorIndex = taskIds.indexOf(cursorId);
        if (newCursorIndex === -1) return;

        const [startIndex, endIndex] =
          anchorIndex <= newCursorIndex
            ? [anchorIndex, newCursorIndex]
            : [newCursorIndex, anchorIndex];

        setSelectedIds(new Set(taskIds.slice(startIndex, endIndex + 1)));
        focusRowElement(rowRefs, cursorId);
        return;
      }

      if (isAddTaskId(adjacentId)) {
        setSelectedIds(new Set());
        addTaskInputRefs?.current?.get(adjacentId)?.focus();
      } else {
        setSelectedIds(new Set([adjacentId]));
        setLastSelectedId(adjacentId);
        focusRowElement(rowRefs, adjacentId);
      }
    },
    [
      addTaskInputRefs,
      onNavigate,
      getAdjacentIndex,
      getAdjacentTaskId,
      inputRefs,
      isAddTaskId,
      lastSelectedId,
      navigableIds,
      reorderTasks,
      rowRefs,
      selectedIds,
      setLastSelectedId,
      setSelectedIds,
      taskIds,
    ]
  );

  const shouldHandleHotkey = useCallback(() => {
    const container = containerRef.current;
    const activeElement = document.activeElement;
    const hasFocusWithin = container?.contains(activeElement);

    return hasFocusWithin || (activeElement === document.body && hasSelection);
  }, [containerRef, hasSelection]);

  const { shortcutPalette } = useMetadataShortcutPalette({
    hotkeyTarget,
    containerRef,
    hasSelection,
    enabled: enabled && canUpdateTask,
    onSetStatus,
    onSetTaskType,
    allowedStatuses,
    onPropertyShortcut,
    getShortcutTargetIds,
  });

  const dispatchHotkey = useCallback(
    (hotkey: string, event: KeyboardEvent) => {
      if (!enabled || !shouldHandleHotkey()) {
        return;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.navigateUpAlt ||
        hotkey === TASK_TABLE_HOTKEYS.navigateDownAlt
      ) {
        // Letters type in fields, unlike the arrows.
        if (isFocusOnAnyTextInput()) return;
        handleNavigationHotkey(
          hotkey === TASK_TABLE_HOTKEYS.navigateUpAlt
            ? TASK_TABLE_HOTKEYS.navigateUp
            : TASK_TABLE_HOTKEYS.navigateDown,
          event
        );
        return;
      }

      if (
        hotkey === TASK_TABLE_HOTKEYS.navigateUp ||
        hotkey === TASK_TABLE_HOTKEYS.navigateDown ||
        hotkey === TASK_TABLE_HOTKEYS.extendUp ||
        hotkey === TASK_TABLE_HOTKEYS.extendDown ||
        hotkey === TASK_TABLE_HOTKEYS.reorderUp ||
        hotkey === TASK_TABLE_HOTKEYS.reorderDown
      ) {
        handleNavigationHotkey(hotkey, event);
        return;
      }

      handleActionHotkey(hotkey, event);
    },
    [enabled, handleActionHotkey, handleNavigationHotkey, isFocusOnAnyTextInput, shouldHandleHotkey]
  );

  const sharedHotkeyOptions = useMemo(
    () =>
      ({
        target: hotkeyTarget,
        enabled,
        ignoreInputs: false,
        preventDefault: false,
        stopPropagation: false,
        // The main task table and the sidebar subtask table can both be mounted
        // with the same document-level shortcuts. Actual handling is gated by
        // container focus, so shared registrations are intentional.
        conflictBehavior: "allow",
      }) as const,
    [enabled, hotkeyTarget]
  );
  // Unregistered rather than inert, so a viewer's key keeps its default action.
  const writeHotkeyOptions = useMemo(
    () => ({ ...sharedHotkeyOptions, enabled: enabled && canUpdateTask }),
    [canUpdateTask, enabled, sharedHotkeyOptions]
  );

  useHotkey(
    TASK_TABLE_HOTKEYS.navigateUp,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.navigateDown,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.navigateUpAlt,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.navigateDownAlt,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.extendUp,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.extendDown,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.reorderUp,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.reorderDown,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.expand,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.collapse,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.indent,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.outdent,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.edit,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.openDetails,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.toggleStatus,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.delete,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.clearSelection,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    sharedHotkeyOptions
  );
  useHotkey(
    TASK_TABLE_HOTKEYS.duplicate,
    (event, context) => {
      dispatchHotkey(context.hotkey, event);
    },
    writeHotkeyOptions
  );

  return { shortcutPalette };
}
