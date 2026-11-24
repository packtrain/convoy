import type { Doc } from "../../_generated/dataModel";
import type { CliThreadAggregateStatus, CliThreadWatchStatus } from "../../lib/contracts/validators";

/**
 * The Watch Tower bucket rule (OS-1259) — single source of truth for the
 * denormalized `cliThreads.statusProjection` fields and the read/attention display
 * semantics (docs/specs/cli-thread-read-state.md).
 *
 * `statusProjection` is never written directly: cliThreadsRepo recomputes the whole
 * object on every write touching an input field.
 */

type WatchStatusInputs = Pick<
  Doc<"cliThreads">,
  | "status"
  | "readAt"
  | "attentionAcknowledgedAt"
  | "doneAt"
  | "isMarkedDone"
  | "lastActivityAt"
  | "hasPendingInteraction"
  | "queueHeldAt"
  | "kind"
  | "childCount"
  | "childWatchStatus"
>;

/** Absent `kind` = plain chat thread; set = group/workflowRun container (OS-1364). */
export function isContainerThread(thread: Pick<Doc<"cliThreads">, "kind">): boolean {
  return thread.kind !== undefined;
}

/**
 * The branch a thread's row displays (OS-1247), most specific first: the
 * execution-time snapshot (the checkout the last run actually used), the live
 * profile-path branch, then the worktree branch. Shared by the list read path and
 * the `originBranch` denorm so the write seam can't drift from the read path.
 */
export function threadExecutionBranch(
  thread: Pick<Doc<"cliThreads">, "git">,
  livePathBranch?: string
): string | undefined {
  return thread.git?.executionBranch ?? livePathBranch ?? thread.git?.worktree?.branch;
}

/**
 * The task a thread's card and detail show: a container's is its origin's
 * (`originTaskId`, OS-1557), a real thread's its own `associatedTaskId`.
 */
export function threadDisplayTaskId(thread: Pick<Doc<"cliThreads">, "originTaskId" | "associatedTaskId">) {
  return thread.originTaskId ?? thread.associatedTaskId;
}

export function hasThreadAttentionStatus(status: Doc<"cliThreads">["status"]): boolean {
  return status === "failed" || status === "waiting_input";
}

/** Failed/waiting threads demand attention until acknowledged after their latest activity. */
export function requiresThreadAttention(
  thread: Pick<Doc<"cliThreads">, "status" | "lastActivityAt" | "attentionAcknowledgedAt">
): boolean {
  if (!hasThreadAttentionStatus(thread.status)) {
    return false;
  }

  return thread.attentionAcknowledgedAt === undefined || thread.attentionAcknowledgedAt < thread.lastActivityAt;
}

/**
 * Whether a mark-read/done should acknowledge the attention state: the row's
 * own, or — for containers — any child's, via the `hasAttentionChildren`
 * denorm (OS-1475). A container's own status is terminal from birth and never
 * demands attention itself.
 */
export function threadNeedsAttentionAck(
  thread: Pick<Doc<"cliThreads">, "status" | "lastActivityAt" | "attentionAcknowledgedAt" | "kind" | "hasAttentionChildren">
): boolean {
  return requiresThreadAttention(thread) || (isContainerThread(thread) && (thread.hasAttentionChildren ?? false));
}

/** A thread is unread until it was read after its latest activity. */
export function hasUnreadThreadActivity(thread: Pick<Doc<"cliThreads">, "readAt" | "lastActivityAt">): boolean {
  return !thread.readAt || thread.readAt < thread.lastActivityAt;
}

/**
 * Whether a mark-read would change anything: unread activity (child-aggregated
 * for containers, OS-1475) or an attention state to acknowledge. Shared by the
 * `markRead` mutation's OCC guard and the cascade's settled-child skip so the
 * two rules can't drift apart.
 */
export function threadNeedsReadPatch(
  thread: Pick<Doc<"cliThreads">, "readAt" | "lastActivityAt" | "kind" | "hasUnreadChildren">,
  acknowledgeAttention: boolean
): boolean {
  const hasUnread = isContainerThread(thread) ? (thread.hasUnreadChildren ?? false) : hasUnreadThreadActivity(thread);
  return hasUnread || acknowledgeAttention;
}

/**
 * A thread is done only when explicitly marked done (OS-1382); reading it does
 * not count. The mark is sticky (OS-2176); a legacy mark without
 * `isMarkedDone` still expires on newer activity.
 */
export function isThreadDone(thread: Pick<Doc<"cliThreads">, "doneAt" | "isMarkedDone" | "lastActivityAt">): boolean {
  return thread.isMarkedDone === true || (thread.doneAt !== undefined && thread.doneAt >= thread.lastActivityAt);
}

/**
 * Bucket a thread for the Watch Tower dashboard. Mirrors the thread list's
 * display rule: failed/waiting threads whose attention was acknowledged fall
 * to the finished buckets, so both surfaces agree on what still needs the user.
 */
export function deriveThreadWatchStatus(thread: WatchStatusInputs): CliThreadWatchStatus {
  if (isContainerThread(thread) && thread.childWatchStatus !== undefined) {
    return thread.childCount === 0 && isThreadDone(thread) ? "done" : thread.childWatchStatus;
  }
  if (thread.status === "streaming" || thread.status === "pending") {
    // A run parked on a pending approval/question is the user's turn, not
    // "running" — clears when the request is answered/cancelled. Same for a
    // held queue (Stop kept the messages, OS-1374): nothing runs until the
    // user's next send, so the thread waits on them.
    return thread.hasPendingInteraction || thread.queueHeldAt !== undefined ? "waiting_input" : "running";
  }
  if (requiresThreadAttention(thread)) {
    return thread.status === "failed" ? "failed" : "waiting_input";
  }
  // Read state deliberately doesn't move a finished thread out of
  // needs_review — only the explicit done mark does (OS-1382).
  return isThreadDone(thread) ? "done" : "needs_review";
}

/**
 * The whole derived projection (OS-1451). `isDone` is stored separately from
 * the bucket because a running thread can also be "not done": the bucket
 * collapses done-ness with attention state, the thread list's Done section
 * needs it on its own, indexed.
 */
export function deriveThreadStatusProjection(thread: WatchStatusInputs): NonNullable<Doc<"cliThreads">["statusProjection"]> {
  return {
    watchTowerStatus: deriveThreadWatchStatus(thread),
    isDone: isThreadDone(thread),
  };
}

/**
 * Container `aggregateStatus` (OS-1364, OS-1473): derived from the children's
 * already-derived watch buckets rather than raw status, so the group row
 * agrees with per-thread display semantics — an acknowledged failure counts
 * as settled here exactly like it does on the child's own row.
 */
export function deriveContainerAggregateStatus(
  children: Pick<Doc<"cliThreads">, "statusProjection">[]
): CliThreadAggregateStatus {
  const buckets = children.map((child) => child.statusProjection?.watchTowerStatus);
  // Failed outranks waiting: one label per row, and a failure is the loudest
  // state — the waiting child's ask surfaces once the failure is acknowledged.
  if (buckets.some((bucket) => bucket === "failed")) {
    return "failed";
  }
  if (buckets.some((bucket) => bucket === "waiting_input")) {
    return "needs_attention";
  }
  return buckets.some((bucket) => bucket === "running") ? "running" : "idle";
}

/** Mixed-child precedence for Watch Tower. Spec: docs/specs/watch-tower.md. */
export const WATCH_STATUS_RANK: Record<CliThreadWatchStatus, number> = {
  done: 0,
  needs_review: 1,
  running: 2,
  waiting_input: 3,
  failed: 4,
};

/** Empty containers need review; nonempty containers use their loudest child. */
export function deriveContainerWatchStatus(children: WatchStatusInputs[]): CliThreadWatchStatus {
  return children.reduce<CliThreadWatchStatus>((bucket, child) => {
    const candidate = deriveThreadWatchStatus(child);
    return WATCH_STATUS_RANK[candidate] > WATCH_STATUS_RANK[bucket] ? candidate : bucket;
  }, children.length === 0 ? "needs_review" : "done");
}
