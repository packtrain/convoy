/**
 * Live window for bus events. Events are transient plumbing, not history
 * (`taskActivityLogs` is history); the batched janitor deletes each ingested
 * batch after this delay. Keep well under ~24.8 days: longer delays overflow
 * Node's 32-bit setTimeout in convex-test and fire immediately (see
 * oauth/lib/constants.ts for the same constraint).
 */
export const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
