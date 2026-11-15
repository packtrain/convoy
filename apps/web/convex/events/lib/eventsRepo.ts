import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { AppEvent } from "../../lib/contracts/appEvents";

export async function insertEvents(ctx: MutationCtx, events: AppEvent[]): Promise<Id<"events">[]> {
  const eventIds: Id<"events">[] = [];
  for (const event of events) {
    eventIds.push(await ctx.db.insert("events", event));
  }
  return eventIds;
}

/** Janitor: delete if present (rows may already be gone after manual cleanup). */
export async function deleteEventIfExists(ctx: MutationCtx, eventId: Id<"events">): Promise<void> {
  const event = await ctx.db.get("events", eventId);
  if (event) {
    await ctx.db.delete("events", eventId);
  }
}
