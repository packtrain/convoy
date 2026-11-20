import { useEffect, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { format } from "date-fns";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { IntegrationStatus } from "./use-integration-status";

type ListOptions = Omit<FunctionArgs<typeof api.integrations.github.pullRequests.list>, "projectId" | "paginationOpts">;
type Connection = IntegrationStatus["connections"][number];

export const PAGE_SIZE = 30;

/**
 * Newest-updated order shows a true prefix of closed history; any other
 * order shows only the imported window, so say how far back it reaches.
 */
export function coverageNotice(coveredSince: number | null, { sort, order }: Pick<ListOptions, "sort" | "order">): string | null {
  if (coveredSince === null || (sort === "updated" && order === "desc")) return null;
  return `Showing closed pull requests updated since ${format(coveredSince, "MMM d, yyyy")}. Load more to go further back.`;
}

/**
 * Stored PRs for one tab. Closed also imports history: the newest page when
 * shown, and the next one when Load more runs past the stored rows.
 */
export function usePullRequestList(projectId: Id<"projects">, options: ListOptions, scope: Connection[]) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.integrations.github.pullRequests.list,
    { projectId, ...options },
    { initialNumItems: PAGE_SIZE }
  );
  const loadHistory = useMutation(api.integrations.github.pullRequests.loadHistory);
  const closed = options.tab === "closed";
  const { repositoryId } = options;
  const complete = scope.every((connection) => connection.repository.history.complete);
  const importing = scope.some((connection) => connection.repository.history.loading);
  // Rows updated before the least-covered repository's bound wait for Load more, as in `pullRequests.list`.
  const bounds = scope.filter((connection) => !connection.repository.history.complete).map((connection) => connection.repository.history.coveredThrough);
  const coveredSince = closed && bounds.length && bounds.every((bound) => bound !== undefined) ? Math.max(...bounds) : null;
  // A repository connected while Closed is shown needs its first page too.
  const scopeKey = scope.map((connection) => connection.repositoryId).join();
  // Rows the member asked to see; reset when the list changes.
  const key = JSON.stringify(options);
  const [wanted, setWanted] = useState({ key, rows: 0 });
  const target = wanted.key === key ? wanted.rows : 0;

  useEffect(() => {
    if (closed) void loadHistory({ projectId, repositoryId, more: false });
  }, [closed, loadHistory, projectId, repositoryId, scopeKey]);
  // A history page lands as more stored rows past the last loaded page; page them in.
  useEffect(() => {
    if (status === "CanLoadMore" && results.length < target) loadMore(PAGE_SIZE);
  }, [loadMore, results.length, status, target]);

  const exhausted = status === "Exhausted";
  // A You filter's page can end short at its row cap, so chasing 30 matches could read the whole history.
  const filtered = Boolean(options.author || options.assignee);
  return {
    results,
    status,
    /** History has a page Convoy has not imported, so the list has a Load more even with every stored row in. */
    hasMore: status === "CanLoadMore" || (closed && exhausted && !complete),
    isLoadingMore: status === "LoadingMore" || (results.length < target && importing),
    /** Closed history is on its way, so an empty Closed list is not yet empty. */
    importing: closed && (importing || scope.some((connection) => !connection.repository.history.started && connection.repository.syncStatus !== "error")),
    /** Closed shows only PRs updated since this until every history page is in; null once it reaches the start. */
    coveredSince,
    loadMore: () => {
      if (filtered && status === "CanLoadMore") return loadMore(PAGE_SIZE);
      setWanted({ key, rows: results.length + (filtered ? 1 : PAGE_SIZE) });
      if (closed && exhausted && !complete) void loadHistory({ projectId, repositoryId, more: true });
    },
  };
}
