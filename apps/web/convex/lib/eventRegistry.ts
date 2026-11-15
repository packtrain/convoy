import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AppEventOf, AppEventType } from "./contracts/appEvents";
import { notificationsFanout } from "../notifications/fanout";

/**
 * An ingested event as seen by handlers: the emitted event plus its row id.
 * Mapped over T so the result is a plain union (not a union-in-intersection),
 * which lets handlers narrow on nested discriminants like `subject.kind`.
 */
export type DispatchedEvent<T extends AppEventType = AppEventType> = {
  [K in T]: AppEventOf<K> & { eventId: Id<"events"> };
}[T];

export type EventHandler<T extends AppEventType = AppEventType> = {
  /** Stable name used in failure logs. */
  name: string;
  // Method syntax on purpose: its bivariant param check lets a handler typed
  // over the full event union register under a single-type key (the arrow
  // form rejects that — TS can't see that keys correlate with event types).
  handle(ctx: MutationCtx, event: DispatchedEvent<T>): Promise<void>;
};

/**
 * Code-level handler registrations. Registering a type here also wakes the
 * bus for it — `emitEvents` drops event types with no handlers. Dynamic
 * behavior (e.g. user-defined automation rules) belongs inside a handler,
 * not in this map.
 */
// Values are typed as broad `EventHandler` (bivariant `handle` accepts both
// union-typed and per-type handlers); `handlersFor` narrows per key.
const registry: { readonly [T in AppEventType]?: readonly EventHandler[] } = {
  "task.created": [notificationsFanout],
  "task.status_changed": [notificationsFanout],
  "task.assignee_changed": [notificationsFanout],
  "task.deleted": [notificationsFanout],
  "task.archived": [notificationsFanout],
  "task.comment_added": [notificationsFanout],
  "thread.completed": [notificationsFanout],
  "thread.failed": [notificationsFanout],
  "thread.waiting_input": [notificationsFanout],
};

export function handlersFor<T extends AppEventType>(type: T): readonly EventHandler<T>[] {
  // Sound by construction: the registry key guarantees the handler matches the
  // event type. TS can't prove that key↔handler correlation, so this is the
  // module's one cast.
  return (registry[type] ?? []) as unknown as readonly EventHandler<T>[];
}

/**
 * Dispatch seam: runs handlers inline, isolating failures. A caught handler
 * error does NOT roll back that handler's earlier writes (same transaction).
 * ponytail: no retries — a future Workpool integration replaces this body with
 * enqueueing when push channels need durable delivery; callers don't change.
 */
export async function dispatchToHandlers(
  ctx: MutationCtx,
  event: DispatchedEvent,
  handlers: readonly EventHandler[]
): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler.handle(ctx, event);
    } catch (error) {
      console.error(`[events] handler "${handler.name}" failed for ${event.type} (${event.eventId})`, error);
    }
  }
}
