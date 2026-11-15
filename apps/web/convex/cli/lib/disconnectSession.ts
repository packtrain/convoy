import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { deleteSession } from "./cliSessionsRepo";

/**
 * Tear down a single CLI session: reconcile any thread claims it held (so stale
 * claims/streams are released with the given user-facing `reason`), then delete
 * the session row. This is the one canonical "disconnect a session" path —
 * registration force-replace, clean disconnect, and profile cleanup all use it.
 */
export async function disconnectSession(
  ctx: MutationCtx,
  sessionId: Id<"cliSessions">,
  reason: string
): Promise<void> {
  await ctx.runMutation(
    internal.cli.threads.runControl.reconcileClaimsForSessionDisconnect,
    { sessionId, reason }
  );
  await deleteSession(ctx, sessionId);
}
