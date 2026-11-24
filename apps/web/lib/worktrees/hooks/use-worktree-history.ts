"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
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

function parseCommitPage(resultJson: string | undefined): { commits: CommitSummary[]; nextCursor?: string } | null {
  const parsed = parseJson(resultJson);
  if (!parsed || !Array.isArray(parsed.commits) || !parsed.commits.every(isCommitSummary)) {
    return null;
  }
  return {
    commits: parsed.commits,
    nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : undefined,
  };
}

function parseCommitPatch(resultJson: string | undefined): CommitPatch | null {
  const parsed = parseJson(resultJson);
  if (!parsed || typeof parsed.patch !== "string") {
    return null;
  }
  return { body: typeof parsed.body === "string" ? parsed.body : "", patch: parsed.patch, truncated: parsed.truncated === true };
}

/**
 * Commits of one checkout, 50 per `gitLog` page (docs/specs/cli-worktrees.md →
 * Commit history). Earlier pages are kept while the next one loads; Refresh
 * starts over from the first page.
 */
export function useWorktreeHistory(profileId: Id<"cliProfiles">, pathId: string, enabled: boolean) {
  const [cursor, setCursor] = useState<string>();
  const [earlier, setEarlier] = useState<CommitSummary[]>([]);
  const op = useWorktreeOp({ profileId, pathId, kind: "gitLog", cursor, enabled });
  const page = useMemo(() => parseCommitPage(op.resultJson), [op.resultJson]);
  const commits = useMemo(() => (page ? [...earlier, ...page.commits] : earlier), [earlier, page]);
  const nextCursor = page?.nextCursor;
  const loading = op.loading;

  const loadMore = useCallback(() => {
    if (!nextCursor || loading) {
      return;
    }
    setEarlier(commits);
    setCursor(nextCursor);
  }, [commits, nextCursor, loading]);
  const refreshOp = op.refresh;
  const refresh = useCallback(() => {
    setEarlier([]);
    setCursor(undefined);
    refreshOp();
  }, [refreshOp]);

  return {
    commits,
    /** Nothing to show yet: the first page is on its way. */
    initialLoading: loading && commits.length === 0,
    /** Refresh of the first page; the previous rows stay on screen meanwhile. */
    refreshing: loading && cursor === undefined && commits.length > 0,
    loadingMore: loading && cursor !== undefined,
    hasMore: nextCursor !== undefined,
    error: op.error ?? (op.resultJson && !page ? MALFORMED : null),
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
