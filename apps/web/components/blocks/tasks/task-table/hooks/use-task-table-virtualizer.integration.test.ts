// @vitest-environment jsdom
import { createDefaultTask } from "@/lib/tasks/defaults";
import { buildTaskTree } from "@/lib/tasks/tree";
import type { Id } from "@/convex/_generated/dataModel";
import { createRef } from "react";
import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useTaskTableVirtualizer } from "./use-task-table-virtualizer";
import type { FlattenedRow, TaskSectionRow } from "@/lib/tasks/types";

// Exercise the real virtualizer, including count and key changes on expansion.
test("31 inserted rows have correct offsets without manual measurement", () => {
  const header: TaskSectionRow = { rowType: "section", clientId: "group:todo", height: 44 };
  const next: TaskSectionRow = { rowType: "section", clientId: "group:done", height: 44 };
  const rows: (FlattenedRow | TaskSectionRow)[] = [
    header,
    ...buildTaskTree(Array.from({ length: 31 }, (_, i) => ({ ...createDefaultTask(), _id: `task-${i}` as Id<"tasks">, clientId: `task-${i}` }))),
    next,
  ];
  const ref = createRef<HTMLDivElement>();
  const { result, rerender } = renderHook(({ rows }) => useTaskTableVirtualizer(rows, rows.length, ref, true), {
    initialProps: { rows: [header, next] as typeof rows },
  });
  expect(result.current.getTotalSize()).toBe(88);
  rerender({ rows });
  expect(result.current.getTotalSize()).toBe(33 * 44);
  expect(result.current.measurementsCache[32].start).toBe(32 * 44);
  rerender({ rows: [header, next] });
  expect(result.current.getTotalSize()).toBe(88);
});
