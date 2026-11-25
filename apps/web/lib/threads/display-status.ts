import type { ThreadStatus } from "@/lib/threads/types";

export interface ThreadDisplayStatusInput {
  status: ThreadStatus;
  hasPendingInteraction?: boolean;
  requiresAttention: boolean;
  /** The watched PR's checks still run: a settled thread shows as working (docs/specs/pull-request-watch.md). */
  // Required, so a payload that leaves it out fails to compile instead of showing a settled thread.
  pullRequestChecksRunning: boolean;
}

/**
 * Deliberately narrower than `deriveThreadWatchStatus`: that one also treats a held
 * queue (`queueHeldAt`, OS-1374) as waiting on the user. Not an oversight — a hold only
 * ever arrives alongside a terminal status, so the branch below could never see it.
 *
 * If a future path holds the queue while leaving `streaming`/`pending` in place, this
 * would show a spinner on a thread waiting for the user, and `queueHeldAt` has to be
 * folded in here (and shipped on `getGroup`'s child payload).
 */
export function getThreadDisplayStatus({
  status,
  hasPendingInteraction,
  requiresAttention,
  pullRequestChecksRunning,
}: ThreadDisplayStatusInput): ThreadStatus {
  // A run parked on an approval/question is the user's turn, not "running";
  // this mirrors deriveThreadWatchStatus in the Convex watch-status helper.
  if (
    (status === "streaming" || status === "pending") &&
    hasPendingInteraction
  ) {
    return "waiting_input";
  }

  if (
    (status === "failed" || status === "waiting_input") &&
    !requiresAttention
  ) {
    return pullRequestChecksRunning ? "streaming" : "completed";
  }

  return status === "completed" && pullRequestChecksRunning ? "streaming" : status;
}
