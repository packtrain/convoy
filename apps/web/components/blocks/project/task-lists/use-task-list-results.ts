"use client";

import { useCallback, useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounce } from "@/hooks/react/use-debounce";
import { MAX_ACTIVE_TASK_LISTS } from "@/lib/task-lists/constants";
import type { TaskListItem } from "./task-list-types";

const INITIAL_PAGE_SIZE = 8;
const ACTIVE_LIST_PAGE_SIZE = MAX_ACTIVE_TASK_LISTS;
const LOAD_MORE_SIZE = 20;
const DEBOUNCE_MS = 200;

interface UseTaskListResultsArgs {
  projectId?: Id<"projects">;
  archived?: boolean;
}

function matchesTaskListSearch(list: TaskListItem, query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase();
  return (
    list.name.toLocaleLowerCase().includes(normalizedQuery) ||
    list.ref.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function useTaskListResults({
  projectId,
  archived = false,
}: UseTaskListResultsArgs) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const inputQuery = query.trim();
  const debouncedSearchQuery = debouncedQuery.trim();
  const unfilteredArgs = useMemo(() => {
    if (!projectId) {
      return "skip" as const;
    }

    return {
      projectId,
      archived,
    };
  }, [archived, projectId]);

  const unfiltered = usePaginatedQuery(api.tasks.lists.list, unfilteredArgs, {
    initialNumItems: archived ? INITIAL_PAGE_SIZE : ACTIVE_LIST_PAGE_SIZE,
  });
  const unfilteredLists = useMemo(() => unfiltered.results ?? [], [unfiltered.results]);
  const hasAllUnfilteredLists = unfiltered.status === "Exhausted";
  const shouldSearchLocally = inputQuery.length > 0 && hasAllUnfilteredLists;
  const shouldSearchServer = inputQuery.length > 0 && !hasAllUnfilteredLists;

  const serverSearchArgs = useMemo(() => {
    if (!projectId) {
      return "skip" as const;
    }
    if (!shouldSearchServer || !debouncedSearchQuery) {
      return "skip" as const;
    }

    return {
      projectId,
      archived,
      query: debouncedSearchQuery,
    };
  }, [archived, debouncedSearchQuery, projectId, shouldSearchServer]);

  const serverSearch = usePaginatedQuery(api.tasks.lists.list, serverSearchArgs, {
    initialNumItems: archived ? INITIAL_PAGE_SIZE : ACTIVE_LIST_PAGE_SIZE,
  });
  const serverSearchLists = useMemo(
    () => serverSearch.results ?? [],
    [serverSearch.results]
  );
  const localSearchLists = useMemo(() => {
    if (!shouldSearchLocally) {
      return [];
    }
    return unfilteredLists.filter((list) => matchesTaskListSearch(list, inputQuery));
  }, [inputQuery, shouldSearchLocally, unfilteredLists]);
  const resetQuery = useCallback(() => setQuery(""), []);
  const isSyncingServerQuery =
    shouldSearchServer && inputQuery !== debouncedSearchQuery;
  const status = shouldSearchServer ? serverSearch.status : unfiltered.status;
  const loadMore = shouldSearchServer ? serverSearch.loadMore : unfiltered.loadMore;
  const results = shouldSearchLocally
    ? localSearchLists
    : shouldSearchServer
      ? serverSearchLists
      : unfilteredLists;

  return {
    query,
    setQuery,
    resetQuery,
    results: isSyncingServerQuery ? [] : results,
    isLoading: isSyncingServerQuery || status === "LoadingFirstPage",
    isLoadingMore: !isSyncingServerQuery && status === "LoadingMore",
    activeListLimitReached:
      !archived &&
      hasAllUnfilteredLists &&
      unfilteredLists.length >= MAX_ACTIVE_TASK_LISTS,
    hasMore:
      !shouldSearchLocally &&
      !isSyncingServerQuery &&
      (status === "CanLoadMore" || status === "LoadingMore"),
    loadMore: () => loadMore(LOAD_MORE_SIZE),
  };
}

export function useActiveTaskListResults(projectId?: Id<"projects">) {
  return useTaskListResults({ projectId, archived: false });
}

export type TaskListResultsController = ReturnType<typeof useActiveTaskListResults>;

export function useResolvedTaskListResultsController({
  projectId,
  resultsController,
  enabled = true,
}: {
  projectId?: Id<"projects">;
  resultsController?: TaskListResultsController;
  enabled?: boolean;
}) {
  const localResultsController = useActiveTaskListResults(
    !resultsController && enabled ? projectId : undefined
  );
  return resultsController ?? localResultsController;
}

export function useSettingsTaskListResults({
  projectId,
  archived,
}: {
  projectId?: Id<"projects">;
  archived: boolean;
}) {
  return useTaskListResults({ projectId, archived });
}
