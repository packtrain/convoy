/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { TimelineCursor } from "@/convex/tasks/lib/timeline/validators";
import { useTaskTimeline } from "./use-task-timeline";

/**
 * `useQueries` is mocked as a page server: it answers each request from a
 * scripted map keyed by the request's `before` cursor, so a test can assert the
 * cursor round-trip and the trailing-empty-page rule without a Convex client.
 */
const useQueriesMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQueries: (...args: unknown[]) => useQueriesMock(...args),
}));

const TASK_ID = "task_1" as Id<"tasks">;
const ALL_SOURCES = { activity: true, comments: true, threads: true };

type ScriptedPage = {
  items: Array<{ kind: "activity"; at: number; activity: { _id: string } }>;
  nextBefore: TimelineCursor | null;
  isDone: boolean;
};

function activityItem(id: string, at: number) {
  return { kind: "activity" as const, at, activity: { _id: id } };
}

function cursorKey(before: TimelineCursor | undefined): string {
  return before ? `${before.at}:${before.creationTime}` : "first";
}

/** Answers every request from `pages`; an unscripted cursor stays loading. */
function servePages(pages: Record<string, ScriptedPage | undefined>) {
  useQueriesMock.mockImplementation(
    (requests: Record<string, { args: { before?: TimelineCursor } }>) =>
      Object.fromEntries(
        Object.entries(requests).map(([key, request]) => [
          key,
          pages[cursorKey(request.args.before)],
        ])
      )
  );
}

const FIRST_CURSOR: TimelineCursor = { at: 900, creationTime: 90 };
const SECOND_CURSOR: TimelineCursor = { at: 800, creationTime: 80 };

beforeEach(() => {
  useQueriesMock.mockReset();
});

describe("useTaskTimeline", () => {
  test("loads the first page and exposes its cursor as the thread splice floor", () => {
    servePages({
      first: {
        items: [activityItem("a1", 1000), activityItem("a2", 900)],
        nextBefore: FIRST_CURSOR,
        isDone: false,
      },
    });

    const { result } = renderHook(() =>
      useTaskTimeline({ taskId: TASK_ID, sources: ALL_SOURCES })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items.map((item) => item.at)).toEqual([1000, 900]);
    expect(result.current.nextBefore).toEqual(FIRST_CURSOR);
    expect(result.current.isDone).toBe(false);
  });

  test("stays loading until the first page resolves", () => {
    servePages({});

    const { result } = renderHook(() =>
      useTaskTimeline({ taskId: TASK_ID, sources: ALL_SOURCES })
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    // Never `true` on an unresolved feed — the caller would render "no activity".
    expect(result.current.isDone).toBe(false);
  });

  test("loadMore round-trips the composite cursor and appends the next page", () => {
    servePages({
      first: {
        items: [activityItem("a1", 1000)],
        nextBefore: FIRST_CURSOR,
        isDone: false,
      },
      [cursorKey(FIRST_CURSOR)]: {
        items: [activityItem("a2", 850)],
        nextBefore: SECOND_CURSOR,
        isDone: false,
      },
    });

    const { result } = renderHook(() =>
      useTaskTimeline({ taskId: TASK_ID, sources: ALL_SOURCES })
    );

    act(() => result.current.loadMore());

    expect(result.current.items.map((item) => item.at)).toEqual([1000, 850]);
    expect(result.current.nextBefore).toEqual(SECOND_CURSOR);

    // The cursor went back verbatim — reconstructing it from a row's `at` would
    // drop the `_creationTime` half and lose rows inside a tied millisecond.
    const lastRequests = useQueriesMock.mock.lastCall?.[0] as Record<
      string,
      { args: { before?: TimelineCursor } }
    >;
    expect(lastRequests["page-1"].args.before).toEqual(FIRST_CURSOR);
  });

  test("a trailing empty page ends the feed without dropping loaded rows", () => {
    // The evenly-divided case: the last content page reports `isDone: false`,
    // so the client must ask once more and get an empty, done page.
    servePages({
      first: {
        items: [activityItem("a1", 1000)],
        nextBefore: FIRST_CURSOR,
        isDone: false,
      },
      [cursorKey(FIRST_CURSOR)]: { items: [], nextBefore: null, isDone: true },
    });

    const { result } = renderHook(() =>
      useTaskTimeline({ taskId: TASK_ID, sources: ALL_SOURCES })
    );

    act(() => result.current.loadMore());

    expect(result.current.isDone).toBe(true);
    expect(result.current.items.map((item) => item.at)).toEqual([1000]);
    // Floor lifted: every thread renders once the server sources are exhausted.
    expect(result.current.nextBefore).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test("loadMore is a no-op once done, so it cannot spin on empty pages", () => {
    servePages({
      first: { items: [activityItem("a1", 1000)], nextBefore: null, isDone: true },
    });

    const { result } = renderHook(() =>
      useTaskTimeline({ taskId: TASK_ID, sources: ALL_SOURCES })
    );

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());

    const lastRequests = useQueriesMock.mock.lastCall?.[0] as Record<string, unknown>;
    expect(Object.keys(lastRequests)).toEqual(["page-0"]);
  });

  test("changing the source set resets the accumulated window", () => {
    servePages({
      first: {
        items: [activityItem("a1", 1000)],
        nextBefore: FIRST_CURSOR,
        isDone: false,
      },
      [cursorKey(FIRST_CURSOR)]: {
        items: [activityItem("a2", 850)],
        nextBefore: SECOND_CURSOR,
        isDone: false,
      },
    });

    const { result, rerender } = renderHook(
      (props: { sources: typeof ALL_SOURCES }) =>
        useTaskTimeline({ taskId: TASK_ID, sources: props.sources }),
      { initialProps: { sources: ALL_SOURCES } }
    );

    act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(2);

    // A cursor earned under three sources cannot resume against two: the rows it
    // points past may not even be read any more.
    rerender({ sources: { activity: true, comments: false, threads: true } });

    const lastRequests = useQueriesMock.mock.lastCall?.[0] as Record<string, unknown>;
    expect(Object.keys(lastRequests)).toEqual(["page-0"]);
    expect(result.current.items).toHaveLength(1);
  });

  test("a new taskId resets the window rather than flattening two tasks", () => {
    servePages({
      first: {
        items: [activityItem("a1", 1000)],
        nextBefore: FIRST_CURSOR,
        isDone: false,
      },
      [cursorKey(FIRST_CURSOR)]: {
        items: [activityItem("a2", 850)],
        nextBefore: null,
        isDone: true,
      },
    });

    const { result, rerender } = renderHook(
      (props: { taskId: Id<"tasks"> }) =>
        useTaskTimeline({ taskId: props.taskId, sources: ALL_SOURCES }),
      { initialProps: { taskId: TASK_ID } }
    );

    act(() => result.current.loadMore());
    expect(result.current.items).toHaveLength(2);

    rerender({ taskId: "task_2" as Id<"tasks"> });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.isDone).toBe(false);
  });

  test("a stable source object identity does not resubscribe on re-render", () => {
    servePages({
      first: { items: [activityItem("a1", 1000)], nextBefore: null, isDone: true },
    });

    const { rerender } = renderHook(() =>
      // A fresh object literal every render, as a real host passes.
      useTaskTimeline({ taskId: TASK_ID, sources: { ...ALL_SOURCES } })
    );

    const before = useQueriesMock.mock.lastCall?.[0];
    rerender();

    expect(useQueriesMock.mock.lastCall?.[0]).toBe(before);
  });
});
