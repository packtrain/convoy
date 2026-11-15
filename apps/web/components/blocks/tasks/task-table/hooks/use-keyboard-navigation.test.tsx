/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useKeyboardNavigation } from "./use-keyboard-navigation";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";
import { Status } from "@/lib/tasks/status";

interface SetupOptions {
  taskIds?: string[];
  navigableIds?: string[];
  selectedIds?: Set<string>;
  lastSelectedId?: string | null;
  enabled?: boolean;
  canExpand?: (id: string) => boolean;
  isExpanded?: (id: string) => boolean;
  canIndent?: (ids: string[]) => boolean;
  canOutdent?: (ids: string[]) => boolean;
  onMoveAddTaskInputHierarchy?: (
    id: string,
    direction: "deeper" | "shallower"
  ) => void;
  allowedStatuses?: Status[];
  canUpdateTask?: boolean;
}

function createTestSetup(options: SetupOptions = {}) {
  const taskIds = options.taskIds ?? ["task-1", "task-2", "task-3"];
  const navigableIds = options.navigableIds ?? taskIds;

  // Create container and append to document
  const container = document.createElement("div");
  document.body.appendChild(container);

  // Mock refs
  const inputRefs = { current: new Map<string, HTMLInputElement>() };
  const rowRefs = { current: new Map<string, HTMLElement>() };
  const containerRef = { current: container };
  const addTaskInputRefs = { current: new Map<string, HTMLInputElement>() };

  // Create mock DOM elements for each task
  taskIds.forEach((id) => {
    const input = document.createElement("input");
    input.setAttribute("data-task-input", "true");
    inputRefs.current.set(id, input);
    container.appendChild(input);

    const row = document.createElement("div");
    row.tabIndex = 0;
    rowRefs.current.set(id, row);
    container.appendChild(row);
  });

  // Create add-task inputs if navigableIds contains them
  navigableIds.forEach((id) => {
    if (id.startsWith("add-")) {
      const addInput = document.createElement("input");
      addInput.setAttribute("data-add-task-input", "true");
      addTaskInputRefs.current.set(id, addInput);
      container.appendChild(addInput);
    }
  });

  // Mock callbacks
  const callbacks = {
    setSelectedIds: vi.fn(),
    setLastSelectedId: vi.fn(),
    focusInput: vi.fn(),
    reorderTasks: vi.fn(),
    onToggleStatus: vi.fn(),
    onSetStatus: vi.fn(),
    onSetTaskType: vi.fn(),
    onDelete: vi.fn(),
    onClearSelection: vi.fn(),
    onDuplicate: vi.fn(),
    onOpenDetails: vi.fn(),
    onToggleExpand: vi.fn(),
    onIndent: vi.fn(),
    onOutdent: vi.fn(),
    onMoveAddTaskInputHierarchy: vi.fn(
      options.onMoveAddTaskInputHierarchy ?? (() => {})
    ),
    onPropertyShortcut: vi.fn(),
  };

  const hookProps = {
    taskIds,
    navigableIds,
    selectedIds: options.selectedIds ?? new Set<string>(),
    setSelectedIds: callbacks.setSelectedIds,
    lastSelectedId: options.lastSelectedId ?? null,
    setLastSelectedId: callbacks.setLastSelectedId,
    focusInput: callbacks.focusInput,
    reorderTasks: callbacks.reorderTasks,
    inputRefs,
    rowRefs,
    containerRef,
    enabled: options.enabled ?? true,
    onToggleStatus: callbacks.onToggleStatus,
    onSetStatus: callbacks.onSetStatus,
    onSetTaskType: callbacks.onSetTaskType,
    allowedStatuses: options.allowedStatuses,
    onDelete: callbacks.onDelete,
    onClearSelection: callbacks.onClearSelection,
    onDuplicate: callbacks.onDuplicate,
    onOpenDetails: callbacks.onOpenDetails,
    onToggleExpand: callbacks.onToggleExpand,
    canExpand: options.canExpand ?? (() => false),
    isExpanded: options.isExpanded ?? (() => false),
    addTaskInputRefs,
    onIndent: callbacks.onIndent,
    onOutdent: callbacks.onOutdent,
    canIndent: options.canIndent ?? (() => true),
    canOutdent: options.canOutdent ?? (() => true),
    onMoveAddTaskInputHierarchy: callbacks.onMoveAddTaskInputHierarchy,
    onPropertyShortcut: callbacks.onPropertyShortcut,
    canUpdateTask: options.canUpdateTask,
  };

  return {
    taskIds,
    navigableIds,
    inputRefs,
    rowRefs,
    containerRef,
    addTaskInputRefs,
    callbacks,
    hookProps,
    cleanup: () => {
      document.body.removeChild(container);
    },
  };
}

function fireKeyDown(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useKeyboardNavigation", () => {
  beforeEach(() => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    cleanup();
  });

  describe("Two-key metadata shortcuts", () => {
    test("S opens the status palette and applies a focused-row status", () => {
      const setup = createTestSetup();
      setup.rowRefs.current.get("task-1")!.focus();

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");
      expect(result.current.shortcutPalette?.options.map((option) => option.key)).toContain("D");

      act(() => {
        fireKeyDown("D");
      });

      expect(setup.callbacks.onSetStatus).toHaveBeenCalledWith(
        ["task-1"],
        Status.DONE
      );
      expect(result.current.shortcutPalette).toBeNull();

      setup.cleanup();
    });

    test("T opens the task type palette and applies selected-row task type", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
      });

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("T");
      });

      expect(result.current.shortcutPalette?.mode).toBe("type");

      act(() => {
        fireKeyDown("C");
      });

      expect(setup.callbacks.onSetTaskType).toHaveBeenCalledWith(
        ["task-1", "task-2"],
        "chore"
      );
      expect(result.current.shortcutPalette).toBeNull();

      setup.cleanup();
    });

    test("S opens the status palette when a row is selected and focus is on the body", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
      });
      document.body.tabIndex = -1;
      document.body.focus();

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");

      act(() => {
        fireKeyDown("D");
      });

      expect(setup.callbacks.onSetStatus).toHaveBeenCalledWith(
        ["task-1"],
        Status.DONE
      );

      document.body.removeAttribute("tabindex");
      setup.cleanup();
    });

    test("S is ignored when a selected row exists but focus is on another control", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
      });
      const externalButton = document.createElement("button");
      document.body.appendChild(externalButton);
      externalButton.focus();

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette).toBeNull();
      expect(setup.callbacks.onSetStatus).not.toHaveBeenCalled();

      document.body.removeChild(externalButton);
      setup.cleanup();
    });

    test("status palette filters out statuses disallowed by the project", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        allowedStatuses: [Status.TODO, Status.DONE],
      });

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.options).toEqual([
        { key: "O", label: "To Do" },
        { key: "D", label: "Done" },
      ]);

      act(() => {
        fireKeyDown("C");
      });

      expect(setup.callbacks.onSetStatus).not.toHaveBeenCalled();
      expect(result.current.shortcutPalette).toBeNull();

      setup.cleanup();
    });

    test("ArrowDown dismisses an active shortcut palette and still navigates", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });
      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");

      act(() => {
        fireKeyDown("ArrowDown");
      });

      expect(result.current.shortcutPalette).toBeNull();
      expect(setup.callbacks.onSetStatus).not.toHaveBeenCalled();
      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-2"])
      );

      setup.cleanup();
    });

    test("plain C still bubbles, but S then C is captured for Canceled", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });
      const createAtTop = vi.fn();
      document.addEventListener("keydown", createAtTop);

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("C");
      expect(createAtTop).toHaveBeenCalledTimes(1);

      act(() => {
        fireKeyDown("S");
      });
      act(() => {
        fireKeyDown("C");
      });

      expect(setup.callbacks.onSetStatus).toHaveBeenCalledWith(
        ["task-1"],
        Status.CANCELED
      );
      expect(createAtTop).toHaveBeenCalledTimes(1);

      document.removeEventListener("keydown", createAtTop);
      setup.cleanup();
    });

    test("Escape dismisses an active shortcut palette", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });
      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");

      act(() => {
        fireKeyDown("Escape");
      });

      expect(result.current.shortcutPalette).toBeNull();

      setup.cleanup();
    });

    test("shortcut palette auto-dismisses after timeout", () => {
      vi.useFakeTimers();
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });
      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(result.current.shortcutPalette).toBeNull();
      vi.useRealTimers();

      setup.cleanup();
    });

    test("shortcut palette closes when keyboard navigation is disabled", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useKeyboardNavigation({
            ...setup.hookProps,
            enabled,
          }),
        { initialProps: { enabled: true } }
      );

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette?.mode).toBe("status");

      rerender({ enabled: false });

      expect(result.current.shortcutPalette).toBeNull();

      setup.cleanup();
    });

    test("shortcut prefixes are ignored while a task input is focused", () => {
      const setup = createTestSetup();
      setup.inputRefs.current.get("task-1")!.focus();

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("S");
      });

      expect(result.current.shortcutPalette).toBeNull();
      expect(setup.callbacks.onSetStatus).not.toHaveBeenCalled();

      setup.cleanup();
    });
  });

  describe("Single-key property shortcuts", () => {
    test.each([
      ["P", "priority"],
      ["A", "assignee"],
      ["I", "assignToMe"],
      ["L", "label"],
      ["D", "dueDate"],
      ["M", "moveToList"],
    ])("%s acts on the focused row (%s) and claims the key", (key, property) => {
      const setup = createTestSetup();
      setup.rowRefs.current.get("task-2")!.focus();
      const bubbled = vi.fn();
      document.addEventListener("keydown", bubbled);

      renderHook(() => useKeyboardNavigation(setup.hookProps));
      let event: KeyboardEvent | undefined;
      act(() => {
        event = fireKeyDown(key.toLowerCase());
      });

      expect(setup.callbacks.onPropertyShortcut).toHaveBeenCalledWith(property, ["task-2"]);
      expect(event?.defaultPrevented).toBe(true);
      expect(bubbled).not.toHaveBeenCalled();

      document.removeEventListener("keydown", bubbled);
      setup.cleanup();
    });

    test("acts on every selected row when focus is on the body", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1", "task-3"]) });

      renderHook(() => useKeyboardNavigation(setup.hookProps));
      act(() => {
        fireKeyDown("p");
      });

      expect(setup.callbacks.onPropertyShortcut).toHaveBeenCalledWith("priority", ["task-1", "task-3"]);
      setup.cleanup();
    });

    test("does not fire while typing in a task input, with modifiers, or for viewers", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });
      setup.inputRefs.current.get("task-1")!.focus();
      const { unmount } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      act(() => {
        fireKeyDown("p");
      });
      setup.rowRefs.current.get("task-1")!.focus();
      act(() => {
        fireKeyDown("d", { meta: true });
        fireKeyDown("P", { shift: true });
      });
      unmount();

      renderHook(() => useKeyboardNavigation({ ...setup.hookProps, canUpdateTask: false }));
      act(() => {
        fireKeyDown("p");
      });

      expect(setup.callbacks.onPropertyShortcut).not.toHaveBeenCalled();
      setup.cleanup();
    });

    test("the status palette keeps its second key: S then P sets In Progress", () => {
      const setup = createTestSetup({ selectedIds: new Set(["task-1"]) });

      renderHook(() => useKeyboardNavigation(setup.hookProps));
      act(() => {
        fireKeyDown("S");
      });
      act(() => {
        fireKeyDown("P");
      });

      expect(setup.callbacks.onSetStatus).toHaveBeenCalledWith(["task-1"], Status.IN_PROGRESS);
      expect(setup.callbacks.onPropertyShortcut).not.toHaveBeenCalled();
      setup.cleanup();
    });
  });

  describe("J / K navigation", () => {
    test("J and K move selection like the arrow keys", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });
      setup.rowRefs.current.get("task-2")!.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));
      fireKeyDown("j");
      expect(setup.callbacks.setSelectedIds).toHaveBeenLastCalledWith(new Set(["task-3"]));

      // Focus followed J to task-3, so K comes back to task-2.
      fireKeyDown("k");
      expect(setup.callbacks.setSelectedIds).toHaveBeenLastCalledWith(new Set(["task-2"]));

      setup.cleanup();
    });

    test("J types normally in a task input", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });
      setup.inputRefs.current.get("task-2")!.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));
      const event = fireKeyDown("j");

      expect(event.defaultPrevented).toBe(false);
      expect(setup.callbacks.setSelectedIds).not.toHaveBeenCalled();
      setup.cleanup();
    });
  });

  describe("Navigation (Arrow Keys)", () => {
    test("ArrowDown moves selection to next task", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      // Focus the row so the hook processes the event
      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-2"])
      );
      expect(setup.callbacks.setLastSelectedId).toHaveBeenCalledWith("task-2");

      setup.cleanup();
    });

    test("ArrowUp moves selection to previous task", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowUp");

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-1"])
      );
      expect(setup.callbacks.setLastSelectedId).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("ArrowDown at end of list does nothing", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-3"]),
        lastSelectedId: "task-3",
      });

      const row = setup.rowRefs.current.get("task-3")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("ArrowUp at start of list does nothing", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowUp");

      expect(setup.callbacks.setSelectedIds).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Navigation from add-task input to task", () => {
      const setup = createTestSetup({
        taskIds: ["task-1", "task-2"],
        navigableIds: ["add-top", "task-1", "task-2"],
        selectedIds: new Set(),
      });

      const addInput = setup.addTaskInputRefs.current.get("add-top")!;
      addInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-1"])
      );
      expect(setup.callbacks.setLastSelectedId).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("Navigation from task to add-task input clears selection", () => {
      const setup = createTestSetup({
        taskIds: ["task-1", "task-2"],
        navigableIds: ["task-1", "task-2", "add-bottom"],
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(new Set());

      setup.cleanup();
    });

    test("multiple task tables can register the same hotkeys without warnings", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const primarySetup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });
      const secondarySetup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      primarySetup.rowRefs.current.get("task-1")!.focus();

      const primaryHook = renderHook(() =>
        useKeyboardNavigation(primarySetup.hookProps)
      );
      const secondaryHook = renderHook(() =>
        useKeyboardNavigation(secondarySetup.hookProps)
      );

      fireKeyDown("ArrowDown");

      expect(warnSpy).not.toHaveBeenCalled();
      expect(primarySetup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-2"])
      );
      expect(secondarySetup.callbacks.setSelectedIds).not.toHaveBeenCalled();

      primaryHook.unmount();
      secondaryHook.unmount();
      primarySetup.cleanup();
      secondarySetup.cleanup();
      warnSpy.mockRestore();
    });
  });

  describe("Range Selection (Shift+Arrow)", () => {
    test("Shift+ArrowDown extends selection downward", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-1", "task-2"])
      );
      // lastSelectedId should NOT change (anchor stays fixed)
      expect(setup.callbacks.setLastSelectedId).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Shift+ArrowUp extends selection upward", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-3"]),
        lastSelectedId: "task-3",
      });

      const row = setup.rowRefs.current.get("task-3")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowUp", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-2", "task-3"])
      );

      setup.cleanup();
    });

    test("Shift+Arrow maintains anchor and expands selection", () => {
      const setup = createTestSetup({
        taskIds: ["task-1", "task-2", "task-3", "task-4"],
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      const { rerender } = renderHook(
        (props) => useKeyboardNavigation(props),
        { initialProps: setup.hookProps }
      );

      // First shift+down
      fireKeyDown("ArrowDown", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenLastCalledWith(
        new Set(["task-2", "task-3"])
      );

      // Update props for second keystroke
      const updatedProps = {
        ...setup.hookProps,
        selectedIds: new Set(["task-2", "task-3"]),
      };
      rerender(updatedProps);

      // Second shift+down
      fireKeyDown("ArrowDown", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenLastCalledWith(
        new Set(["task-2", "task-3", "task-4"])
      );

      setup.cleanup();
    });

    test("Shift+ArrowDown skips expanded subtask add inputs", () => {
      const setup = createTestSetup({
        taskIds: ["parent", "child", "next"],
        navigableIds: ["parent", "child", "add-parent", "next"],
        selectedIds: new Set(["child"]),
        lastSelectedId: "child",
      });

      const row = setup.rowRefs.current.get("child")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["child", "next"])
      );
      expect(document.activeElement).toBe(setup.rowRefs.current.get("next"));

      setup.cleanup();
    });

    test("Shift+ArrowUp skips expanded subtask add inputs", () => {
      const setup = createTestSetup({
        taskIds: ["previous", "parent", "child", "next"],
        navigableIds: ["previous", "parent", "child", "add-parent", "next"],
        selectedIds: new Set(["next"]),
        lastSelectedId: "next",
      });

      const row = setup.rowRefs.current.get("next")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowUp", { shift: true });

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["child", "next"])
      );
      expect(document.activeElement).toBe(setup.rowRefs.current.get("child"));

      setup.cleanup();
    });
  });

  describe("Reorder (Cmd/Ctrl+Arrow)", () => {
    test("Cmd+ArrowDown moves task down", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown", { meta: true });

      // Moving down: task-1 should be placed before task-3 (skipping task-2)
      expect(setup.callbacks.reorderTasks).toHaveBeenCalledWith(
        "task-1",
        "task-3"
      );

      setup.cleanup();
    });

    test("Cmd+ArrowUp moves task up", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowUp", { meta: true });

      expect(setup.callbacks.reorderTasks).toHaveBeenCalledWith(
        "task-2",
        "task-1"
      );

      setup.cleanup();
    });

    test("Cmd+ArrowDown at second-to-last moves to end (null target)", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown", { meta: true });

      // Moving task-2 down past task-3 should result in null (append to end)
      expect(setup.callbacks.reorderTasks).toHaveBeenCalledWith("task-2", null);

      setup.cleanup();
    });

    test("Cmd+Arrow does nothing for multi-selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown", { meta: true });

      expect(setup.callbacks.reorderTasks).not.toHaveBeenCalled();

      setup.cleanup();
    });
  });

  describe("Action Callbacks", () => {
    test("Space calls onToggleStatus with selected IDs", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown(" ");

      expect(setup.callbacks.onToggleStatus).toHaveBeenCalledWith([
        "task-1",
        "task-2",
      ]);

      setup.cleanup();
    });

    test("Space does nothing when focus is on input", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown(" ");

      expect(setup.callbacks.onToggleStatus).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Cmd+Backspace calls onDelete with selected IDs", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Backspace", { meta: true });

      expect(setup.callbacks.onDelete).toHaveBeenCalledWith([
        "task-1",
        "task-2",
      ]);

      setup.cleanup();
    });

    test("Cmd+Backspace does nothing when focus is on input", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Backspace", { meta: true });

      expect(setup.callbacks.onDelete).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Cmd+D calls onDuplicate for single selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("d", { meta: true });

      expect(setup.callbacks.onDuplicate).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("Cmd+D still duplicates when the keyboard event key is uppercase", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("D", { meta: true });

      expect(setup.callbacks.onDuplicate).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("Cmd+D does nothing for multi-selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("d", { meta: true });

      expect(setup.callbacks.onDuplicate).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Cmd+Enter calls onOpenDetails for single selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Enter", { meta: true });

      expect(setup.callbacks.onOpenDetails).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("Cmd+Enter does nothing for multi-selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Enter", { meta: true });

      expect(setup.callbacks.onOpenDetails).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Enter calls focusInput when row is focused", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Enter");

      expect(setup.callbacks.focusInput).toHaveBeenCalledWith("task-1", "end");

      setup.cleanup();
    });

    test("Enter does nothing when input is already focused", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Enter");

      expect(setup.callbacks.focusInput).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Escape clears multi-selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Escape clears single selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Escape clears selection when focus is on body", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      document.body.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).toHaveBeenCalledTimes(1);

      setup.cleanup();
    });

    test("Escape does nothing when focus is on task input", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      setup.cleanup();
    });
  });

  describe("Expand/Collapse (Left/Right Arrows)", () => {
    test("ArrowRight expands collapsed task with children", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canExpand: (id) => id === "task-1",
        isExpanded: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowRight");

      expect(setup.callbacks.onToggleExpand).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("ArrowRight does nothing if already expanded", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canExpand: (id) => id === "task-1",
        isExpanded: (id) => id === "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowRight");

      expect(setup.callbacks.onToggleExpand).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("ArrowRight does nothing if task has no children", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canExpand: () => false,
        isExpanded: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowRight");

      expect(setup.callbacks.onToggleExpand).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("ArrowLeft collapses expanded task", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canExpand: (id) => id === "task-1",
        isExpanded: (id) => id === "task-1",
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowLeft");

      expect(setup.callbacks.onToggleExpand).toHaveBeenCalledWith("task-1");

      setup.cleanup();
    });

    test("ArrowLeft does nothing if already collapsed", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canExpand: (id) => id === "task-1",
        isExpanded: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowLeft");

      expect(setup.callbacks.onToggleExpand).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("ArrowRight does nothing for multi-selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
        canExpand: () => true,
        isExpanded: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowRight");

      expect(setup.callbacks.onToggleExpand).not.toHaveBeenCalled();

      setup.cleanup();
    });
  });

  describe("Indent/Outdent (Tab/Shift+Tab)", () => {
    test("Tab calls onIndent when canIndent returns true", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
        canIndent: () => true,
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).toHaveBeenCalledWith(["task-2"]);

      setup.cleanup();
    });

    test("Tab does nothing when canIndent returns false", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canIndent: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Tab on task input indents selected task and prevents default focus traversal", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canIndent: () => true,
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).toHaveBeenCalledWith(["task-1"]);
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Tab on task input indents focused task when selection is empty", () => {
      const setup = createTestSetup({
        selectedIds: new Set(),
        lastSelectedId: null,
        canIndent: () => true,
      });

      const input = setup.inputRefs.current.get("task-1")!;
      input.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).toHaveBeenCalledWith(["task-1"]);
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Tab on add-task input moves the add input one level deeper", () => {
      const setup = createTestSetup({
        navigableIds: ["task-1", "task-2", "task-3", "add-root"],
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canIndent: () => true,
      });

      const addInput = setup.addTaskInputRefs.current.get("add-root")!;
      addInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).not.toHaveBeenCalled();
      expect(setup.callbacks.onMoveAddTaskInputHierarchy).toHaveBeenCalledWith(
        "add-root",
        "deeper"
      );
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Shift+Tab on add-task input moves the add input one level shallower", () => {
      const setup = createTestSetup({
        navigableIds: ["task-1", "add-task-1", "add-root"],
      });

      const addInput = setup.addTaskInputRefs.current.get("add-task-1")!;
      addInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab", { shift: true });

      expect(setup.callbacks.onOutdent).not.toHaveBeenCalled();
      expect(setup.callbacks.onMoveAddTaskInputHierarchy).toHaveBeenCalledWith(
        "add-task-1",
        "shallower"
      );
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Shift+Tab calls onOutdent when canOutdent returns true", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
        canOutdent: () => true,
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Tab", { shift: true });

      expect(setup.callbacks.onOutdent).toHaveBeenCalledWith(["task-2"]);

      setup.cleanup();
    });

    test("Shift+Tab does nothing when canOutdent returns false", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canOutdent: () => false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Tab", { shift: true });

      expect(setup.callbacks.onOutdent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);

      setup.cleanup();
    });

    test("Tab works for multiple selected tasks", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2", "task-3"]),
        lastSelectedId: "task-2",
        canIndent: () => true,
      });

      const row = setup.rowRefs.current.get("task-2")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Tab");

      expect(setup.callbacks.onIndent).toHaveBeenCalledWith(
        expect.arrayContaining(["task-2", "task-3"])
      );

      setup.cleanup();
    });
  });

  describe("Read-only viewer (canUpdateTask false)", () => {
    test("write hotkeys stay unregistered so the key falls through", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-2"]),
        lastSelectedId: "task-2",
        canUpdateTask: false,
      });
      setup.rowRefs.current.get("task-2")!.focus();

      const { result } = renderHook(() => useKeyboardNavigation(setup.hookProps));

      const events = [
        fireKeyDown("Enter"),
        fireKeyDown(" "),
        fireKeyDown("Backspace", { meta: true }),
        fireKeyDown("d", { meta: true }),
        fireKeyDown("Tab"),
        fireKeyDown("Tab", { shift: true }),
        fireKeyDown("ArrowUp", { meta: true }),
        fireKeyDown("ArrowDown", { meta: true }),
      ];
      act(() => {
        fireKeyDown("S");
      });

      expect(events.map((event) => event.defaultPrevented)).toEqual(events.map(() => false));
      expect(result.current.shortcutPalette).toBeNull();
      expect(setup.callbacks.focusInput).not.toHaveBeenCalled();
      expect(setup.callbacks.onToggleStatus).not.toHaveBeenCalled();
      expect(setup.callbacks.onDelete).not.toHaveBeenCalled();
      expect(setup.callbacks.onDuplicate).not.toHaveBeenCalled();
      expect(setup.callbacks.onIndent).not.toHaveBeenCalled();
      expect(setup.callbacks.onOutdent).not.toHaveBeenCalled();
      expect(setup.callbacks.reorderTasks).not.toHaveBeenCalled();
      expect(setup.callbacks.onSetStatus).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("navigation, open details and clear selection still work", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        canUpdateTask: false,
      });
      setup.rowRefs.current.get("task-1")!.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Enter", { meta: true });
      fireKeyDown("Escape");
      fireKeyDown("ArrowDown");

      expect(setup.callbacks.onOpenDetails).toHaveBeenCalledWith("task-1");
      expect(setup.callbacks.onClearSelection).toHaveBeenCalled();
      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(new Set(["task-2"]));

      setup.cleanup();
    });
  });

  describe("Guard Conditions", () => {
    test("No actions when enabled is false", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
        enabled: false,
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");
      fireKeyDown(" ");
      fireKeyDown("Backspace", { meta: true });
      fireKeyDown("Escape");

      expect(setup.callbacks.setSelectedIds).not.toHaveBeenCalled();
      expect(setup.callbacks.onToggleStatus).not.toHaveBeenCalled();
      expect(setup.callbacks.onDelete).not.toHaveBeenCalled();
      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("No actions when focus is outside container and no selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(),
      });

      // Focus on body (outside container)
      document.body.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Actions work when focus is outside but selection exists", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      // Focus on body (outside container) but selection exists
      document.body.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("ArrowDown");

      expect(setup.callbacks.setSelectedIds).toHaveBeenCalledWith(
        new Set(["task-2"])
      );

      setup.cleanup();
    });

    test("Escape does nothing when there is no selection", () => {
      const setup = createTestSetup({
        selectedIds: new Set(),
      });

      const row = setup.rowRefs.current.get("task-1")!;
      row.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      setup.cleanup();
    });

    test("Delete does nothing when focus is on generic INPUT element", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      // Create a generic input (not task input)
      const genericInput = document.createElement("input");
      setup.containerRef.current.appendChild(genericInput);
      genericInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Backspace", { meta: true });

      expect(setup.callbacks.onDelete).not.toHaveBeenCalled();

      setup.cleanup();
    });

    test("Escape does nothing when focus is on add-task input", () => {
      const setup = createTestSetup({
        navigableIds: ["task-1", "task-2", "task-3", "add-root"],
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const addInput = setup.addTaskInputRefs.current.get("add-root")!;
      addInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      setup.cleanup();
    });

    test("Escape does nothing when focus is on generic INPUT element", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const genericInput = document.createElement("input");
      setup.containerRef.current.appendChild(genericInput);
      genericInput.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      setup.cleanup();
    });

    test("Escape does nothing when focus is on TEXTAREA element", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1", "task-2"]),
        lastSelectedId: "task-1",
      });

      const textarea = document.createElement("textarea");
      setup.containerRef.current.appendChild(textarea);
      textarea.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      const event = fireKeyDown("Escape");

      expect(setup.callbacks.onClearSelection).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      setup.cleanup();
    });

    test("Delete does nothing when focus is on TEXTAREA element", () => {
      const setup = createTestSetup({
        selectedIds: new Set(["task-1"]),
        lastSelectedId: "task-1",
      });

      const textarea = document.createElement("textarea");
      setup.containerRef.current.appendChild(textarea);
      textarea.focus();

      renderHook(() => useKeyboardNavigation(setup.hookProps));

      fireKeyDown("Backspace", { meta: true });

      expect(setup.callbacks.onDelete).not.toHaveBeenCalled();

      setup.cleanup();
    });
  });
});


test("plain arrows consult grouped navigation before treating the visible boundary as the list boundary", () => {
  const setup = createTestSetup({ taskIds: ["done"], selectedIds: new Set(["done"]) });
  const onNavigate = vi.fn(() => true);
  const hook = renderHook(() => useKeyboardNavigation({ ...setup.hookProps, onNavigate }));
  setup.rowRefs.current.get("done")!.focus();
  act(() => { fireKeyDown("ArrowUp"); });
  expect(onNavigate).toHaveBeenCalledWith("done", "prev");
  onNavigate.mockClear();
  act(() => { fireKeyDown("ArrowDown", { meta: true }); });
  expect(onNavigate).not.toHaveBeenCalled();
  hook.unmount();
  setup.cleanup();
});
