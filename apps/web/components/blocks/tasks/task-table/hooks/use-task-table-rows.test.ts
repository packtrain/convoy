// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { FlattenedRow } from "@/lib/tasks/types";
import { useTaskTableRows } from "./use-task-table-rows";

test("unrelated renders reuse presented rows and collapse changes recompute them", () => {
  const rows: FlattenedRow[] = [];
  const presentRows = vi.fn((rows: FlattenedRow[]) => [...rows]);
  const { result, rerender } = renderHook(({presentRows}) => useTaskTableRows(rows, presentRows), {initialProps: {presentRows}});
  const first = result.current;
  rerender({presentRows});
  expect(presentRows).toHaveBeenCalledOnce();
  expect(result.current).toBe(first);
  const collapsedPresenter = vi.fn(() => []);
  rerender({presentRows: collapsedPresenter});
  expect(collapsedPresenter).toHaveBeenCalledOnce();
  expect(result.current).not.toBe(first);
});
