import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { AppEvent } from "./contracts/appEvents";
import { handlersFor } from "./eventRegistry";

/**
 * Fire-and-forget batch emit onto the internal event bus
 * (docs/specs/internal-event-bus.md). Scheduled at commit, so a rolled-back mutation
 * emits nothing. Bulk producers collect and call this once per mutation — one
 * scheduled ingest and one batched janitor regardless of count.
 *
 * ponytail: unchunked — batches are bounded by existing bulk-op limits; slice into
 * fixed-size chunks if they ever reach thousands of events.
 */
export async function emitEvents(ctx: MutationCtx, events: AppEvent[]): Promise<void> {
  // Dispatch is the table's only reader, so event types with no registered
  // handler are dropped here — zero scheduled functions and zero rows until a
  // consumer registers. Don't build anything that queries `events` directly.
  const consumed = events.filter((event) => handlersFor(event.type).length > 0);
  if (consumed.length === 0) {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.events.core.ingest, { events: consumed });
}

/** Convenience wrapper for single-event producer sites. */
export async function emitEvent(ctx: MutationCtx, event: AppEvent): Promise<void> {
  await emitEvents(ctx, [event]);
}
