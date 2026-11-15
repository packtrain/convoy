"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  TimelineCursor,
  TimelineSources,
} from "@/convex/tasks/lib/timeline/validators";

/**
 * The merged timeline's pagination (OS-1590, `docs/specs/task-timeline.md`).
 *
 * `tasks.timeline.listByTask` is deliberately not a `.paginate()` query — a Convex
 * cursor cannot span a two-table merge — so `usePaginatedQuery` doesn't apply and this
 * hook accumulates pages itself.
 *
 * Each page keeps its **own** live subscription (`useQueries`, one entry per page)
 * rather than being copied into state once, which is what makes an edit three pages up
 * still stream in.
 */

const PAGE_SIZE = 20;

type TimelinePage = FunctionReturnType<typeof api.tasks.timeline.listByTask>;
export type TimelineItem = TimelinePage["items"][number];

export interface UseTaskTimelineResult {
  /** Every loaded page's rows, flattened, newest-first. */
  items: TimelineItem[];
  /**
   * Position of the oldest loaded row — the thread splice floor. `null` once
   * every enabled source is exhausted, which lifts the floor entirely.
   */
  nextBefore: TimelineCursor | null;
  /** No more server rows. The **only** end signal; an empty page is not one. */
  isDone: boolean;
  /** The first page has not resolved yet. */
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/** Page 0 reads from the newest row, so its `before` is absent. */
type PageCursor = TimelineCursor | null;

const FIRST_PAGE: PageCursor = null;
const FIRST_PAGE_ONLY: PageCursor[] = [FIRST_PAGE];

/**
 * Identity of the window's inputs. A cursor from a wider source set cannot
 * resume against a narrower one — the rows it points past may not even be read
 * any more — so changing either input resets every loaded page.
 */
function windowKey(taskId: Id<"tasks">, sources: TimelineSources): string {
  return [
    taskId,
    sources.activity ? "a" : "-",
    sources.comments ? "c" : "-",
    sources.threads ? "t" : "-",
  ].join(":");
}

function isTimelinePage(value: unknown): value is TimelinePage {
  return !!value && !(value instanceof Error);
}

export function useTaskTimeline({
  taskId,
  sources,
}: {
  taskId: Id<"tasks">;
  sources: TimelineSources;
}): UseTaskTimelineResult {
  const key = windowKey(taskId, sources);
  const [window, setWindow] = useState<{ key: string; cursors: PageCursor[] }>(() => ({
    key,
    cursors: [FIRST_PAGE],
  }));

  // Reset during render rather than in an effect: an effect would let one paint
  // flatten the previous task's pages under the new task's id. React re-runs
  // this render immediately with the new state, so nothing downstream ever
  // observes the stale window.
  if (window.key !== key) {
    setWindow({ key, cursors: [FIRST_PAGE] });
  }
  // `FIRST_PAGE_ONLY` is module-constant, so the memo below keeps a stable dep
  // across the reset render — a fresh `[null]` literal here would resubscribe
  // every page on every paint.
  const cursors = window.key === key ? window.cursors : FIRST_PAGE_ONLY;

  // Rebuild the request map from the *fields*, not the `sources` object: hosts
  // pass a fresh object every render, and an identity-keyed memo would
  // resubscribe every page on every paint.
  const { activity, comments, threads } = sources;
  const requests = useMemo(() => {
    const args = { taskId, sources: { activity, comments, threads }, limit: PAGE_SIZE };
    return Object.fromEntries(
      cursors.map((before, index) => [
        `page-${index}`,
        {
          query: api.tasks.timeline.listByTask,
          args: before ? { ...args, before } : args,
        },
      ])
    );
  }, [taskId, activity, comments, threads, cursors]);

  // `useQueries` is typed as `Record<string, any>`; every value here is this
  // one query's return type, an `Error` it threw, or `undefined` while loading.
  const results = useQueries(requests) as Record<string, TimelinePage | Error | undefined>;

  // Only the resolved *prefix* counts. A gap would splice rows out of order,
  // and pages resolve out of order routinely (an older page can be cached).
  const resolved = useMemo(() => {
    const pages: TimelinePage[] = [];
    for (let index = 0; index < cursors.length; index += 1) {
      const page = results[`page-${index}`];
      if (!isTimelinePage(page)) {
        break;
      }
      pages.push(page);
    }
    return pages;
  }, [cursors.length, results]);

  const items = useMemo(() => resolved.flatMap((page) => page.items), [resolved]);

  const lastPage = resolved.at(-1);
  const isDone = lastPage?.isDone ?? false;
  const nextBefore = lastPage?.nextBefore ?? null;

  const loadMore = useCallback(() => {
    setWindow((current) => {
      // Re-derive from the results the caller just saw: `nextBefore` closed over
      // above could be a paint behind a page that resolved in between.
      const loaded = current.cursors.length;
      const page = results[`page-${loaded - 1}`];
      if (!isTimelinePage(page) || page.isDone || !page.nextBefore) {
        return current;
      }
      return { ...current, cursors: [...current.cursors, page.nextBefore] };
    });
  }, [results]);

  return {
    items,
    nextBefore,
    isDone,
    isLoading: resolved.length === 0,
    isLoadingMore: resolved.length < cursors.length,
    loadMore,
  };
}
