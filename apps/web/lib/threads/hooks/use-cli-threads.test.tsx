/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliThreads } from "./use-cli-threads";

const mocks = vi.hoisted(() => ({
  optimisticCallbacks: new Map<string, (localStore: unknown, args: unknown) => unknown>(),
  optimisticPaginatedUpdate: vi.fn(),
  setQuery: vi.fn(),
  pages: vi.fn<(args: unknown) => unknown[]>(() => []),
  // Convex memoizes `useMutation` per function reference, so the base mutation
  // survives re-renders — but `withOptimisticUpdate` builds a fresh mutation on
  // every call, which is why an optimistic mutation has to be memoized by the
  // hook to keep an identity at all. Both halves are mirrored here.
  baseMutations: new Map<string, ReturnType<typeof vi.fn>>(),
  loadMore: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (_query: unknown, args: unknown) => ({
    results: mocks.pages(args),
    status: "Exhausted",
    loadMore: mocks.loadMore,
  }),
  useQuery: () => [],
  useMutation: (mutationRef: FunctionReference<"mutation">) => {
    const name = getFunctionName(mutationRef);
    const existing = mocks.baseMutations.get(name);
    if (existing) {
      return existing;
    }

    const mutation = vi.fn();
    const withOptimisticUpdate = vi.fn((callback: (localStore: unknown, args: unknown) => unknown) => {
      mocks.optimisticCallbacks.set(name, callback);
      return Object.assign(vi.fn(), { withOptimisticUpdate });
    });
    const base = Object.assign(mutation, { withOptimisticUpdate });
    mocks.baseMutations.set(name, base);
    return base;
  },
  optimisticallyUpdateValueInPaginatedQuery: (...args: unknown[]) => mocks.optimisticPaginatedUpdate(...args),
}));

const projectId = "project_1" as Id<"projects">;
const threadId = "thread_1" as Id<"cliThreads">;

function thread(overrides: Record<string, unknown> = {}) {
  return {
    _id: threadId,
    title: "Review thread",
    isDone: false,
    hasUnread: true,
    requiresAttention: true,
    ...overrides,
  };
}

function runOptimisticUpdate(mutationName: string, pageThread: ReturnType<typeof thread>, pinnedThread: ReturnType<typeof thread>) {
  let updatedPageThread: ReturnType<typeof thread> | undefined;
  mocks.optimisticPaginatedUpdate.mockImplementation(
    (_localStore: unknown, _query: unknown, _args: unknown, update: (item: ReturnType<typeof thread>) => ReturnType<typeof thread>) => {
      updatedPageThread = update(pageThread);
    }
  );

  const localStore = {
    getQuery: vi.fn(() => [pinnedThread]),
    getAllQueries: vi.fn(() => []),
    setQuery: mocks.setQuery,
  };
  const callback = mocks.optimisticCallbacks.get(mutationName);
  if (!callback) {
    throw new Error(`Missing optimistic callback for ${mutationName}`);
  }

  callback(localStore, { threadIds: [threadId] });
  return updatedPageThread;
}

describe("useCliThreads done state", () => {
  afterEach(() => {
    cleanup();
    mocks.optimisticCallbacks.clear();
    mocks.optimisticPaginatedUpdate.mockReset();
    mocks.setQuery.mockReset();
    mocks.pages.mockReset();
    mocks.pages.mockReturnValue([]);
  });

  test("optimistically marks normal and pinned rows done and reviewed", () => {
    renderHook(() => useCliThreads(projectId, { sortBy: "created" }));

    const sourceThread = thread();
    const updatedPageThread = runOptimisticUpdate(getFunctionName(api.cli.threads.batch.batchMarkDone), sourceThread, sourceThread);
    const expectedThread = {
      ...sourceThread,
      isDone: true,
      hasUnread: false,
      requiresAttention: false,
    };

    expect(updatedPageThread).toEqual(expectedThread);
    expect(mocks.setQuery).toHaveBeenCalledWith(api.cli.threads.lists.listPinnedByProject, { projectId }, [expectedThread]);
  });

  test("optimistically marks normal and pinned rows not done without changing review state", () => {
    renderHook(() => useCliThreads(projectId, { sortBy: "created" }));

    const sourceThread = thread({
      isDone: true,
      hasUnread: false,
      requiresAttention: false,
    });
    const updatedPageThread = runOptimisticUpdate(getFunctionName(api.cli.threads.batch.batchMarkNotDone), sourceThread, sourceThread);
    const expectedThread = { ...sourceThread, isDone: false };

    expect(updatedPageThread).toEqual(expectedThread);
    expect(mocks.setQuery).toHaveBeenCalledWith(api.cli.threads.lists.listPinnedByProject, { projectId }, [expectedThread]);
  });
});

describe("useCliThreads done grouping (OS-1394)", () => {
  afterEach(() => {
    cleanup();
    mocks.pages.mockReset();
    mocks.pages.mockReturnValue([]);
  });

  test("keeps one ungrouped list when grouping is off", () => {
    mocks.pages.mockImplementation((args: unknown) =>
      args === "skip" ? [] : [thread({ _id: "a" }), thread({ _id: "b", isDone: true })]
    );

    const { result } = renderHook(() => useCliThreads(projectId, { sortBy: "created" }));

    expect(result.current.threads.map((item) => item._id)).toEqual(["a", "b"]);
    expect(result.current.doneThreads).toEqual([]);
  });

  test("skips all list queries until enabled", () => {
    renderHook(() =>
      useCliThreads(projectId, { sortBy: "created", groupDone: true, enabled: false })
    );

    expect(mocks.pages).toHaveBeenCalled();
    for (const call of mocks.pages.mock.calls) {
      expect(call[0]).toBe("skip");
    }
  });

  test("splits the merged section pages by isDone, deduped by id and re-sorted", () => {
    // "c" is mid-flight: the done query has not caught up while the active
    // query still holds the optimistically flipped row. It must land in sort
    // position within Done, not wherever dedup order happened to put it.
    mocks.pages.mockImplementation((args: unknown) => {
      if (args === "skip") return [];
      const { isDone } = args as { isDone?: boolean };
      if (isDone === false)
        return [thread({ _id: "a", createdAt: 300 }), thread({ _id: "c", isDone: true, createdAt: 100 })];
      if (isDone === true) return [thread({ _id: "b", isDone: true, createdAt: 200 })];
      return [];
    });

    const { result } = renderHook(() =>
      useCliThreads(projectId, { sortBy: "created", groupDone: true })
    );

    expect(result.current.threads.map((item) => item._id)).toEqual(["a"]);
    expect(result.current.doneThreads.map((item) => item._id)).toEqual(["b", "c"]);
  });

  test("sorts the merged sections by last activity when that is the sort key", () => {
    mocks.pages.mockImplementation((args: unknown) => {
      if (args === "skip") return [];
      const { isDone } = args as { isDone?: boolean };
      if (isDone === false)
        return [thread({ _id: "a", lastActivityAt: 100 }), thread({ _id: "b", lastActivityAt: 300 })];
      return [];
    });

    const { result } = renderHook(() =>
      useCliThreads(projectId, { sortBy: "lastActivity", groupDone: true })
    );

    expect(result.current.threads.map((item) => item._id)).toEqual(["b", "a"]);
  });

  test("hides pinned rows from both sections", () => {
    mocks.pages.mockImplementation((args: unknown) =>
      args === "skip" ? [] : [thread({ _id: "pinned", isPinned: true, isDone: (args as { isDone?: boolean }).isDone })]
    );

    const { result } = renderHook(() =>
      useCliThreads(projectId, { sortBy: "created", groupDone: true })
    );

    expect(result.current.threads).toEqual([]);
    expect(result.current.doneThreads).toEqual([]);
  });
});

/**
 * The thread sidebar is memoized, and a memo gate is only as good as the
 * identity of what it compares: one fresh closure among the props and it never
 * holds, however careful the comparator is (OS-1581). Everything this hook
 * hands the sidebar therefore has to survive a re-render that changed nothing.
 */
describe("useCliThreads callback identity (OS-1581)", () => {
  afterEach(() => {
    cleanup();
    mocks.optimisticCallbacks.clear();
    mocks.baseMutations.clear();
    mocks.pages.mockReset();
    mocks.pages.mockReturnValue([]);
  });

  test.each([
    "loadMore",
    "loadMoreDone",
    "batchMarkDone",
    "batchMarkNotDone",
    "pinThread",
    "unpinThread",
    "removeThread",
    "markRead",
    "markUnread",
    "renameThread",
    "batchMarkRead",
    "batchRemoveThreads",
  ] as const)("keeps %s stable across a re-render", (key) => {
    const { result, rerender } = renderHook(() =>
      useCliThreads(projectId, { sortBy: "created", groupDone: true })
    );
    const before = result.current[key];

    rerender();

    expect(result.current[key]).toBe(before);
  });
});
