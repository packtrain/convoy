/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { IntegrationStatus } from "./use-integration-status";
import { usePullRequestList } from "./use-pull-request-list";

const loadHistory = vi.fn(async () => null);
const pageIn = vi.fn();
let paginated: { results: unknown[]; status: string } = { results: [], status: "Exhausted" };

vi.mock("convex/react", () => ({
  usePaginatedQuery: () => ({ ...paginated, loadMore: pageIn }),
  useMutation: () => loadHistory,
}));

afterEach(() => {
  cleanup();
  loadHistory.mockClear();
  pageIn.mockClear();
  paginated = { results: [], status: "Exhausted" };
});

const connection = (id: number, history = { started: true, complete: false, loading: false, coveredThrough: 0 }) =>
  ({ repositoryId: `repo_${id}`, repository: { syncStatus: "synced", history } }) as unknown as IntegrationStatus["connections"][number];

const projectId = "project_1" as Id<"projects">;
const options = { tab: "closed" as const, sort: "updated" as const, order: "desc" as const };

describe("usePullRequestList", () => {
  test("a repository added while Closed is shown gets its history requested", () => {
    const view = renderHook(({ scope }) => usePullRequestList(projectId, options, scope), { initialProps: { scope: [connection(1)] } });
    expect(loadHistory).toHaveBeenCalledTimes(1);
    view.rerender({ scope: [connection(1), connection(2, { started: false, complete: false, loading: false, coveredThrough: 0 })] });
    expect(loadHistory).toHaveBeenCalledTimes(2);
    // A status update with the same repositories asks nothing more.
    view.rerender({ scope: [connection(1), connection(2)] });
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  test("with a You filter, Load more reads one page however few of its rows match (OS-2435)", () => {
    paginated = { results: [{ _id: "pr_1" }], status: "CanLoadMore" };
    const { result, rerender } = renderHook(() => usePullRequestList(projectId, { ...options, tab: "open", author: "me" }, [connection(1)]));
    act(() => result.current.loadMore());
    expect(pageIn).toHaveBeenCalledTimes(1);
    // The page stopped at its row cap with no match; the next one waits for another click.
    paginated = { ...paginated, status: "LoadingMore" };
    rerender();
    paginated = { ...paginated, status: "CanLoadMore" };
    rerender();
    expect(pageIn).toHaveBeenCalledTimes(1);
  });

  test("names how far back Closed reaches until every repository has all of its history", () => {
    const at = Date.parse("2026-10-03T12:00:00Z");
    const done = { started: true, complete: true, loading: false, coveredThrough: 0 };
    const { result, rerender } = renderHook(({ scope }) => usePullRequestList(projectId, options, scope), {
      initialProps: { scope: [connection(1, { ...done, complete: false, coveredThrough: at }), connection(2, done)] },
    });
    expect(result.current.coveredSince).toBe(at);
    rerender({ scope: [connection(1, done), connection(2, done)] });
    expect(result.current.coveredSince).toBeNull();
  });
});
