"use client";

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** Quiet window a thread must hold before auto mark-read writes to it. */
const AUTO_READ_SETTLE_MS = 1_000;

interface UseCliThreadOptions {
  suppressAutoReadThreadId?: Id<"cliThreads">;
}

export function useCliThread(
  threadId: string | undefined,
  options?: UseCliThreadOptions
) {
  const thread = useQuery(
    api.cli.threads.core.get,
    threadId ? { threadId } : "skip"
  );

  const markReadMutation = useMutation(api.cli.threads.core.markRead);

  // Auto mark-read while the thread is open and unread. Self-stabilizing: markRead sets
  // readAt → hasUnread false → effect stops.
  //
  // Settled threads only, and only after a quiet beat: every run-lifecycle write bumps
  // lastActivityAt and flips the thread unread again, so firing here would land on the CLI's
  // own writes to the same doc and force OCC retries of releaseClaim. Any doc change re-runs
  // the effect and cancels the timer, so the write happens once the burst is over.
  //
  // Viewers of a shared thread are skipped: markRead is owner-only, and the read-only path is
  // specified to perform zero writes so N watchers add no contention
  // (`docs/specs/cli-thread-sharing.md`).
  useEffect(() => {
    if (
      !thread ||
      !thread.hasUnread ||
      thread.isOwner === false ||
      thread._id === options?.suppressAutoReadThreadId ||
      thread.processingState !== "idle"
    ) {
      return;
    }

    const threadId = thread._id;
    const timer = setTimeout(() => {
      void markReadMutation({ threadId });
    }, AUTO_READ_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [thread, markReadMutation, options?.suppressAutoReadThreadId]);

  return {
    thread: thread ?? null,
    isLoading: thread === undefined,
  };
}
