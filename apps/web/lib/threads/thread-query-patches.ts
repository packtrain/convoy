import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CliThreadDetailItem = NonNullable<FunctionReturnType<typeof api.cli.threads.core.get>>;
export type ThreadGroup = NonNullable<FunctionReturnType<typeof api.cli.threads.groups.getGroup>>;
export type ThreadGroupChild = ThreadGroup["children"][number];

export type ThreadItemPatch = Partial<
  Pick<CliThreadDetailItem, "title" | "hasUnread" | "requiresAttention" | "isDone">
> & {
  /**
   * Group-child only: the strip's sort key for done tabs (OS-1478). The
   * detail item derives `isDone` server-side and carries no `doneAt`.
   */
  doneAt?: number;
};

export interface ThreadPatchTarget {
  /** The thread the workspace is showing — also the `get` subscription's arg. */
  threadId: Id<"cliThreads">;
  containerId: Id<"cliThreads"> | undefined;
}

/**
 * Optimistically apply a thread patch to both detail-page subscriptions: the
 * thread's own `get` and — when the thread is a group child — the container's
 * `getGroup` children (tab labels/states must not lag the header, OS-1477).
 * Writes are skipped when they would not change the query's data, so
 * subscribers don't re-render on identical values.
 */
export function patchThreadQueries(
  localStore: OptimisticLocalStore,
  target: ThreadPatchTarget,
  patch: ThreadItemPatch
): void {
  const { doneAt, ...rest } = patch;
  // Done ends the Pull request watch on the server, so its checks no longer show the thread as working.
  const ended = patch.isDone === true ? { pullRequestChecksRunning: false } : {};
  const detailPatch = { ...rest, ...ended };
  const detail = localStore.getQuery(api.cli.threads.core.get, { threadId: target.threadId });
  // The cache is keyed by the same id, so this only guards a mismatched
  // cached doc — cheap insurance against writing a patch onto the wrong row.
  if (detail && detail._id === target.threadId) {
    localStore.setQuery(api.cli.threads.core.get, { threadId: target.threadId }, { ...detail, ...detailPatch });
  }

  // Group children are narrow tab projections — apply only the fields they
  // actually carry. `doneAt` rides with `isDone`: the strip sorts done tabs by
  // it, so patching one without the other would sort against a stale key.
  const childPatch: Partial<ThreadGroupChild> = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.isDone !== undefined ? { isDone: patch.isDone, doneAt, ...ended } : {}),
    // Children carry `hasUnread` and `requiresAttention` since OS-1618, so mark-read/unread and
    // attention acknowledgement land here too: the first drives the tab's unread dot, the second
    // is what `getThreadDisplayStatus` reads to decide whether a failed tab still shows a red
    // one. The active tab reads the detail doc and would look right without either — until the
    // user switches away, when it would take the stale glyph back until the round trip landed.
    ...(patch.hasUnread !== undefined ? { hasUnread: patch.hasUnread } : {}),
    ...(patch.requiresAttention !== undefined
      ? { requiresAttention: patch.requiresAttention }
      : {}),
  };
  if (Object.keys(childPatch).length === 0) {
    return;
  }
  patchGroupChildren(localStore, target, (children) =>
    children.map((child) => (child._id === target.threadId ? { ...child, ...childPatch } : child))
  );
}

/**
 * Group removal's counterpart (OS-1478): the thread becomes a root thread, so its
 * tab leaves the strip and its detail stops resolving a container.
 */
export function moveThreadOutOfGroup(localStore: OptimisticLocalStore, target: ThreadPatchTarget): void {
  const detail = localStore.getQuery(api.cli.threads.core.get, { threadId: target.threadId });
  if (detail && detail._id === target.threadId) {
    localStore.setQuery(
      api.cli.threads.core.get,
      { threadId: target.threadId },
      { ...detail, parentThreadId: undefined, containerChildCount: undefined }
    );
  }
  removeThreadFromGroup(localStore, target);
}

/** Delete's counterpart: the tab disappears with the thread. */
export function removeThreadFromGroup(localStore: OptimisticLocalStore, target: ThreadPatchTarget): void {
  patchGroupChildren(localStore, target, (children) => children.filter((child) => child._id !== target.threadId));
}

function patchGroupChildren(
  localStore: OptimisticLocalStore,
  target: ThreadPatchTarget,
  update: (children: ThreadGroupChild[]) => ThreadGroupChild[]
): void {
  const { containerId } = target;
  if (!containerId) {
    return;
  }
  const group = localStore.getQuery(api.cli.threads.groups.getGroup, { containerId });
  if (!group) {
    return;
  }
  localStore.setQuery(api.cli.threads.groups.getGroup, { containerId }, { ...group, children: update(group.children) });
}
