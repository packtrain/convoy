# Internal Event Bus

Generic in-backend event bus (OS-1123): producers emit typed events, registered
handlers process them. It is the foundation for notifications (OS-1003 epic)
and future consumers such as automations and webhooks. The first registered
consumer is the notifications fan-out (OS-1354, `docs/specs/notifications.md`).

Events are **strictly separate from `taskActivityLogs`**: the activity log is
task-scoped history rendered in the task view; bus events are transient
internal transport with a limited live window. Producers call both,
independently, at the same mutation sites — neither system routes through the
other.

## Overview

- Module: `apps/web/convex/events/` (`core.ts` + `lib/`); the cross-domain emit helpers live in `convex/lib/events.ts`, the handler registry in `convex/lib/eventRegistry.ts`, and the event validators in `convex/lib/contracts/appEvents.ts` (domain `lib/` folders are private cross-domain, and `emitEvents` consults the registry).
- Pipeline: producer mutation → `emitEvents(ctx, events)` →
  `ctx.scheduler.runAfter(0, internal.events.core.ingest)` → insert rows → one
  batched TTL janitor (`internal.events.core.cleanup`) → dispatch each event to
  registered handlers inline.
- Emission is batch-first: loop/bulk producers collect their events and call
  `emitEvents` once per mutation, so every mutation costs exactly one scheduled
  ingest plus one scheduled janitor regardless of event count. Single-event
  sites use the `emitEvent` convenience wrapper.
- The handler registry (`convex/lib/eventRegistry.ts`) is code-level and typed
  per event type. The notifications fan-out (OS-1354,
  `convex/notifications/fanout.ts`, see `docs/specs/notifications.md`) is
  registered for all task and thread event types. Dynamic behavior (e.g. user-defined
  automation rules) belongs inside a registered handler, not in the registry.
- **Emit-time filtering**: `emitEvents` drops events whose type has no
  registered handler, so unconsumed types cost zero scheduled functions and
  zero rows. Corollary: dispatch is the `events` table's only reader; never
  build a consumer that queries the table directly, because rows only exist
  for handled types.

## Data Model

Table `events` (`convex/schema.ts`), defined as the discriminated union
`appEventValidator` (`convex/lib/contracts/appEvents.ts`):

- Common fields: `actorUserId` (`v.optional(v.id("users"))` — unset for
  system/CLI-originated events), `projectId` (`v.optional(v.id("projects"))` —
  always set by current producers), `subject`, `type` (literal) and a
  per-type `payload`. The subject kind is encoded per union member — task
  events carry `{ kind: "task", id: v.id("tasks") }` and thread events
  `{ kind: "thread", id: v.id("cliThreads") }` — so an impossible pairing
  (a thread event with a task subject) fails both compilation and validation.
- Payloads are minimal — ids and status literals only. Handlers load documents
  for anything richer. No denormalized names (events are short-lived, unlike
  the activity log).
- No custom indexes and no `createdAt` field: nothing queries the table yet
  (the janitor deletes by `_id`, `_creationTime` covers debugging). Add an
  index only when a consumer needs a query.
- TTL: `EVENT_TTL_MS` = 7 days (`events/lib/constants.ts`). Each ingest batch
  schedules one janitor run that deletes the batch's rows. The TTL must stay
  well under ~24.8 days — longer delays overflow Node's 32-bit `setTimeout` in
  convex-test and fire immediately.

## Event Types (v1)

| Type | Payload | Producers |
| --- | --- | --- |
| `task.created` | `{}` | `tasks/core.ts` create |
| `task.status_changed` | `{ oldStatus?, newStatus }` | `tasks/core.ts` update, `tasks/core/bulk.ts` update |
| `task.assignee_changed` | `{ oldAssigneeId?, newAssigneeId? }` (raw user ids) | `tasks/core.ts` update, `tasks/core/bulk.ts` update |
| `task.deleted` | `{}` | `tasks/core.ts` remove, `tasks/core/bulk.ts` remove (root tasks only, matching the activity log) |
| `task.archived` | `{}` | `tasks/lib/lifecycle.ts` (one event per archived subtree root) |
| `task.comment_added` | `{ commentId }` | `tasks/comments.ts` `createCommentCore` |
| `thread.completed` | `{ messageId? }` | `cli/messages.ts` `complete` (run ended with no queued input) |
| `thread.waiting_input` | `{ messageId? }` | `cli/messages.ts` `complete` (run ended awaiting input — skipped when a still-pending interaction request already emitted for the same wait), `cli/interactionRequests.ts` `create` (new mid-run approval/question; lease refreshes don't re-emit) |
| `thread.failed` | `{ messageId? }` | `cli/messages.ts` `fail`, `cli/threads/runControl.ts` `failStreamingChat` (claim release, watchdog, session disconnect, thread delete) and `cancelProcessing` — only when the thread lands in `failed` (not requeued as `pending`) |

`messageId` is the run's assistant message (`cliMessages`): the notifications
fan-out reads its tail chunks for the reply excerpt, pinned to the emitting
run rather than "latest by thread" (which could belong to a newer run by
dispatch time). It is absent on wind-down paths with no meaningful message
(browser cancel, watchdog with no active assistant message).

Thread lifecycle events (OS-1243) fire on every transition into a terminal
thread status. Actor semantics: CLI-driven transitions carry **no
`actorUserId`** — the CLI authenticates as the thread owner, and an actor
would self-suppress the only notification recipient. Browser-driven wind-downs
(cancel run, delete thread) set the acting user so consumers can apply
self-action suppression.

Out of scope (add when a consumer needs them): restore/unarchive, priority,
due date, label, list, parent, delegation, name/description edits, attachments,
artifacts.

Adding a type = one union member in `appEventValidator` + one emit call at the
producer.

## Delivery Semantics

- **At-most-once, transactional enqueue**: the ingest is scheduled from the
  producer mutation, so nothing is emitted if the mutation rolls back.
- **Inline dispatch, per-handler error isolation**: handlers run sequentially
  inside the ingest mutation. A throwing handler is caught and logged
  (`console.error` with the handler's stable `name`); remaining handlers still
  run. No retries.
- **Caught handler errors do not roll back that handler's earlier writes**
  (same transaction) — handlers must tolerate partial effects.
- **Workpool seam**: `dispatchToHandlers` (`convex/lib/eventRegistry.ts`) is
  the single place to swap inline execution for durable enqueueing
  (`@convex-dev/workpool`) when push channels need retries. Callers don't
  change.
- **TTL cleanup scaling**: per-batch janitors cost one extra function call per
  emitting mutation. At high event volume, replace them with an hourly cron
  sweep over the built-in `_creationTime` index (tracked as a subtask of
  OS-1123).

## Error Messages

None in v1 — the bus throws no user-facing errors (no `errors.ts` yet; add the
catalog with the first user-facing failure).
