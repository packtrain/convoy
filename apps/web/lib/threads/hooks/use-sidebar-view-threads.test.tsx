/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { SIDEBAR_VIEW_THREADS_PAGE_SIZE } from "@/lib/threads/constants";
import { useSidebarViewThreads } from "./use-sidebar-view-threads";

const mocks = vi.hoisted(() => ({
  usePaginatedQuery: vi.fn<
    (query: unknown, args: unknown, options: unknown) => unknown
  >(),
  loadMore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (query: unknown, args: unknown, options: unknown) =>
    mocks.usePaginatedQuery(query, args, options),
}));

const projectId = "project_1" as Id<"projects">;

function paginated(
  status: string,
  results: { _id: string }[] = []
): { results: unknown[]; status: string; loadMore: () => void } {
  return { results, status, loadMore: mocks.loadMore };
}

/** Every subscribed query answers `page`; a skipped one reports LoadingFirstPage, as Convex does. */
function answer(page: ReturnType<typeof paginated>) {
  mocks.usePaginatedQuery.mockImplementation((_query, args) =>
    args === "skip" ? paginated("LoadingFirstPage") : page
  );
}

/** The args the hook passed per query, keyed by function name. */
function queryArgs() {
  return Object.fromEntries(
    mocks.usePaginatedQuery.mock.calls.map(([query, args]) => [
      getFunctionName(query as FunctionReference<"query">),
      args,
    ])
  );
}

describe("useSidebarViewThreads (OS-1576, OS-2513)", () => {
  afterEach(() => {
    cleanup();
    mocks.usePaginatedQuery.mockReset();
    mocks.loadMore.mockReset();
  });

  test("skips every subscription while no view is open", () => {
    answer(paginated("CanLoadMore", [{ _id: "a" }]));

    const { result } = renderHook(() => useSidebarViewThreads(projectId, null));

    expect(queryArgs()).toEqual({
      "cli/threads/lists:listSharedByProject": "skip",
      "cli/threads/lists:listByProject": "skip",
    });
    // Nothing was asked for, so nothing is pending — a closed view must not
    // leave a skeleton behind it.
    expect(result.current.isLoading).toBe(false);
  });

  test("the shared view subscribes to the user's shared threads only", () => {
    answer(paginated("CanLoadMore", [{ _id: "a" }]));

    const { result } = renderHook(() => useSidebarViewThreads(projectId, "shared"));

    expect(queryArgs()).toEqual({
      "cli/threads/lists:listSharedByProject": { projectId },
      "cli/threads/lists:listByProject": "skip",
    });
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  test("the background view subscribes to the project's background threads only", () => {
    answer(paginated("Exhausted", [{ _id: "b" }]));

    const { result } = renderHook(() => useSidebarViewThreads(projectId, "background"));

    expect(queryArgs()).toEqual({
      "cli/threads/lists:listSharedByProject": "skip",
      "cli/threads/lists:listByProject": { projectId, background: true },
    });
    expect(result.current.threads).toEqual([{ _id: "b" }]);
    expect(result.current.hasMore).toBe(false);
  });

  test("reports the first page as loading", () => {
    answer(paginated("LoadingFirstPage"));

    const { result } = renderHook(() => useSidebarViewThreads(projectId, "background"));

    expect(result.current.isLoading).toBe(true);
  });

  test("Load more asks for another page of the configured size", () => {
    answer(paginated("CanLoadMore"));
    const { result } = renderHook(() => useSidebarViewThreads(projectId, "shared"));

    result.current.loadMore();

    expect(mocks.loadMore).toHaveBeenCalledWith(SIDEBAR_VIEW_THREADS_PAGE_SIZE);
  });

  test("a loading page counts as more to come, not as an exhausted list", () => {
    answer(paginated("LoadingMore"));

    const { result } = renderHook(() => useSidebarViewThreads(projectId, "shared"));

    expect(result.current.isLoadingMore).toBe(true);
    expect(result.current.hasMore).toBe(true);
  });

  test("skips the subscription without a project", () => {
    answer(paginated("CanLoadMore"));

    const { result } = renderHook(() => useSidebarViewThreads(undefined, "background"));

    expect(queryArgs()["cli/threads/lists:listByProject"]).toBe("skip");
    expect(result.current.isLoading).toBe(false);
  });
});
