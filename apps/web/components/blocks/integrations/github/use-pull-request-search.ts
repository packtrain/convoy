import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useDebounce } from "@/hooks/react/use-debounce";
import { getErrorMessage } from "@/lib/errors";

type SearchPage = FunctionReturnType<typeof api.integrations.github.pullRequests.search>;
export type PullRequestSearchHit = SearchPage["pullRequests"][number];

const DEBOUNCE_MS = 300;

/** Live GitHub search, one-shot per page: results are temporary and never stored. */
export function usePullRequestSearch(
  projectId: Id<"projects">,
  query: string,
  { repositoryId, sort, order }: { repositoryId?: string; sort: "updated" | "created"; order: "asc" | "desc" }
) {
  const search = useAction(api.integrations.github.pullRequests.search);
  const trimmed = query.trim();
  const debounced = useDebounce(trimmed, DEBOUNCE_MS);
  const key = JSON.stringify([projectId, debounced, repositoryId, sort, order]);
  // One state per search, so coming back to a query starts it over. `attempt` makes Retry of
  // the same page a new request; `settled` is the attempt answered last.
  const [state, setState] = useState<SearchState>(() => freshSearch(key));
  const current = state.key === key ? state : freshSearch(key);
  const { page, attempt } = current;

  useEffect(() => {
    if (!debounced) return;
    let live = true;
    const settle = (change: (previous: SearchState) => Partial<SearchState>) =>
      live &&
      setState((previous) => {
        const base = previous.key === key ? previous : freshSearch(key);
        return { ...base, ...change(base), settled: attempt };
      });
    search({ projectId, query: debounced, repositoryId, sort, order, page }).then(
      (result) => settle((base) => ({ pages: [...base.pages.slice(0, page - 1), result], error: null })),
      (error: unknown) => settle(() => ({ error: getErrorMessage(error, "Search failed") }))
    );
    return () => {
      live = false;
    };
  }, [attempt, debounced, key, order, page, projectId, repositoryId, search, sort]);

  const loaded = current.pages;
  // GitHub's pages can shift between requests, so a PR may come back twice. Each page merges
  // several requests, so later pages can hold newer hits: sort everything loaded.
  const seen = new Set<string>();
  const field = sort === "created" ? "providerCreatedAt" : "providerUpdatedAt";
  const results = loaded
    .flatMap((result) => result.pullRequests)
    .filter((pr) => {
      const id = `${pr.repositoryId}#${pr.number}`;
      return !seen.has(id) && Boolean(seen.add(id));
    })
    .sort((a, b) => (order === "desc" ? b[field] - a[field] : a[field] - b[field]));
  const last = loaded.at(-1);
  const failures = last?.failures ?? [];
  // A page where a repository failed is asked for again rather than passed.
  const retryable = current.error !== null || failures.length > 0;
  return {
    active: trimmed !== "",
    /** The typed query or the last request has no answer yet. */
    loading: trimmed !== "" && (trimmed !== debounced || current.settled !== attempt),
    results,
    hasMore: !retryable && last?.hasMore === true,
    incomplete: loaded.some((result) => result.incomplete),
    omittedRepositories: last?.omittedRepositories ?? 0,
    failures,
    error: current.error,
    /** The request or a repository in it failed; `loadMore` asks for that page again. */
    retryable,
    loadMore: () => setState({ ...current, page: retryable ? page : loaded.length + 1, attempt: attempt + 1 }),
  };
}

type SearchState = { key: string; page: number; attempt: number; pages: SearchPage[]; error: string | null; settled: number | null };

function freshSearch(key: string): SearchState {
  return { key, page: 1, attempt: 0, pages: [], error: null, settled: null };
}
