"use client";

import { useCallback } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SIDEBAR_VIEW_THREADS_PAGE_SIZE } from "@/lib/threads/constants";

/** A separate list the thread sidebar swaps in from its settings menu. Spec: cli-thread-list.md. */
export type ThreadSidebarView = "shared" | "background";

type ViewThread = FunctionReturnType<typeof api.cli.threads.lists.listSharedByProject>["page"][number];

/**
 * The open view's threads, paginated with Load more: the user's own shared
 * threads (OS-1576) or background threads (OS-2513). Nothing subscribes while
 * no view is open. Live, so a row leaves or arrives on its own.
 */
export function useSidebarViewThreads(
  projectId: Id<"projects"> | undefined,
  view: ThreadSidebarView | null
): {
  threads: ViewThread[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const options = { initialNumItems: SIDEBAR_VIEW_THREADS_PAGE_SIZE };
  const shared = usePaginatedQuery(
    api.cli.threads.lists.listSharedByProject,
    view === "shared" && projectId !== undefined ? { projectId } : "skip",
    options
  );
  const background = usePaginatedQuery(
    api.cli.threads.lists.listByProject,
    view === "background" && projectId !== undefined ? { projectId, background: true } : "skip",
    options
  );
  const { results, status, loadMore } = view === "background" ? background : shared;

  const loadMorePage = useCallback(() => {
    loadMore(SIDEBAR_VIEW_THREADS_PAGE_SIZE);
  }, [loadMore]);

  return {
    threads: results,
    // A skipped paginated query reports `LoadingFirstPage`, so the closed view
    // would otherwise render a skeleton for a read it never issued.
    isLoading: view !== null && projectId !== undefined && status === "LoadingFirstPage",
    isLoadingMore: status === "LoadingMore",
    hasMore: status === "CanLoadMore" || status === "LoadingMore",
    loadMore: loadMorePage,
  };
}
