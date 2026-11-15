/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ROW_HEIGHT } from "@/lib/tasks/constants";
import { TaskViewTableSkeleton } from "./task-view-table-skeleton";

afterEach(cleanup);

test("skeleton rows match the real row height with no extra padding", () => {
  render(<TaskViewTableSkeleton />);
  const table = screen.getByTestId("task-view-skeleton-table");
  expect(table.className).not.toMatch(/\bp-\d/);
  const rows = screen.getAllByTestId("task-view-skeleton-row");
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.style.height).toBe(`${ROW_HEIGHT}px`);
    expect(row.className).not.toMatch(/\bpy-\d/);
  }
});
