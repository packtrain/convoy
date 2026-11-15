import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

export async function cancelStreamWatchdog(
  ctx: MutationCtx,
  streamWatchdogId: Id<"_scheduled_functions"> | undefined
): Promise<void> {
  if (!streamWatchdogId) return;

  try {
    await ctx.scheduler.cancel(streamWatchdogId);
  } catch {
    // Ignore scheduler races.
  }
}
