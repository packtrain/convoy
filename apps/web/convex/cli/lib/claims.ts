import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { getThreadClaimLeaseExpiresAt } from "../threads/lib/cliThreadsRepo";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { isContainerThread } from "./watchStatus";

/**
 * A claim without a live lease is no claim: the CLI holding it went quiet.
 * Says nothing about *who* holds it — every caller pairs this with its own
 * `claimedBySessionId` comparison, so an unclaimed thread reads as "expired"
 * only after that check has already rejected it.
 */
export async function isThreadClaimExpired(ctx: QueryCtx | MutationCtx, thread: Doc<"cliThreads">, now: number): Promise<boolean> {
  const expiresAt = await getThreadClaimLeaseExpiresAt(ctx, thread);
  return expiresAt === undefined || expiresAt <= now;
}

/**
 * The gate every CLI mutation writing into a claimed run passes through: the
 * session must still hold the lease, and the thread must not be a container.
 *
 * The container check is defense in depth (OS-1556) — `claimThread` already
 * refuses, so this only fires on a claim that came from somewhere else. Which is
 * why it sits where every run-advancing entry point already has to call.
 */
export async function assertThreadClaimedBySession(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"cliThreads">,
  sessionId: Id<"cliSessions">
): Promise<void> {
  ensure(isContainerThread(thread)).isFalse(errors.CLI_ON_CONTAINER);
  const claimActive = thread.claimedBySessionId === sessionId && !(await isThreadClaimExpired(ctx, thread, Date.now()));
  ensure(claimActive).isTrue(errors.CHAT_NOT_CLAIMED_BY_SESSION);
}
