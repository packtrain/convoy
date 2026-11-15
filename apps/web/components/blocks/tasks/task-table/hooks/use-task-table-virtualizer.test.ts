// @vitest-environment jsdom
import { createDefaultTask } from "@/lib/tasks/defaults";
import { buildTaskTree } from "@/lib/tasks/tree";
import type { Id } from "@/convex/_generated/dataModel";
import { createRef } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useTaskTableVirtualizer } from "./use-task-table-virtualizer";
import type { FlattenedRow, TaskSectionRow } from "@/lib/tasks/types";

const mocks = vi.hoisted(() => ({ measure: vi.fn(), options: vi.fn(), scrollToIndex: vi.fn() }));
vi.mock("@tanstack/react-virtual", () => {
  const instance = { measure: mocks.measure, scrollToIndex: mocks.scrollToIndex };
  return {
    useVirtualizer: (options: unknown) => {
      mocks.options(options);
      return instance;
    },
  };
});
beforeEach(() => vi.clearAllMocks());
const header: TaskSectionRow = { rowType: "section", clientId: "group:todo", height: 44 };
const expanded: (FlattenedRow | TaskSectionRow)[] = [
  header,
  ...buildTaskTree(Array.from({ length: 31 }, (_, i) => ({ ...createDefaultTask(), _id: `task-${i}` as Id<"tasks">, clientId: `task-${i}` }))),
];

test("expanding 31 fixed-height rows does not clear measurements or schedule a second update", () => {
  const ref = createRef<HTMLDivElement>();
  const { rerender } = renderHook(({ rows }) => useTaskTableVirtualizer(rows, rows.length, ref, true), {
    initialProps: { rows: [header] as typeof expanded },
  });
  rerender({ rows: expanded });
  rerender({ rows: [header] });
  expect(mocks.measure).not.toHaveBeenCalled();
});

test("unrelated renders keep measurement callbacks stable", () => {
  const ref = createRef<HTMLDivElement>();
  const { rerender } = renderHook(() => useTaskTableVirtualizer(expanded, expanded.length, ref, true));
  const first = mocks.options.mock.calls.at(-1)![0];
  rerender();
  const next = mocks.options.mock.calls.at(-1)![0];
  expect(next.getItemKey).toBe(first.getItemKey);
  expect(next.estimateSize).toBe(first.estimateSize);
  expect(next.getScrollElement).toBe(first.getScrollElement);
});

test("variable section height changes still invalidate measurements", () => {
  const ref = createRef<HTMLDivElement>();
  const { rerender } = renderHook(({ height }) => useTaskTableVirtualizer([{ ...header, height }], 1, ref, true), {
    initialProps: { height: 68 },
  });
  mocks.measure.mockClear();
  rerender({ height: 88 });
  expect(mocks.measure).toHaveBeenCalledOnce();
  expect(mocks.options.mock.calls.at(-1)![0].estimateSize(0)).toBe(88);
});


test("scrolls an unmounted navigation target into the virtual window before focusing it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const ref = { current: container };
  const target = document.createElement("div");
  target.dataset.taskRowId = "task-30";
  target.tabIndex = 0;
  mocks.scrollToIndex.mockImplementation(() => container.append(target));
  const hook = renderHook(() => useTaskTableVirtualizer(expanded, expanded.length, ref, true, { id: "task-30" }));
  expect(mocks.scrollToIndex).toHaveBeenCalledWith(31, { align: "auto" });
  await waitFor(() => expect(document.activeElement).toBe(target));
  hook.unmount();
  container.remove();
});

test("a scroll-only request scrolls the target into view without focusing it", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const target = document.createElement("div");
  target.dataset.taskRowId = "task-30";
  target.tabIndex = 0;
  container.append(target);
  const hook = renderHook(() => useTaskTableVirtualizer(expanded, expanded.length, { current: container }, true, { id: "task-30", focus: false }));
  expect(mocks.scrollToIndex).toHaveBeenCalledWith(31, { align: "auto" });
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.activeElement).not.toBe(target);
  hook.unmount();
  container.remove();
});

test("unchanged rows do not rescan custom heights on unrelated renders", () => {
  const height = vi.fn(() => 68);
  const rows = [{ ...header, get height() { return height(); } }];
  const ref = createRef<HTMLDivElement>();
  const hook = renderHook(() => useTaskTableVirtualizer(rows, rows.length, ref, true));
  height.mockClear();
  hook.rerender();
  expect(height).not.toHaveBeenCalled();
});
