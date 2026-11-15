/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTaskSelection } from "./use-task-selection";

function createClickEvent(
  target: HTMLElement,
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
): ReactMouseEvent {
  return {
    target,
    metaKey: modifiers?.metaKey ?? false,
    ctrlKey: modifiers?.ctrlKey ?? false,
    shiftKey: modifiers?.shiftKey ?? false,
  } as unknown as ReactMouseEvent;
}

describe("useTaskSelection", () => {
  test("a plain row click selects without entering bulk mode", () => {
    const { result } = renderHook(() => useTaskSelection({ taskIds: ["task-1", "task-2"] }));
    const row = document.createElement("div");

    act(() => result.current.handleRowClick(createClickEvent(row), "task-1"));

    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(result.current.isBulkSelection).toBe(false);
    cleanup();
  });

  test("a modifier click on one task enters bulk mode, and it holds down to one task", () => {
    const { result } = renderHook(() => useTaskSelection({ taskIds: ["task-1", "task-2"] }));
    const row = document.createElement("div");

    act(() => result.current.handleRowClick(createClickEvent(row, { metaKey: true }), "task-1"));
    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(result.current.isBulkSelection).toBe(true);

    act(() => result.current.handleRowClick(createClickEvent(row, { metaKey: true }), "task-2"));
    act(() => result.current.handleRowClick(createClickEvent(row, { metaKey: true }), "task-1"));
    expect(result.current.selectedIds).toEqual(new Set(["task-2"]));
    expect(result.current.isBulkSelection).toBe(true);

    act(() => result.current.handleRowClick(createClickEvent(row), "task-1"));
    expect(result.current.isBulkSelection).toBe(false);
    cleanup();
  });

  test("two or more selected tasks always count as bulk mode", () => {
    const { result } = renderHook(() => useTaskSelection({ taskIds: ["task-1", "task-2"] }));

    act(() => result.current.setSelectedIds(new Set(["task-1", "task-2"])));

    expect(result.current.isBulkSelection).toBe(true);
    cleanup();
  });

  test("does not open details when clicking the task name input", () => {
    const onOpenDetails = vi.fn();
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2"], onOpenDetails })
    );

    const input = document.createElement("input");
    input.setAttribute("data-task-input", "true");
    document.body.appendChild(input);

    act(() => {
      result.current.handleRowClick(createClickEvent(input), "task-1");
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-1" });
    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(onOpenDetails).not.toHaveBeenCalled();

    document.body.removeChild(input);
    cleanup();
  });

  test.each(["menuitem", "menuitemcheckbox", "menuitemradio", "option"])(
    "does not open details when clicking a portalled %s control",
    (role) => {
      const onOpenDetails = vi.fn();
      const { result } = renderHook(() =>
        useTaskSelection({ taskIds: ["task-1", "task-2"], onOpenDetails })
      );

      const menuControl = document.createElement("div");
      menuControl.setAttribute("role", role);
      document.body.appendChild(menuControl);

      act(() => {
        result.current.handleRowClick(
          createClickEvent(menuControl),
          "task-1"
        );
      });

      expect(result.current.selection).toEqual({ type: "single", id: "task-1" });
      expect(onOpenDetails).not.toHaveBeenCalled();

      document.body.removeChild(menuControl);
      cleanup();
    }
  );

  test("opens details when clicking name input with openDetailsOnNameClick=true", () => {
    const onOpenDetails = vi.fn();
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2"], onOpenDetails, openDetailsOnNameClick: true })
    );

    const input = document.createElement("input");
    input.setAttribute("data-task-input", "true");
    document.body.appendChild(input);

    act(() => {
      result.current.handleRowClick(createClickEvent(input), "task-1");
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-1" });
    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(onOpenDetails).toHaveBeenCalledWith("task-1");

    document.body.removeChild(input);
    cleanup();
  });

  test("previously rendered row click handlers use the latest name-click details policy", () => {
    const oldOpenDetails = vi.fn();
    const latestOpenDetails = vi.fn();
    const { result, rerender } = renderHook(
      ({
        onOpenDetails,
        openDetailsOnNameClick,
      }: {
        onOpenDetails: (taskId: string) => void;
        openDetailsOnNameClick: boolean;
      }) =>
        useTaskSelection({
          taskIds: ["task-1", "task-2"],
          onOpenDetails,
          openDetailsOnNameClick,
        }),
      {
        initialProps: {
          onOpenDetails: oldOpenDetails,
          openDetailsOnNameClick: false,
        },
      }
    );
    const previouslyRenderedHandleRowClick = result.current.handleRowClick;

    rerender({
      onOpenDetails: latestOpenDetails,
      openDetailsOnNameClick: true,
    });

    const input = document.createElement("input");
    input.setAttribute("data-task-input", "true");
    document.body.appendChild(input);

    act(() => {
      previouslyRenderedHandleRowClick(createClickEvent(input), "task-2");
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-2" });
    expect(oldOpenDetails).not.toHaveBeenCalled();
    expect(latestOpenDetails).toHaveBeenCalledWith("task-2");

    document.body.removeChild(input);
    cleanup();
  });

  test("prunes array selection when one selected task leaves the visible table", () => {
    const { result, rerender } = renderHook(
      ({ taskIds }: { taskIds: string[] }) => useTaskSelection({ taskIds }),
      {
        initialProps: { taskIds: ["task-1", "task-2", "task-3", "task-4"] },
      }
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2", "task-3"]));
    });

    expect(result.current.selectedIds).toEqual(
      new Set(["task-1", "task-2", "task-3"])
    );
    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-2", "task-3"],
    });
    expect(result.current.lastSelectedId).toBe("task-1");

    rerender({ taskIds: ["task-1", "task-3", "task-4"] });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-3"],
    });
    expect(result.current.selectedIds).toEqual(new Set(["task-1", "task-3"]));
    expect(result.current.lastSelectedId).toBe("task-1");
  });

  test("clears single selection when the selected task leaves the visible table", () => {
    const { result, rerender } = renderHook(
      ({ taskIds }: { taskIds: string[] }) => useTaskSelection({ taskIds }),
      {
        initialProps: { taskIds: ["task-1", "task-2"] },
      }
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1"]));
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-1" });
    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(result.current.lastSelectedId).toBe("task-1");

    rerender({ taskIds: ["task-2"] });

    expect(result.current.selection).toBeNull();
    expect(result.current.selectedIds).toEqual(new Set());
    expect(result.current.lastSelectedId).toBeNull();
  });

  test("clears selection when all selected tasks leave the visible table", () => {
    const { result, rerender } = renderHook(
      ({ taskIds }: { taskIds: string[] }) => useTaskSelection({ taskIds }),
      {
        initialProps: { taskIds: ["task-1", "task-2", "task-3"] },
      }
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2", "task-3"]));
    });

    rerender({ taskIds: ["task-4"] });

    expect(result.current.selection).toBeNull();
    expect(result.current.selectedIds).toEqual(new Set());
    expect(result.current.lastSelectedId).toBeNull();
  });

  test("keeps remaining visible tasks selected when a range endpoint leaves the table", () => {
    const { result, rerender } = renderHook(
      ({ taskIds }: { taskIds: string[] }) => useTaskSelection({ taskIds }),
      {
        initialProps: { taskIds: ["task-1", "task-2", "task-3", "task-4"] },
      }
    );

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-1"
      );
    });

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div"), { shiftKey: true }),
        "task-3"
      );
    });

    expect(result.current.selectedIds).toEqual(
      new Set(["task-1", "task-2", "task-3"])
    );
    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-2", "task-3"],
    });
    expect(result.current.lastSelectedId).toBe("task-1");

    rerender({ taskIds: ["task-2", "task-3", "task-4"] });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-2", "task-3"],
    });
    expect(result.current.selectedIds).toEqual(new Set(["task-2", "task-3"]));
    expect(result.current.lastSelectedId).toBe("task-2");
  });

  test("keeps multi-selection when opening context menu on a selected task", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2"]));
    });

    act(() => {
      result.current.handleContextMenuSelection("task-2");
    });

    expect(result.current.selectedIds).toEqual(new Set(["task-1", "task-2"]));
    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-2"],
    });
    expect(result.current.lastSelectedId).toBe("task-1");
  });

  test("selects only the clicked task when opening context menu on an unselected task", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2"]));
    });

    act(() => {
      result.current.handleContextMenuSelection("task-3");
    });

    expect(result.current.selectedIds).toEqual(new Set(["task-3"]));
    expect(result.current.selection).toEqual({ type: "single", id: "task-3" });
    expect(result.current.lastSelectedId).toBe("task-3");
  });

  test("reassigns the anchor when the previous anchor leaves the visible table", () => {
    const { result, rerender } = renderHook(
      ({ taskIds }: { taskIds: string[] }) => useTaskSelection({ taskIds }),
      {
        initialProps: { taskIds: ["task-1", "task-2", "task-3"] },
      }
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2"]));
    });

    expect(result.current.lastSelectedId).toBe("task-1");

    rerender({ taskIds: ["task-2", "task-3"] });

    expect(result.current.selection).toEqual({ type: "single", id: "task-2" });
    expect(result.current.selectedIds).toEqual(new Set(["task-2"]));
    expect(result.current.lastSelectedId).toBe("task-2");
  });

  test("meta-click toggle preserves the anchor while adding and removing items", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-1"
      );
    });

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div"), { metaKey: true }),
        "task-2"
      );
    });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-2"],
    });
    expect(result.current.lastSelectedId).toBe("task-1");

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div"), { metaKey: true }),
        "task-2"
      );
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-1" });
    expect(result.current.selectedIds).toEqual(new Set(["task-1"]));
    expect(result.current.lastSelectedId).toBe("task-1");
  });

  test("shift-click from a meta-created multi-selection resets to a single selection", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-1"
      );
    });

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div"), { metaKey: true }),
        "task-2"
      );
    });

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div"), { shiftKey: true }),
        "task-3"
      );
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-3" });
    expect(result.current.selectedIds).toEqual(new Set(["task-3"]));
    expect(result.current.lastSelectedId).toBe("task-3");
  });

  test("setLastSelectedId updates the anchor within an existing multi-selection", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2", "task-3"]));
    });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-1", "task-2", "task-3"],
    });
    expect(result.current.lastSelectedId).toBe("task-1");

    act(() => {
      result.current.setLastSelectedId("task-2");
    });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-2", "task-1", "task-3"],
    });
    expect(result.current.selectedIds).toEqual(
      new Set(["task-1", "task-2", "task-3"])
    );
    expect(result.current.lastSelectedId).toBe("task-2");
  });

  test("setSelectedIds preserves the previous anchor when it still exists", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3", "task-4"] })
    );

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-2"
      );
    });

    act(() => {
      result.current.setSelectedIds(new Set(["task-2", "task-3", "task-4"]));
    });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-2", "task-3", "task-4"],
    });
    expect(result.current.lastSelectedId).toBe("task-2");
  });

  test("setSelectedIds falls back to the first item when the previous anchor is missing", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3", "task-4"] })
    );

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-2"
      );
    });

    act(() => {
      result.current.setSelectedIds(new Set(["task-3", "task-4"]));
    });

    expect(result.current.selection).toEqual({
      type: "array",
      ids: ["task-3", "task-4"],
    });
    expect(result.current.lastSelectedId).toBe("task-3");
  });

  test("normal click after multi-selection collapses back to a single selected row", () => {
    const { result } = renderHook(() =>
      useTaskSelection({ taskIds: ["task-1", "task-2", "task-3"] })
    );

    act(() => {
      result.current.setSelectedIds(new Set(["task-1", "task-2"]));
    });

    act(() => {
      result.current.handleSelectRow(
        createClickEvent(document.createElement("div")),
        "task-3"
      );
    });

    expect(result.current.selection).toEqual({ type: "single", id: "task-3" });
    expect(result.current.selectedIds).toEqual(new Set(["task-3"]));
    expect(result.current.lastSelectedId).toBe("task-3");
  });
});
