/** @vitest-environment jsdom */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { useWatchTowerSection } from "./use-watch-tower-threads";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  loadMore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => mocks.query(...args),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("continues across empty filtered pages until rows arrive or the section is exhausted", () => {
  const page = { results: [] as { _id: string }[], status: "CanLoadMore", loadMore: mocks.loadMore };
  mocks.query.mockImplementation(() => page);
  const view = renderHook(() => useWatchTowerSection("org", "needs_review"));
  expect(mocks.loadMore).toHaveBeenCalledExactlyOnceWith(25);
  page.status = "LoadingMore";
  view.rerender();
  page.status = "CanLoadMore";
  view.rerender();
  expect(mocks.loadMore).toHaveBeenCalledTimes(2);
  page.status = "LoadingMore";
  view.rerender();
  page.results = [{ _id: "container" }];
  page.status = "CanLoadMore";
  view.rerender();
  expect(mocks.loadMore).toHaveBeenCalledTimes(2);
  expect(view.result.current.threads).toEqual([{ _id: "container" }]);
  page.results = [];
  page.status = "Exhausted";
  view.rerender();
  expect(mocks.loadMore).toHaveBeenCalledTimes(2);
});

test("hidden sections skip the query", () => {
  mocks.query.mockReturnValue({ results: [], status: "Exhausted", loadMore: mocks.loadMore });
  renderHook(() => useWatchTowerSection(undefined, "running"));
  expect(mocks.query.mock.calls[0][1]).toBe("skip");
  expect(mocks.loadMore).not.toHaveBeenCalled();
});

test("personal query never receives a team scope", () => {
  mocks.query.mockReturnValue({ results: [], status: "Exhausted", loadMore: mocks.loadMore });
  renderHook(() => useWatchTowerSection("org", "running"));
  expect(getFunctionName(mocks.query.mock.calls[0][0])).toBe("cli/threads/lists:listMine");
  expect(mocks.query.mock.calls[0][1]).toEqual({ organizationSlug: "org", section: "running" });
});

test("project query receives its alias and owner scope", () => {
  mocks.query.mockReturnValue({ results: [], status: "Exhausted", loadMore: mocks.loadMore });
  renderHook(() => useWatchTowerSection("org", "running", { projectAlias: "OS", scope: "all" }));
  expect(getFunctionName(mocks.query.mock.calls[0][0])).toBe("cli/threads/lists:listProjectWatchTower");
  expect(mocks.query.mock.calls[0][1]).toEqual({ organizationSlug: "org", projectAlias: "OS", section: "running", scope: "all" });
});
