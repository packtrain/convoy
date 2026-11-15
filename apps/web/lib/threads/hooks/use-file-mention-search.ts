"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isRecord } from "@/lib/type-guards";

const SEARCH_DEBOUNCE_MS = 150;

/** Where file searches execute: the composer's selected profile + path entry. */
export interface FileMentionContext {
  profileId: string;
  pathId: string;
  isProfileOnline: boolean;
}

function parseFiles(resultJson: string | undefined): string[] {
  if (!resultJson) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(resultJson);
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
      return [];
    }
    return parsed.files.filter((file): file is string => typeof file === "string");
  } catch {
    return [];
  }
}

/**
 * Live repo-file search for composer @-mentions (OS-1144): debounce the query, enqueue
 * a `searchFiles` op on the worktree op channel, watch the row for the CLI's result.
 * Previous results stay rendered while a newer query is in flight. Inert without an
 * active @ trigger, an online agent, or a Convex provider (composer unit tests) — hence
 * the raw-client API, which doesn't throw without one.
 */
export function useFileMentionSearch(
  context: FileMentionContext | null,
  query: string | null
): { files: string[]; isLoading: boolean } {
  const convex = useConvex();
  // The rendered results carry the query they answered: isLoading stays true
  // from the first keystroke until the op for the *current* query settles,
  // with no "no results" flash across the debounce/enqueue/watch gaps.
  const [settled, setSettled] = useState<{ query: string; files: string[] } | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState<string | null>(null);
  const [activeOpId, setActiveOpId] = useState<Id<"cliWorktreeOps"> | null>(null);

  const profileId = context?.isProfileOnline ? context.profileId : null;
  const pathId = context?.isProfileOnline ? context.pathId : null;
  const enabled =
    convex !== undefined && profileId !== null && pathId !== null && query !== null;

  // Render-phase adjustment (not an effect): closing the menu clears the
  // debounced query immediately.
  if (!enabled && debouncedQuery !== null) {
    setDebouncedQuery(null);
  }

  // Stale results from another working directory must not flash in the menu.
  const pathKey = profileId && pathId ? `${profileId}:${pathId}` : null;
  const lastPathKeyRef = useRef(pathKey);
  if (lastPathKeyRef.current !== pathKey) {
    lastPathKeyRef.current = pathKey;
    setSettled(null);
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timeout = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [enabled, query]);

  // Enqueue on each debounced query change. A newer enqueue simply replaces
  // the watched op; a stale op's result is never consumed (the row gets
  // TTL-pruned server-side).
  useEffect(() => {
    if (!convex || debouncedQuery === null || !profileId || !pathId) {
      return;
    }
    let cancelled = false;
    convex
      .mutation(api.cli.worktreeOps.enqueue, {
        profileId: profileId as Id<"cliProfiles">,
        kind: "searchFiles",
        pathId,
        query: debouncedQuery,
      })
      .then((id) => {
        if (!cancelled) {
          setActiveOpId(id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveOpId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [convex, debouncedQuery, pathId, profileId]);

  // Watch the active op with a client subscription and consume it on settle.
  useEffect(() => {
    if (!convex || !activeOpId) {
      return;
    }
    const watch = convex.watchQuery(api.cli.worktreeOps.get, { opId: activeOpId });
    const consume = () => {
      let op;
      try {
        op = watch.localQueryResult();
      } catch {
        op = null;
      }
      if (!op || op.status === "pending") {
        return;
      }
      setActiveOpId(null);
      setSettled({
        query: op.query ?? "",
        files: op.status === "done" ? parseFiles(op.resultJson) : [],
      });
    };
    const unsubscribe = watch.onUpdate(consume);
    // Consume a result that already settled before this watcher attached.
    queueMicrotask(consume);
    return unsubscribe;
  }, [activeOpId, convex]);

  return {
    files: enabled && settled ? settled.files : [],
    isLoading: enabled && settled?.query !== query,
  };
}
