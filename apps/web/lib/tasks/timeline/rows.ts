import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadStatus } from "@/lib/threads/types";
import type { ActivityLog, Comment, TaskAgentThreadWorkEntry } from "@/lib/tasks/types";

/**
 * The task timeline's row model (OS-1589, `docs/specs/task-timeline.md`).
 *
 * Pure on purpose: the merge, ordering, activity grouping and thread splice rule are
 * cheap to get subtly wrong and expensive to see in a rendered sidebar, so they live
 * here with tests rather than inside a component body.
 */

/**
 * Everything the thread source needs, present or absent as a unit.
 *
 * One value instead of three optional strings, because "is there a project route" was
 * spelled four different ways across the timeline — and one omitted `projectId`, so they
 * were not even equivalent. Presence of this object *is* the predicate, enforced at
 * every consumer.
 */
export interface TimelineThreadContext {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
}

/** A thread row, flattened from either source so the stream holds one shape. */
export interface TimelineThreadRow {
  threadId: Id<"cliThreads">;
  title: string;
  status: ThreadStatus;
  cliType: string;
  /** Sort position — when the run started, never when it last changed. */
  createdAt: number;
  /** What the card *displays* ("2m"). Deliberately not the sort key. */
  lastActivityAt: number;
  /** Owner attribution, on another user's thread only. */
  userName?: string;
  /**
   * Unread activity since the viewer last opened it. Own threads only —
   * `agentThreadWork` carries no per-viewer read state, and a teammate's run is
   * not something the viewer can have read.
   */
  hasUnread: boolean;
  /** Explicitly marked done after the latest activity. Own threads only. */
  isDone: boolean;
  /** False for a foreign thread: the viewer cannot open it in place. */
  isOwn: boolean;
  /** This row *is* a workflow run — its container thread, never a lane inside it (OS-1879). */
  isWorkflowRun: boolean;
}

/** One stream entry, before consecutive activity rows are grouped. */
export type TimelineRow =
  | { kind: "activity"; at: number; activity: ActivityLog }
  | { kind: "comment"; at: number; comment: Comment }
  | { kind: "thread"; at: number; thread: TimelineThreadRow };

/**
 * One rendered block. Consecutive activity rows share a rail, so a block is
 * either a rail group or a single self-contained row.
 */
export type TimelineBlock =
  | { kind: "activity-group"; key: string; activities: ActivityLog[] }
  | { kind: "comment"; key: string; comment: Comment }
  | { kind: "thread"; key: string; thread: TimelineThreadRow };

/** Newest-first or oldest-first display. Pagination is always newest-first. */
export type TimelineSortDirection = "asc" | "desc";

/** The subset of `cli.threads.listByAssociatedTask` a thread row needs. */
export interface OwnTimelineThread {
  _id: Id<"cliThreads">;
  title: string;
  status: ThreadStatus;
  cliType: string;
  createdAt: number;
  lastActivityAt: number;
  hasPendingInteraction?: boolean;
  requiresAttention: boolean;
  pullRequestChecksRunning: boolean;
  hasUnread: boolean;
  isDone: boolean;
  workflowRunId?: Id<"workflowRuns">;
  parentThreadId?: Id<"cliThreads">;
}

/**
 * A foreign entry's sort key. `createdAt` is absent on entries written before
 * OS-1588 and only backfills on the thread's next state change — a finished run
 * may never have one — so the fallback is permanent, not transitional.
 * `updatedAt` places such a row later in history than it belongs.
 */
export function getAgentThreadWorkSortKey(entry: TaskAgentThreadWorkEntry): number {
  return entry.createdAt ?? entry.updatedAt;
}

/**
 * Both thread sources, merged into one row list.
 *
 * **Load-order guard.** While `listByAssociatedTask` is unresolved the own-id set is
 * empty, so every entry would match the "not mine" test and render as foreign. Foreign
 * rows are withheld until it resolves, as the Runs column does.
 */
export function buildTimelineThreadRows({
  ownThreads,
  agentThreadWork,
  deriveOwnStatus,
}: {
  /** `undefined` while the query is in flight. */
  ownThreads: readonly OwnTimelineThread[] | undefined;
  agentThreadWork: readonly TaskAgentThreadWorkEntry[] | undefined;
  /** Injected so this module stays free of display-status policy. */
  deriveOwnStatus: (thread: OwnTimelineThread) => ThreadStatus;
}): TimelineThreadRow[] {
  const own = (ownThreads ?? []).map(
    (thread): TimelineThreadRow => ({
      threadId: thread._id,
      title: thread.title,
      status: deriveOwnStatus(thread),
      cliType: thread.cliType,
      createdAt: thread.createdAt,
      lastActivityAt: thread.lastActivityAt,
      hasUnread: thread.hasUnread,
      isDone: thread.isDone,
      isOwn: true,
      // A lane thread carries the run's id too but sits inside it — badging it
      // would duplicate the run's own row (OS-1879).
      isWorkflowRun: thread.workflowRunId !== undefined && thread.parentThreadId === undefined,
    })
  );

  if (ownThreads === undefined) {
    return own;
  }

  const ownIds = new Set(own.map((row) => row.threadId));
  const foreign = (agentThreadWork ?? [])
    .filter((entry) => !ownIds.has(entry.threadId))
    .map(
      (entry): TimelineThreadRow => ({
        threadId: entry.threadId,
        title: entry.threadTitle,
        status: entry.status,
        cliType: entry.cliType,
        createdAt: getAgentThreadWorkSortKey(entry),
        // The entry carries no activity timestamp of its own; `updatedAt` is
        // the closest thing, and it is what the Runs column already displays.
        lastActivityAt: entry.updatedAt,
        userName: entry.userName,
        // Read state is per-viewer and the entry has none; "unread" is not a
        // meaningful claim about someone else's run.
        hasUnread: false,
        isDone: false,
        isOwn: false,
        // A `workflow_run`-sourced entry is a *lane* thread — the run's
        // container syncs as `manual_attachment` and the entry carries no
        // parent — so no foreign row can be identified as the run itself.
        isWorkflowRun: false,
      })
    );

  return [...own, ...foreign];
}

/**
 * Drop threads older than the loaded stream.
 *
 * Threads are not paginated — both sources load whole — so without this a year-old
 * thread would sit above activity that hasn't loaded. The floor is `nextBefore.at`;
 * `null` means every enabled source is exhausted and the floor is unbounded.
 *
 * Compares on `at` alone: threads have no `_creationTime` here, and a thread tied with
 * the floor row renders rather than being withheld.
 */
export function spliceThreadRows(rows: readonly TimelineThreadRow[], floor: number | null): TimelineThreadRow[] {
  if (floor === null) {
    return [...rows];
  }
  return rows.filter((row) => row.createdAt >= floor);
}

/**
 * Merge every source into display order.
 *
 * Sorts on `at` only and relies on a stable sort, so rows tied to one millisecond keep
 * input order — server rows as the merge query emitted them (itself exact), threads
 * after. Reversing for ascending display mirrors that tie order rather than scrambling
 * it, which a synthetic tiebreak would.
 */
export function mergeTimelineRows({
  items,
  threadRows,
  direction,
}: {
  /** The server page's rows, newest-first. */
  items: ReadonlyArray<{ kind: "activity"; at: number; activity: ActivityLog } | { kind: "comment"; at: number; comment: Comment }>;
  threadRows: readonly TimelineThreadRow[];
  direction: TimelineSortDirection;
}): TimelineRow[] {
  const rows: TimelineRow[] = [...items, ...threadRows.map((thread): TimelineRow => ({ kind: "thread", at: thread.createdAt, thread }))];

  // `rows` is built fresh above, so sorting and reversing in place mutate only
  // this local — `items` and `threadRows` stay untouched, which their
  // `readonly` types promise and the spread above is what actually upholds.
  const sorted = rows.sort((a, b) => b.at - a.at);
  return direction === "desc" ? sorted : sorted.reverse();
}

/** Stable React key for a row — no index, so keys survive prepended pages. */
function rowKey(row: TimelineRow): string {
  if (row.kind === "activity") return `activity:${row.activity._id}`;
  if (row.kind === "comment") return `comment:${row.comment._id}`;
  return `thread:${row.thread.threadId}`;
}

/**
 * Collapse consecutive activity rows into rail groups; a comment or thread row breaks a
 * group.
 *
 * Unlike the avatar-attributed activity log, the rail does **not** also split on user or
 * the ~1s window: every rail row carries its own icon, actor and timestamp, so a split
 * would only break the shared vertical line (`docs/specs/task-timeline.md`).
 */
export function groupTimelineRows(rows: readonly TimelineRow[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];

  for (const row of rows) {
    if (row.kind === "comment") {
      blocks.push({ kind: "comment", key: rowKey(row), comment: row.comment });
      continue;
    }
    if (row.kind === "thread") {
      blocks.push({ kind: "thread", key: rowKey(row), thread: row.thread });
      continue;
    }

    const last = blocks.at(-1);
    if (last?.kind === "activity-group") {
      last.activities.push(row.activity);
      continue;
    }
    blocks.push({ kind: "activity-group", key: rowKey(row), activities: [row.activity] });
  }

  return blocks;
}
