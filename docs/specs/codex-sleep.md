# Codex sleep event UX

Task: OS-1922. Implemented after playground review.

## Scope

Codex app-server sleep items normalize to a provider-neutral `sleep` event and
render in assistant threads. The local-state prototype at
`/playground/codex-sleep` shares the production row and remains linked from the
playground index.

## Thread behavior

- A sleep appears as one compact, muted timeline row with a moon icon and the
  label `Sleeping`. Requested duration is secondary text.
- When a start timestamp is known, show an estimated countdown. Keep its width
  stable and do not announce every tick to screen readers.
- At zero, show `Waiting to resume`. Only a completion event settles the row.
  A timer does not prove that the agent has resumed.
- Completion updates the same row to `Slept`. Show actual elapsed duration only
  when matched start and completion timestamps exist. Otherwise show
  `Sleep completed` with the requested duration as secondary text.
- A confirmed turn interruption settles the row to `Sleep interrupted`, using
  neutral styling. It does not imply a sleep failure.
- An unfinished sleep in a failed assistant message also reads `Sleep interrupted`.
  In a completed assistant message without a matching sleep completion, it reads
  `Sleep ended`, with `Completion not recorded` in the timing disclosure. Both
  stop the local timer without claiming successful sleep completion.
- Durationless events remain readable as `Sleeping` or `Sleep completed`.
- Keep event IDs and payloads out of the default row. A disclosure shows the
  timing details. Sleep does not create an approval request or a wake-up button.
- The row is the shared tool row (`CollapsibleToolPart`), so its chevron and
  disclosure match the other tool rows (`cli-thread-tool-parts.md`). An
  interrupted sleep's timing disclosure reads `Run interrupted`.

## Prototype controls

The initial preview is frozen at 18 seconds remaining on a 30-second sleep so
reviewers can inspect it. State buttons select sleeping, completed, interrupted,
or overdue. Replay starts a real 30-second local countdown. Simulated completion
and interruption stop the timer. A static gallery includes long duration,
missing start, missing duration, and interrupted examples. Disclosures
support keyboard inspection. All controls affect only this preview.

## Event contract and pairing

The shared normalized event validator stores `kind: sleep`, `phase: started`
or `completed`, optional `itemId`, `turnId`, and `sessionId`, plus optional
`durationMs`, `startedAt`, and `completedAt`. The normalizer reads duration from
the item and phase timestamps from the payload's `startedAtMs` or
`completedAtMs`. Only nonnegative safe integer milliseconds are accepted;
invalid timing is omitted. Zero is valid. The CLI already forwards these
notifications unchanged.

Within an assistant message, matching nonempty item IDs and equal turn/session
IDs update one row in place. Unidentified events stay separate. Repeated events
do not add rows, and late starts fill missing timing without reopening a settled
sleep. A completion-only event stays completed with no invented start time.
The composer creates new part objects so incremental snapshots remain immutable.

The countdown uses the start timestamp and current wall clock. Requested duration
is rounded up to seconds for display; actual elapsed duration is rounded down.
Elapsed duration requires an ordered pair of timestamps. Chunk receipt time is
not a substitute for a missing event timestamp. Timers update once per second
and stop on settlement or unmount.

An explicit interrupted `turn/completed` marks pending sleeps with matching
turn/session identity as interrupted. The assistant message's terminal status
provides the fallback for disconnected, stopped, or failed runs with missing
terminal events.

Sleep events are durable chunks. Existing unknown events are re-normalized by
the read path, so historical unsupported sleep rows gain the same rendering
without a data migration. Reconnect snapshots rebuild from these stored events.

The ticket contains a 30,000 ms `item/started` and a 20,000 ms `item/completed`.
Their item IDs differ. Treat them as independent examples; do not derive elapsed
time from them. Requested duration alone is not actual elapsed time.

## Validation

Regression tests cover normalization and historical reads, item/turn/session
pairing, repeated and out-of-order events, missing timing, explicit interruption,
terminal assistant messages, countdown expiry, and timer cleanup. Run the full
web suite, lint, and TypeScript checks. Review the playground at desktop and
mobile widths in the existing app server when available.
