"use client";

import { useCallback, useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounce } from "@/hooks/react/use-debounce";
import type { ArchiveFilter } from "@/lib/tasks/types";
import type { TaskSelectorOption } from "@/lib/tasks/task-selector";

const DEFAULT_INITIAL_PAGE_SIZE = 50;
const SHOW_MORE_STEP = 100;
const DEBOUNCE_MS = 200;

function dedupeResults(results: TaskSelectorOption[] | undefined) {
  if (!results) {
    return [];
  }

  const uniqueById = new Map(results.map((result) => [result._id, result]));
  return Array.from(uniqueById.values());
}

interface UseTaskSelectorDataOptions {
  projectId?: Id<"projects">;
  enableSeededResults?: boolean;
  archiveMode?: ArchiveFilter;
  initialNumItems?: number;
}

export function useTaskSelectorData({
  projectId,
  enableSeededResults = false,
  archiveMode,
  initialNumItems = DEFAULT_INITIAL_PAGE_SIZE,
}: UseTaskSelectorDataOptions) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ArchiveFilter>("active");
  const activeArchiveMode = archiveMode ?? tab;

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const trimmedQuery = query.trim();
  const normalizedQuery = debouncedQuery.trim();
  const isSyncingQuery = trimmedQuery !== normalizedQuery;
  const hasQuery = trimmedQuery.length > 0;

  const searchArgs = useMemo(() => {
    if (!projectId || !normalizedQuery) {
      return "skip" as const;
    }

    return {
      projectId,
      query: normalizedQuery,
      archiveMode: activeArchiveMode,
    };
  }, [activeArchiveMode, normalizedQuery, projectId]);

  const shouldSeedBoardResults = enableSeededResults && !hasQuery && activeArchiveMode === "active" && !!projectId;

  const seededArgs = useMemo(() => {
    if (!shouldSeedBoardResults || !projectId) {
      return "skip" as const;
    }

    return { projectId };
  }, [projectId, shouldSeedBoardResults]);

  const {
    results: searchPaginatedResults,
    status: searchStatus,
    loadMore: loadMoreSearchResults,
  } = usePaginatedQuery(api.tasks.core.search.byProject, searchArgs, {
    initialNumItems,
  });

  const {
    results: seededPaginatedResults,
    status: seededStatus,
    loadMore: loadMoreSeededResults,
  } = usePaginatedQuery(api.tasks.core.search.recentForSelector, seededArgs, {
    initialNumItems,
  });

  const searchResults = useMemo(() => dedupeResults(searchPaginatedResults), [searchPaginatedResults]);
  const seededResults = useMemo(() => dedupeResults(seededPaginatedResults), [seededPaginatedResults]);

  const activeResults = hasQuery ? searchResults : seededResults;
  const activeStatus = hasQuery ? searchStatus : seededStatus;
  const results = isSyncingQuery ? [] : activeResults;
  const isLoadingInitial =
    hasQuery && !isSyncingQuery && normalizedQuery.length > 0
      ? searchStatus === "LoadingFirstPage"
      : shouldSeedBoardResults && seededStatus === "LoadingFirstPage";
  const isLoading = isSyncingQuery || isLoadingInitial;
  const isLoadingMore = !isSyncingQuery && activeStatus === "LoadingMore";
  const hasMore = !isSyncingQuery && (activeStatus === "CanLoadMore" || activeStatus === "LoadingMore");
  const resetQuery = useCallback(() => {
    setQuery("");
  }, []);

  const loadMore = useCallback(() => {
    if (hasQuery) {
      loadMoreSearchResults(SHOW_MORE_STEP);
      return;
    }

    loadMoreSeededResults(SHOW_MORE_STEP);
  }, [hasQuery, loadMoreSearchResults, loadMoreSeededResults]);

  return {
    query,
    setQuery,
    tab,
    setTab,
    hasQuery,
    isLoading,
    isLoadingMore,
    hasMore,
    results,
    resetQuery,
    loadMore,
  };
}
