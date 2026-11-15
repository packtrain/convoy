/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { SHARED_THREADS_PAGE_SIZE } from "@/lib/threads/constants";
import { useSharedCliThreads } from "./use-shared-cli-threads";

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

/** The args the hook passed to `usePaginatedQuery`. */
function queryArgs() {
  return mocks.usePaginatedQuery.mock.calls[0][1];
}

describe("useSharedCliThreads (OS-1576)", () => {
  afterEach(() => {
    cleanup();
    mocks.usePaginatedQuery.mockReset();
    mocks.loadMore.mockReset();
  });

  test("skips the subscription while the view is closed", () => {
    // A skipped paginated query still reports LoadingFirstPage.
    mocks.usePaginatedQuery.mockReturnValue(paginated("LoadingFirstPage"));

    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: false })
    );

    expect(queryArgs()).toBe("skip");
    // Nothing was asked for, so nothing is pending — a closed view must not
    // leave a skeleton behind it.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  test("subscribes for the project while the view is open", () => {
    mocks.usePaginatedQuery.mockReturnValue(
      paginated("CanLoadMore", [{ _id: "a" }])
    );

    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: true })
    );

    expect(queryArgs()).toEqual({ projectId });
    expect(result.current.sharedThreads).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  test("reports the first page as loading", () => {
    mocks.usePaginatedQuery.mockReturnValue(paginated("LoadingFirstPage"));

    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: true })
    );

    expect(result.current.isLoading).toBe(true);
  });

  test("Load more asks for another page of the configured size", () => {
    mocks.usePaginatedQuery.mockReturnValue(paginated("CanLoadMore"));
    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: true })
    );

    result.current.loadMore();

    expect(mocks.loadMore).toHaveBeenCalledWith(SHARED_THREADS_PAGE_SIZE);
  });

  test("a loading page counts as more to come, not as an exhausted list", () => {
    mocks.usePaginatedQuery.mockReturnValue(paginated("LoadingMore"));

    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: true })
    );

    expect(result.current.isLoadingMore).toBe(true);
    expect(result.current.hasMore).toBe(true);
  });

  test("offers no more pages once exhausted", () => {
    mocks.usePaginatedQuery.mockReturnValue(
      paginated("Exhausted", [{ _id: "a" }])
    );

    const { result } = renderHook(() =>
      useSharedCliThreads(projectId, { enabled: true })
    );

    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  test("skips the subscription without a project", () => {
    mocks.usePaginatedQuery.mockReturnValue(paginated("LoadingFirstPage"));

    const { result } = renderHook(() =>
      useSharedCliThreads(undefined, { enabled: true })
    );

    expect(queryArgs()).toBe("skip");
    expect(result.current.isLoading).toBe(false);
  });
});
