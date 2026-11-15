import type { Doc, Id } from "../../_generated/dataModel";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { isContainerThread } from "./watchStatus";

/**
 * A claim without a live lease is no claim: the CLI holding it went quiet.
 * Says nothing about *who* holds it — every caller pairs this with its own
 * `claimedBySessionId` comparison, so an unclaimed thread reads as "expired"
 * only after that check has already rejected it.
 */
export function isThreadClaimExpired(thread: Doc<"cliThreads">, now: number): boolean {
  if (!thread.claimLeaseExpiresAt) {
    return true;
  }
  return thread.claimLeaseExpiresAt <= now;
}

/**
 * The gate every CLI mutation writing into a claimed run passes through: the
 * session must still hold the lease, and the thread must not be a container.
 *
 * The container check is defense in depth (OS-1556) — `claimThread` already
 * refuses, so this only fires on a claim that came from somewhere else. Which is
 * why it sits where every run-advancing entry point already has to call.
 */
export function assertThreadClaimedBySession(
  thread: Doc<"cliThreads">,
  sessionId: Id<"cliSessions">
): void {
  ensure(isContainerThread(thread)).isFalse(errors.CLI_ON_CONTAINER);
  const claimActive = thread.claimedBySessionId === sessionId && !isThreadClaimExpired(thread, Date.now());
  ensure(claimActive).isTrue(errors.CHAT_NOT_CLAIMED_BY_SESSION);
}
