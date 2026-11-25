import type { ThreadListItemData } from "@/components/blocks/thread/thread-list-item";
import { areThreadTasksEqual } from "@/lib/threads/task-summary";

/**
 * Equality for thread rows (OS-1581) — the contract behind every memo gate in the
 * thread list. Convex hands back structurally new objects on each update, so identity
 * says nothing and the gates must compare fields.
 *
 * The field list is derived from the interface rather than hand-written, because
 * hand-listing is what let `sharedAt` and four others go stale silently. `-?` over
 * `keyof ThreadListItemData` makes an entry per field mandatory: add a field upstream
 * and this file stops compiling until you say how it compares.
 */
type ThreadFieldCheck = (
  prev: ThreadListItemData,
  next: ThreadListItemData
) => boolean;

type ThreadFieldChecks = {
  [Key in keyof ThreadListItemData]-?: ThreadFieldCheck;
};

/**
 * One field's check, with the key's type carried into `isEqual` so a
 * comparator can't be paired with the wrong field. Scalars take the default.
 */
function field<Key extends keyof ThreadListItemData>(
  key: Key,
  isEqual: (
    prev: ThreadListItemData[Key],
    next: ThreadListItemData[Key]
  ) => boolean = Object.is
): ThreadFieldCheck {
  return (prev, next) => isEqual(prev[key], next[key]);
}

/**
 * Flat value objects (the PR snapshot, the agent chip) compare key by key at
 * runtime rather than from a written-out list, so they can't drift either:
 * a field added to the backend validator is compared the moment it arrives.
 */
function areFlatValuesEqual(
  prev: object | undefined,
  next: object | undefined
): boolean {
  if (prev === next) {
    return true;
  }

  if (!prev || !next) {
    return false;
  }

  const prevEntries = Object.entries(prev);
  const nextEntries = new Map(Object.entries(next));
  if (prevEntries.length !== nextEntries.size) {
    return false;
  }

  return prevEntries.every(
    ([key, value]) => nextEntries.has(key) && Object.is(value, nextEntries.get(key))
  );
}

const THREAD_FIELD_CHECKS: ThreadFieldChecks = {
  _id: field("_id"),
  title: field("title"),
  branch: field("branch"),
  pathLabel: field("pathLabel"),
  pathString: field("pathString"),
  gitRemoteUrl: field("gitRemoteUrl"),
  linesAdded: field("linesAdded"),
  linesRemoved: field("linesRemoved"),
  pullRequest: field("pullRequest", areFlatValuesEqual),
  associatedTask: field("associatedTask", areThreadTasksEqual),
  attachedPullRequest: field("attachedPullRequest", areFlatValuesEqual),
  status: field("status"),
  hasPendingInteraction: field("hasPendingInteraction"),
  pullRequestChecksRunning: field("pullRequestChecksRunning"),
  queueHeldAt: field("queueHeldAt"),
  cliType: field("cliType"),
  agent: field("agent", areFlatValuesEqual),
  hasUnread: field("hasUnread"),
  requiresAttention: field("requiresAttention"),
  isDone: field("isDone"),
  lastActivityAt: field("lastActivityAt"),
  isPinned: field("isPinned"),
  // Read through `isContainerThread`, not by name — a group row drops the
  // actions that need a transcript of its own.
  kind: field("kind"),
  sharedAt: field("sharedAt"),
  background: field("background"),
  // A tab's share state lives on its container (OS-1579), so the row has to
  // watch it too — the badge and the share menu items both read it.
  containerSharedAt: field("containerSharedAt"),
  // Decides whether a tab may be shared at all (OS-1579): only a group child
  // can, and the child's own `kind` is always undefined.
  containerKind: field("containerKind"),
  parentThreadId: field("parentThreadId"),
  // A run row (OS-1366) is never shareable; both bindings gate the share menu.
  workflowRunId: field("workflowRunId"),
  containerWorkflowRunId: field("containerWorkflowRunId"),
  workflow: field("workflow", areFlatValuesEqual),
};

const THREAD_FIELD_CHECK_LIST = Object.values(THREAD_FIELD_CHECKS);

export function areThreadListItemsEqual(
  prev: ThreadListItemData,
  next: ThreadListItemData
): boolean {
  if (prev === next) {
    return true;
  }

  return THREAD_FIELD_CHECK_LIST.every((isFieldEqual) =>
    isFieldEqual(prev, next)
  );
}

export function areThreadListsEqual(
  prevThreads: readonly ThreadListItemData[],
  nextThreads: readonly ThreadListItemData[]
): boolean {
  if (prevThreads === nextThreads) {
    return true;
  }

  if (prevThreads.length !== nextThreads.length) {
    return false;
  }

  return prevThreads.every((prev, index) =>
    areThreadListItemsEqual(prev, nextThreads[index])
  );
}
