import { describe, expect, test, vi } from "vitest";
import { getBottomAddRowDropTargetId, getRowHeight, shouldTriggerInfiniteLoad } from "./index";
import { ROW_HEIGHT } from "./task-row";

describe("getRowHeight", () => {
  test("uses a section row's own height and the fixed row height otherwise", () => {
    expect(getRowHeight({ rowType: "section", clientId: "s", height: 68 })).toBe(68);
    expect(getRowHeight({ rowType: "section", clientId: "s" })).toBe(ROW_HEIGHT);
    expect(getRowHeight({ rowType: "add-task", parentId: "p", depth: 1, clientId: "add-p" })).toBe(ROW_HEIGHT);
    expect(getRowHeight(undefined)).toBe(ROW_HEIGHT);
  });
});

describe("shouldTriggerInfiniteLoad", () => {
  test("does not trigger while virtualizer is scrolling", () => {
    const onLoadMore = vi.fn();

    expect(
      shouldTriggerInfiniteLoad({
        onLoadMore,
        hasMore: true,
        isLoadingMore: false,
        isNearEnd: true,
        isVirtualizerScrolling: true,
      })
    ).toBe(false);
  });

  test("triggers when near end and scroll has settled", () => {
    const onLoadMore = vi.fn();

    expect(
      shouldTriggerInfiniteLoad({
        onLoadMore,
        hasMore: true,
        isLoadingMore: false,
        isNearEnd: true,
        isVirtualizerScrolling: false,
      })
    ).toBe(true);
  });

  test("does not trigger while buffered rows are waiting to be rendered", () => {
    const onLoadMore = vi.fn();

    expect(
      shouldTriggerInfiniteLoad({
        onLoadMore,
        hasMore: true,
        isLoadingMore: false,
        isNearEnd: true,
        isVirtualizerScrolling: false,
        hasBufferedRows: true,
      })
    ).toBe(false);
  });
});

describe("getBottomAddRowDropTargetId", () => {
  test("targets the root drop zone for top-level tables", () => {
    expect(getBottomAddRowDropTargetId(undefined)).toBe("add-root");
    expect(getBottomAddRowDropTargetId(null)).toBe("add-root");
  });

  // OS-884: dropping a subtask onto the bottom add row of the detail sidebar
  // must keep it under the parent instead of reparenting it to the root.
  test("targets the parent drop zone for subtask tables", () => {
    expect(getBottomAddRowDropTargetId("task_parent")).toBe("add-task_parent");
  });
});
