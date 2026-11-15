"use client";

import { useCallback } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SHARED_THREADS_PAGE_SIZE } from "@/lib/threads/constants";

type SharedThread = FunctionReturnType<typeof api.cli.threads.lists.listSharedByProject>["page"][number];

interface UseSharedCliThreadsOptions {
  /**
   * True while the shared-threads view is open. The subscription is mounted
   * only then: it re-runs on every write inside a loaded page's index range,
   * and since pages are ordered by `sharedAt` descending, a recently shared
   * thread that is streaming sits on page one. That cost is fine for a view
   * someone has deliberately opened, and pointless for everyone else.
   */
  enabled?: boolean;
}

/**
 * The current user's own shared threads in a project, most recently shared
 * first, paginated with Load more (OS-1576).
 *
 * Live, so unsharing from inside the view takes the row away and shares made
 * elsewhere appear on their own.
 */
export function useSharedCliThreads(
  projectId: Id<"projects"> | undefined,
  options?: UseSharedCliThreadsOptions
): {
  sharedThreads: SharedThread[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const { enabled = true } = options ?? {};
  const active = enabled && projectId !== undefined;
  const { results, status, loadMore } = usePaginatedQuery(
    api.cli.threads.lists.listSharedByProject,
    active ? { projectId } : "skip",
    { initialNumItems: SHARED_THREADS_PAGE_SIZE }
  );

  const loadMorePage = useCallback(() => {
    loadMore(SHARED_THREADS_PAGE_SIZE);
  }, [loadMore]);

  return {
    sharedThreads: results,
    // A skipped paginated query reports `LoadingFirstPage`, so the closed view
    // would otherwise render a skeleton for a read it never issued.
    isLoading: active && status === "LoadingFirstPage",
    isLoadingMore: status === "LoadingMore",
    hasMore: status === "CanLoadMore" || status === "LoadingMore",
    loadMore: loadMorePage,
  };
}
