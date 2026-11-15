import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { appEventValidator } from "../lib/contracts/appEvents";
import { EVENT_TTL_MS } from "./lib/constants";
import { insertEvents, deleteEventIfExists } from "./lib/eventsRepo";
import { dispatchToHandlers, handlersFor } from "../lib/eventRegistry";

/**
 * Ingest a batch of bus events: persist them, schedule one batched TTL
 * janitor, and dispatch each event to its registered handlers in order.
 * Producers never call this directly — they go through `emitEvents`.
 */
export const ingest = internalMutation({
  args: { events: v.array(appEventValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventIds = await insertEvents(ctx, args.events);
    await ctx.scheduler.runAfter(EVENT_TTL_MS, internal.events.core.cleanup, { eventIds });
    for (let i = 0; i < args.events.length; i++) {
      const event = args.events[i];
      await dispatchToHandlers(ctx, { ...event, eventId: eventIds[i] }, handlersFor(event.type));
    }
    return null;
  },
});

/** Janitor: batched per-ingest TTL delete (same pattern as internal.oauth.core.cleanup). */
export const cleanup = internalMutation({
  args: { eventIds: v.array(v.id("events")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const eventId of args.eventIds) {
      await deleteEventIfExists(ctx, eventId);
    }
    return null;
  },
});
