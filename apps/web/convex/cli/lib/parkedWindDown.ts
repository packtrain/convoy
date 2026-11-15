import type { Doc } from "../../_generated/dataModel";

/**
 * The "was parked" signal every run wind-down shares (OS-1463): a run waiting on
 * an approval/question was the user's turn, so ending there is not a failure.
 * Queued user messages take precedence — that turn really was interrupted.
 */
export function isParkedWindDown(
  cancelledPendingInteractions: number,
  hasUnprocessedUserMessages: boolean
): boolean {
  return cancelledPendingInteractions > 0 && !hasUnprocessedUserMessages;
}

/**
 * Thread-status decision for wind-downs that lose a run without the user asking
 * (OS-1463): parked parks as `waiting_input` instead of `failed`, queued messages
 * requeue as `pending`. Parked emits no lifecycle event — the interaction
 * request's creation already emitted `thread.waiting_input`.
 *
 * `cancelProcessing` uses the *signal* but not this mapping: a stop holds its
 * queue (OS-1374) and its outcome depends on whether the user is taking the turn
 * over or handing it back.
 */
export function resolveRunWindDown(
  cancelledPendingInteractions: number,
  hasUnprocessedUserMessages: boolean
): {
  parked: boolean;
  threadStatus: Extract<Doc<"cliThreads">["status"], "pending" | "waiting_input" | "failed">;
  emitFailedEvent: boolean;
} {
  const parked = isParkedWindDown(cancelledPendingInteractions, hasUnprocessedUserMessages);
  return {
    parked,
    threadStatus: hasUnprocessedUserMessages ? "pending" : parked ? "waiting_input" : "failed",
    emitFailedEvent: !hasUnprocessedUserMessages && !parked,
  };
}
