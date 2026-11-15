"use client";

import { useCallback, useMemo } from "react";
import { usePaginatedQuery, useMutation, useQuery, optimisticallyUpdateValueInPaginatedQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadSortBy } from "@/convex/lib/contracts/validators";

const PAGE_SIZE = 60;
// The Done section renders collapsed by default, so its first page stays
// small; "Load more" pages in the rest (OS-1394).
const DONE_PAGE_SIZE = 20;

type CliThreadItem = FunctionReturnType<typeof api.cli.threads.lists.listPinnedByProject>[number];

interface ThreadListArgs {
  projectId: Id<"projects">;
  sortBy: ThreadSortBy;
  isDone?: boolean;
}

function withDonePresentation(thread: CliThreadItem, isDone: boolean): CliThreadItem {
  if (!isDone) {
    return { ...thread, isDone: false };
  }

  return {
    ...thread,
    isDone: true,
    hasUnread: false,
    requiresAttention: false,
  };
}

function optimisticallySetDoneState({
  localStore,
  projectId,
  listArgsVariants,
  threadIds,
  isDone,
}: {
  localStore: OptimisticLocalStore;
  projectId: Id<"projects">;
  listArgsVariants: ThreadListArgs[];
  threadIds: Id<"cliThreads">[];
  isDone: boolean;
}) {
  const threadIdSet = new Set(threadIds);
  for (const listArgs of listArgsVariants) {
    optimisticallyUpdateValueInPaginatedQuery(localStore, api.cli.threads.lists.listByProject, listArgs, (thread) =>
      threadIdSet.has(thread._id) ? withDonePresentation(thread, isDone) : thread
    );
  }

  const pinned = localStore.getQuery(api.cli.threads.lists.listPinnedByProject, {
    projectId,
  });
  if (pinned === undefined) {
    return;
  }

  localStore.setQuery(
    api.cli.threads.lists.listPinnedByProject,
    { projectId },
    pinned.map((thread) => (threadIdSet.has(thread._id) ? withDonePresentation(thread, isDone) : thread))
  );
}

interface UseCliThreadsOptions {
  sortBy?: ThreadSortBy;
  groupDone?: boolean;
  /**
   * Gate for the list queries. Callers whose options depend on async state
   * (e.g. the server-stored `threadGroupDone` preference) pass `false` until
   * that state resolves, so the first fetch commits to the right mode instead
   * of loading the ungrouped list and re-fetching grouped.
   */
  enabled?: boolean;
}

export function useCliThreads(projectId: Id<"projects"> | undefined, options?: UseCliThreadsOptions) {
  const { sortBy, groupDone, enabled = true } = options ?? {};
  const resolvedSortBy = sortBy ?? "created";
  // Memoized because the optimistic mutations below close over these, and a
  // mutation that rebuilds on every render hands the sidebar a new callback
  // every render — which is enough on its own to defeat its memo (OS-1581).
  const listArgs = useMemo<ThreadListArgs | undefined>(
    () => (projectId && enabled ? { projectId, sortBy: resolvedSortBy } : undefined),
    [projectId, enabled, resolvedSortBy]
  );

  // Grouped mode (OS-1394) pages the Active and Done sections separately;
  // ungrouped keeps the single query every other caller uses.
  const ungrouped = usePaginatedQuery(api.cli.threads.lists.listByProject, listArgs && !groupDone ? listArgs : "skip", {
    initialNumItems: PAGE_SIZE,
  });
  const active = usePaginatedQuery(api.cli.threads.lists.listByProject, listArgs && groupDone ? { ...listArgs, isDone: false } : "skip", {
    initialNumItems: PAGE_SIZE,
  });
  const done = usePaginatedQuery(api.cli.threads.lists.listByProject, listArgs && groupDone ? { ...listArgs, isDone: true } : "skip", {
    initialNumItems: DONE_PAGE_SIZE,
  });

  const listArgsVariants = useMemo<ThreadListArgs[]>(() => {
    if (!listArgs) {
      return [];
    }

    return groupDone
      ? [
          { ...listArgs, isDone: false },
          { ...listArgs, isDone: true },
        ]
      : [listArgs];
  }, [listArgs, groupDone]);

  const pinnedResults = useQuery(api.cli.threads.lists.listPinnedByProject, projectId ? { projectId } : "skip");

  // Pinned threads render in their own section, so keep them out of the general list (OS-1173).
  // In grouped mode the two section queries are merged and re-split by `isDone` client-side
  // (deduped by `_id`), so an optimistic done toggle moves the row across sections before the
  // server converges. The merge re-sorts by the server's key so a mid-flight row lands in its
  // final position instead of jumping again.
  const visibleThreads = useMemo(() => {
    if (!groupDone) {
      return (ungrouped.results ?? []).filter((thread) => !thread.isPinned);
    }
    const byId = new Map<Id<"cliThreads">, CliThreadItem>();
    for (const thread of [...(active.results ?? []), ...(done.results ?? [])]) {
      if (!thread.isPinned) byId.set(thread._id, thread);
    }
    return [...byId.values()].sort((a, b) =>
      resolvedSortBy === "created" ? b.createdAt - a.createdAt : b.lastActivityAt - a.lastActivityAt
    );
  }, [groupDone, ungrouped.results, active.results, done.results, resolvedSortBy]);

  const threads = useMemo(() => (groupDone ? visibleThreads.filter((thread) => !thread.isDone) : visibleThreads), [groupDone, visibleThreads]);
  const doneThreads = useMemo(() => (groupDone ? visibleThreads.filter((thread) => thread.isDone) : []), [groupDone, visibleThreads]);
  const pinnedThreads = useMemo(() => pinnedResults ?? [], [pinnedResults]);

  const { status, loadMore } = groupDone ? active : ungrouped;
  const { loadMore: loadMoreDonePage } = done;

  const loadMorePage = useCallback(() => {
    loadMore(PAGE_SIZE);
  }, [loadMore]);

  const loadMoreDone = useCallback(() => {
    loadMoreDonePage(DONE_PAGE_SIZE);
  }, [loadMoreDonePage]);

  const removeMutation = useMutation(api.cli.threads.core.remove);
  const markReadMutation = useMutation(api.cli.threads.core.markRead);
  const markUnreadMutation = useMutation(api.cli.threads.core.markUnread);
  const updateTitleMutation = useMutation(api.cli.threads.core.updateTitle);
  const batchMarkReadMutation = useMutation(api.cli.threads.batch.batchMarkRead);
  // `withOptimisticUpdate` returns a brand-new mutation every call, so each of
  // these is memoized on what its update closes over — otherwise the callbacks
  // built from them below change identity on every render (OS-1581).
  const baseBatchMarkDone = useMutation(api.cli.threads.batch.batchMarkDone);
  const batchMarkDoneMutation = useMemo(
    () =>
      baseBatchMarkDone.withOptimisticUpdate((localStore, args) => {
        if (!projectId || !listArgs) return;
        optimisticallySetDoneState({
          localStore,
          projectId,
          listArgsVariants,
          threadIds: args.threadIds,
          isDone: true,
        });
      }),
    [baseBatchMarkDone, projectId, listArgs, listArgsVariants]
  );

  const baseBatchMarkNotDone = useMutation(api.cli.threads.batch.batchMarkNotDone);
  const batchMarkNotDoneMutation = useMemo(
    () =>
      baseBatchMarkNotDone.withOptimisticUpdate((localStore, args) => {
        if (!projectId || !listArgs) return;
        optimisticallySetDoneState({
          localStore,
          projectId,
          listArgsVariants,
          threadIds: args.threadIds,
          isDone: false,
        });
      }),
    [baseBatchMarkNotDone, projectId, listArgs, listArgsVariants]
  );
  const batchRemoveMutation = useMutation(api.cli.threads.batch.batchRemove);

  // Pin/unpin update both the paginated list (flag flip) and the pinned query
  // (membership) optimistically so the row moves between sections instantly.
  const basePin = useMutation(api.cli.threads.core.pin);
  const pinMutation = useMemo(
    () =>
      basePin.withOptimisticUpdate((localStore, args) => {
        if (!projectId || !listArgs) return;
        // eslint-disable-next-line react-hooks/purity -- callback runs on mutation, not render
        const now = globalThis.Date.now();

        let pinnedItem: CliThreadItem | undefined;
        for (const variant of listArgsVariants) {
          optimisticallyUpdateValueInPaginatedQuery(localStore, api.cli.threads.lists.listByProject, variant, (item) => {
            if (item._id !== args.threadId) return item;
            pinnedItem = { ...item, isPinned: true, pinnedAt: now };
            return pinnedItem;
          });
        }

        const pinned = localStore.getQuery(api.cli.threads.lists.listPinnedByProject, {
          projectId,
        });
        if (pinned !== undefined && pinnedItem !== undefined) {
          localStore.setQuery(api.cli.threads.lists.listPinnedByProject, { projectId }, [
            pinnedItem,
            ...pinned.filter((thread) => thread._id !== args.threadId),
          ]);
        }
      }),
    [basePin, projectId, listArgs, listArgsVariants]
  );

  const baseUnpin = useMutation(api.cli.threads.core.unpin);
  const unpinMutation = useMemo(
    () =>
      baseUnpin.withOptimisticUpdate((localStore, args) => {
        if (!projectId || !listArgs) return;

        for (const variant of listArgsVariants) {
          optimisticallyUpdateValueInPaginatedQuery(localStore, api.cli.threads.lists.listByProject, variant, (item) =>
            item._id === args.threadId ? { ...item, isPinned: false, pinnedAt: undefined } : item
          );
        }

        const pinned = localStore.getQuery(api.cli.threads.lists.listPinnedByProject, {
          projectId,
        });
        if (pinned !== undefined) {
          localStore.setQuery(
            api.cli.threads.lists.listPinnedByProject,
            { projectId },
            pinned.filter((thread) => thread._id !== args.threadId)
          );
        }
      }),
    [baseUnpin, projectId, listArgs, listArgsVariants]
  );

  const removeThread = useCallback(
    async (threadId: Id<"cliThreads">) => {
      await removeMutation({ threadId });
    },
    [removeMutation]
  );

  const markRead = useCallback(
    async (threadId: Id<"cliThreads">, options?: { acknowledgeAttention?: boolean }) => {
      await markReadMutation({
        threadId,
        acknowledgeAttention: options?.acknowledgeAttention,
      });
    },
    [markReadMutation]
  );

  const markUnread = useCallback(
    async (threadId: Id<"cliThreads">) => {
      await markUnreadMutation({ threadId });
    },
    [markUnreadMutation]
  );

  const renameThread = useCallback(
    async (threadId: Id<"cliThreads">, title: string) => {
      await updateTitleMutation({ threadId, title });
    },
    [updateTitleMutation]
  );

  const pinThread = useCallback(
    async (threadId: Id<"cliThreads">) => {
      await pinMutation({ threadId });
    },
    [pinMutation]
  );

  const unpinThread = useCallback(
    async (threadId: Id<"cliThreads">) => {
      await unpinMutation({ threadId });
    },
    [unpinMutation]
  );

  const batchMarkRead = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      await batchMarkReadMutation({ threadIds });
    },
    [batchMarkReadMutation]
  );

  const batchMarkDone = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      await batchMarkDoneMutation({ threadIds });
    },
    [batchMarkDoneMutation]
  );

  const batchMarkNotDone = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      await batchMarkNotDoneMutation({ threadIds });
    },
    [batchMarkNotDoneMutation]
  );

  const batchRemoveThreads = useCallback(
    async (threadIds: Id<"cliThreads">[]) => {
      await batchRemoveMutation({ threadIds });
    },
    [batchRemoveMutation]
  );

  return {
    threads,
    doneThreads,
    pinnedThreads,
    isLoading: status === "LoadingFirstPage",
    hasMore: status === "CanLoadMore" || status === "LoadingMore",
    isLoadingMore: status === "LoadingMore",
    loadMore: loadMorePage,
    hasMoreDone: done.status === "CanLoadMore" || done.status === "LoadingMore",
    isLoadingMoreDone: done.status === "LoadingMore",
    loadMoreDone,
    removeThread,
    markRead,
    markUnread,
    renameThread,
    pinThread,
    unpinThread,
    batchMarkRead,
    batchMarkDone,
    batchMarkNotDone,
    batchRemoveThreads,
  };
}
