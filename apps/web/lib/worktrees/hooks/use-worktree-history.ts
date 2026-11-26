"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliHistoryScope } from "@/convex/lib/contracts/validators";
import { type HistoryLayout, readHistoryLayout, writeHistoryLayout } from "@/lib/threads/changes-view-prefs";
import { isRecord } from "@/lib/type-guards";
import { useWorktreeOp } from "@/lib/worktrees/hooks/use-worktree-op";

/** One `gitLog` row; mirrors `CommitSummary` in apps/cli/src/lib/git/history.ts (OS-2534). */
export interface CommitSummary {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committedAt: number;
  refs: string[];
  subject: string;
}

/** Where the branch left the default branch; mirrors `ForkPoint` in apps/cli/src/lib/git/history.ts (OS-2595). */
export interface ForkPoint {
  ref: string;
  hash: string;
  behind: number;
}

/** Mirrors `CommitPatch` in apps/cli/src/lib/git/history.ts. */
export interface CommitPatch {
  body: string;
  patch: string;
  truncated: boolean;
}

const MALFORMED = "The CLI sent a response this page cannot read.";

function parseJson(resultJson: string | undefined): Record<string, unknown> | null {
  if (!resultJson) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(resultJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isStringArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

function isCommitSummary(value: unknown): value is CommitSummary {
  return (
    isRecord(value) &&
    typeof value.hash === "string" &&
    typeof value.subject === "string" &&
    typeof value.authorName === "string" &&
    typeof value.authorEmail === "string" &&
    Number.isFinite(value.committedAt) &&
    isStringArray(value.parents) &&
    isStringArray(value.refs)
  );
}

const isForkPoint = (value: unknown): value is ForkPoint =>
  isRecord(value) && typeof value.ref === "string" && typeof value.hash === "string" && Number.isFinite(value.behind);

function parseCommitPage(resultJson: string | undefined): { commits: CommitSummary[]; nextCursor?: string; fork?: ForkPoint } | null {
  const parsed = parseJson(resultJson);
  if (!parsed || !Array.isArray(parsed.commits) || !parsed.commits.every(isCommitSummary)) {
    return null;
  }
  return {
    commits: parsed.commits,
    nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : undefined,
    fork: isForkPoint(parsed.fork) ? parsed.fork : undefined,
  };
}

function parseCommitPatch(resultJson: string | undefined): CommitPatch | null {
  const parsed = parseJson(resultJson);
  if (!parsed || typeof parsed.patch !== "string") {
    return null;
  }
  return { body: typeof parsed.body === "string" ? parsed.body : "", patch: parsed.patch, truncated: parsed.truncated === true };
}

interface CachedHistory {
  commits: CommitSummary[];
  nextCursor?: string;
  fork?: ForkPoint;
  /** When the first page came back. */
  fetchedAt: number;
  /** The caller's `refreshKey` then; a different one means a run landed since. */
  refreshKey?: string;
}

// ponytail: per-tab cache of the loaded rows, 20 checkout-scope pairs, oldest dropped; a remount within 60 s skips the fetch.
const MAX_CACHED_HISTORIES = 20;
const HISTORY_FRESH_MS = 60_000;
const historyCache = new Map<string, CachedHistory>();

export function clearHistoryCacheForTests() {
  historyCache.clear();
}

/**
 * Commits of one checkout, 50 per `gitLog` page (docs/specs/cli-worktrees.md →
 * Commit history). Earlier pages are kept while the next one loads; Refresh
 * starts over from the first page. A remount, or a change of `scope`, starts from the tab's cache.
 */
export function useWorktreeHistory(
  profileId: Id<"cliProfiles">,
  pathId: string,
  enabled: boolean,
  refreshKey?: string,
  scope?: CliHistoryScope
) {
  const cacheKey = `${profileId}:${pathId}:${scope ?? ""}`;
  const [shownKey, setShownKey] = useState(cacheKey);
  const [mountCache] = useState(() => historyCache.get(cacheKey));
  const isFresh = (entry: CachedHistory | undefined): entry is CachedHistory =>
    entry !== undefined &&
    Date.now() - entry.fetchedAt < HISTORY_FRESH_MS &&
    (refreshKey === undefined || entry.refreshKey === refreshKey);
  // A fresh cache hit stands in for the first pages until Load more or Refresh.
  const [held, setHeld] = useState(() => (isFresh(mountCache) ? mountCache : undefined));
  // Freshness counts from when History can fetch: check again when it turns on.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    if (enabled && held && !isFresh(held)) {
      setHeld(undefined);
    }
  }
  const [cursor, setCursor] = useState<string>();
  const [earlier, setEarlier] = useState<CommitSummary[]>([]);
  // The first page's fork point, once later pages (which have none) are on screen.
  const [earlierFork, setEarlierFork] = useState<ForkPoint>();
  // The rows before a Refresh (or a stale cache hit), on screen until the first page is back.
  const [previous, setPrevious] = useState<{ commits: CommitSummary[]; fork?: ForkPoint }>(() => mountCache ?? { commits: [] });
  // Another scope is another list: start over as a remount would.
  if (cacheKey !== shownKey) {
    const cached = historyCache.get(cacheKey);
    setShownKey(cacheKey);
    setHeld(isFresh(cached) ? cached : undefined);
    setCursor(undefined);
    setEarlier([]);
    setEarlierFork(undefined);
    setPrevious(cached ?? { commits: [] });
  }
  const op = useWorktreeOp({ profileId, pathId, kind: "gitLog", cursor, scope, enabled: enabled && !held });
  const page = useMemo(() => parseCommitPage(op.resultJson), [op.resultJson]);
  const commits = useMemo(
    () => held?.commits ?? (page ? [...earlier, ...page.commits] : earlier.length > 0 ? earlier : previous.commits),
    [held, earlier, page, previous]
  );
  const nextCursor = held ? held.nextCursor : page?.nextCursor;
  const fork = held ? held.fork : page ? (cursor === undefined ? page.fork : earlierFork) : earlier.length > 0 ? earlierFork : previous.fork;
  const loading = op.loading;
  const opError = op.error;
  // Starts true so a result already there on mount counts as one that just came back.
  const wasLoadingRef = useRef(true);

  useEffect(() => {
    const justSettled = wasLoadingRef.current && !loading;
    wasLoadingRef.current = loading;
    // Only a request that just succeeded renews the entry; a failed one keeps the last good page.
    if (!justSettled || opError || !page) {
      return;
    }
    const cached = historyCache.get(cacheKey);
    const fetchedAt = cursor === undefined ? Date.now() : (cached?.fetchedAt ?? Date.now());
    historyCache.delete(cacheKey);
    historyCache.set(cacheKey, { commits, nextCursor, fork, fetchedAt, refreshKey: refreshKey ?? cached?.refreshKey });
    if (historyCache.size > MAX_CACHED_HISTORIES) {
      historyCache.delete(historyCache.keys().next().value!);
    }
  }, [cacheKey, commits, cursor, fork, loading, nextCursor, opError, page, refreshKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) {
      return;
    }
    setHeld(undefined);
    setEarlier(commits);
    setEarlierFork(fork);
    setCursor(nextCursor);
  }, [commits, fork, nextCursor, loading]);
  const refreshOp = op.refresh;
  const refresh = useCallback(() => {
    setHeld(undefined);
    setPrevious({ commits, fork });
    setEarlier([]);
    setCursor(undefined);
    refreshOp();
  }, [commits, fork, refreshOp]);

  return {
    commits,
    /** Branch scope: where the branch left the default branch. */
    fork,
    /** Nothing to show yet: the first page is on its way. */
    initialLoading: loading && commits.length === 0,
    /** Refresh of the first page; the previous rows stay on screen meanwhile. */
    refreshing: loading && cursor === undefined && commits.length > 0,
    loadingMore: loading && cursor !== undefined,
    hasMore: nextCursor !== undefined,
    error: opError ?? (op.resultJson && !page ? MALFORMED : null),
    /** Re-sends the request that failed (the same page). */
    retry: refreshOp,
    loadMore,
    refresh,
  };
}

export type WorktreeHistory = ReturnType<typeof useWorktreeHistory>;

// ponytail: per-tab session cache, oldest dropped past 100 commits; commits never change.
const MAX_CACHED_PATCHES = 100;
const patchCache = new Map<string, CommitPatch>();

/** One commit's patch: fetched once per session, then served from the cache. */
export function useCommitPatch(profileId: Id<"cliProfiles">, pathId: string, hash: string, enabled: boolean) {
  const key = `${profileId}:${pathId}:${hash}`;
  const cached = patchCache.get(key);
  const op = useWorktreeOp({ profileId, pathId, kind: "commitPatch", postRef: hash, enabled: enabled && !cached });
  const fetched = useMemo(() => parseCommitPatch(op.resultJson), [op.resultJson]);
  useEffect(() => {
    if (!fetched) {
      return;
    }
    patchCache.set(key, fetched);
    if (patchCache.size > MAX_CACHED_PATCHES) {
      patchCache.delete(patchCache.keys().next().value!);
    }
  }, [key, fetched]);

  const result = cached ?? fetched;
  return {
    result,
    loading: !result && op.loading,
    error: result ? null : (op.error ?? (op.resultJson ? MALFORMED : null)),
    retry: op.refresh,
  };
}

/** History's List | Graph layout, kept per browser (OS-2536). */
export function useHistoryLayout() {
  const [layout, setLayout] = useState<HistoryLayout>(readHistoryLayout);
  const change = useCallback((next: HistoryLayout) => {
    writeHistoryLayout(next);
    setLayout(next);
  }, []);
  return [layout, change] as const;
}
