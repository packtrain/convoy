# CLI Message Context Specification

This document defines the canonical message-level context shape for CLI continuation/resume metadata.

## Overview

- `cliContext` is optional on `cliMessages`.
- Continuation metadata is stored in a single canonical field:
  - `cliContext.continuationId?: string`
- This field is CLI-agnostic and applies to all CLI types (`claude-code`, `codex`, etc.).

## Data Contract

`cliMessages` schema shape:

```ts
cliContext?: {
  continuationId?: string;
  turnId?: string;
  interruptedContextIncluded?: boolean;
}
```

`cliMessages.complete` and `cliMessages.fail` accept the same shape:

```ts
cliContext?: {
  continuationId?: string;
  turnId?: string;
  interruptedContextIncluded?: boolean;
}
```

`turnId` is the Codex turn the reply is (OS-2073); Claude Code records none.
The Codex runner reports it with the continuation on completion and on
failure, so a stopped turn carries it too. A branch forks the session through
it (`cli-thread-fork.md`).

`cliMessages.appendRunContent` must persist `cliContext.continuationId` as
soon as the first session-bearing assistant chunk is observed. Later assistant
chunks must not overwrite an existing continuation id on the message row.

## Normalization Rule

CLI executors must normalize provider-specific continuation handles into `continuationId` before persisting.

Examples:
- Claude session ID -> `continuationId`
- Codex thread ID -> `continuationId`

## Compatibility Rule

The continuation-field cutover remains hard:
- No dual-read from legacy `claudeSessionId`
- No dual-write aliasing

If old continuation values need to be preserved later, handle via a one-time backfill migration.

Run identity is stored only in `runId?: string`. Unprocessed user messages have
no run id; starting a run stamps its user messages and assistant response with
the same value. Reads use `by_thread_and_runId_and_createdAt` when they need the
members of one run.

The CLI calls `startRunResponse` and `appendRunContent`. No batch-named mutation
aliases exist.

The OS-1568 storage cutover is complete. The widening release backfilled the
canonical field, the cleanup release stopped legacy writes and removed stored
legacy values, and OS-1831 narrowed the schema and removed the compatibility
code.

## Indexing Rule

No continuation index is required by default.

If direct continuation lookup is introduced, use a nested-field index:
- schema index field: `"cliContext.continuationId"`
- query predicate: `q.eq("cliContext.continuationId", value)`

For chat-resume lookup, walk the thread's assistant messages newest-first and
return the first persisted `cliContext.continuationId`, skipping the **stranded
tail** (below). No fallback to chunk metadata is required; if no assistant row
carries a continuation id, the thread is non-resumable.

The CLI reads `cliMessages.getResumeHandleForThread`, which returns
`{ continuationId, forkTurnId? } | null`. `forkTurnId` is set when the session
belongs to another thread and Codex must fork it through that turn instead of
resuming it (OS-2073): the handle is a fork's copied reply (`runId` equals
`forkedFrom.runId`) that carries a `turnId`, or the fork seed with
`forkedFrom.turnId`. `getLatestContinuationForThread` stays for CLIs before
0.84.0 and the local resume command. It returns null when the handle must be
forked, so an old CLI opens a fresh session rather than appending the branch
to the parent's.

## Stranded Tail Rule (OS-1672)

A run's user messages are *stranded* when nothing proves an agent ever
received them, in which case the next claiming CLI re-delivers them. The
assistant walk goes newest-first and stops at the first **settled** turn;
everything above it is stranded. A turn is settled when any of these holds:

| Evidence | Why it settles the run |
|---|---|
| `cliContext.continuationId` persisted | A resumable session exists. This remains the ordinary stranded-work boundary, but does not prove input delivery; stopped input uses the separate history path below. |
| `status === "completed"` | The runtime received the messages and completed the run. A first run can complete with no continuation id (`requireContinuation` is false when resuming was not requested), so completion is independent evidence. |
| `status === "streaming"` | A live run owns its messages before it reports a session id. |

A `failed` turn with no continuation id is normally stranded. User-stopped Claude
and Codex turns are an exception, OS-2046: their prompts are never automatically
requeued as executable work with a later send. The walk skips them while looking for an older
continuation. Explicit Retry still requeues those messages.

Consequences:
- `cliMessages.listUnprocessedUserMessages` returns the stranded tail's user
  messages ahead of the queue. It does so only when the queue is non-empty —
  healing rides along with real work rather than self-claiming the thread.
- `cliMessages.startRunResponse` accepts stranded user message ids, not only
  unstamped ones. It first **un-stamps every stranded run it recovers**, then
  stamps the ids the CLI actually took into the new run (clearing `steeredAt`).
  The CLI consumes only a prefix at runtime-command boundaries, so members it did
  not take must return to the ordinary queue instead of relying on this run
  staying stranded to be offered again.
- `hasUnprocessedUserMessages` — and so `cliThreads.hasPendingUserMessages` and
  thread discovery — stays strict: a stranded run is not pending work.
- The `streaming` boundary is also what keeps `startRunResponse` rejecting a
  stale pending-message snapshot.
- The walk **streams** row-by-row (async iteration) and stops at the boundary, so
  the usual cost is one or two reads regardless of thread length. It gives up
  after `STRANDED_ASSISTANT_SCAN_LIMIT` rows and reports **nothing stranded**,
  logging a warning. Having not found the boundary it cannot distinguish
  delivered work from lost work, and re-running delivered work is the worse
  error — so exhaustion degrades to pre-OS-1672 behavior, never to duplication.
  Reaching the limit takes a long run of continuation-less `failed` turns with no
  successful turn between them; the realistic source is legacy rows predating
  `continuationId` (no backfill was run), not live traffic.
- A continuation ID can precede user-input submission. Stopped input is
  preserved by the interrupted-history path even when this scan calls it settled.
  Non-stop failures still use the existing stranded-work rules.
- A forked thread (`cli-thread-fork.md`) has a seed: when the walk yields no
  continuation, both resume queries fall back to
  `cliThreads.forkedFrom.continuationId`, the parent's turn before the copied
  run. Threads without `forkedFrom` are unaffected.

## Interrupted conversation history (OS-1613)

Stopping execution must preserve user input without restarting cancelled work.
`listUnprocessedUserMessages` accepts optional `includeInterruptedContext`.
Updated Claude/Codex CLIs opt in. With actual deliverable work present, the query
prepends stopped runs' user messages with `contextOnly: true`; default callers
still receive only executable messages. Historical messages retain their original
IDs, run membership, processed stamps, task references, and attachments.

The history scan is independent of continuation lookup. A saved session ID does
not prove that the runtime received the user message. It includes user-stopped
Claude/Codex runs both with and without that ID. The scan uses the assistant index
and reads at most `STRANDED_ASSISTANT_SCAN_LIMIT` rows, returning stopped input
within that window. This bounds legacy recovery on the first upgraded run.

The CLI separates historical messages before selecting work, mode, model, or
runtime-command boundaries. It supplies history only with an ordinary agent
prompt, labels each entry as interrupted prior input, and instructs the runtime
not to execute it or restart its jobs unless the current request asks for that.
A historical runtime command is quoted context, never invoked. Script requests
and runtime commands defer history to the next ordinary prompt. Existing
attachment resolution applies to history, including Claude inline images.

Only successful completion with a returned continuation ID records
`cliContext.interruptedContextIncluded: true`. This is a receipt for the combined
prompt, including an empty history snapshot; session creation alone is not a
receipt. The next history scan stops at that completed resumable assistant.
Failed/stopped runs, commands, scripts, older clients, and runs without a resume
handle do not acknowledge history. Until completion, history may be supplied
again with stable IDs so the runtime can recognize duplicate context. This
conservative behavior avoids falsely claiming exact input delivery on abort.

History never schedules a run, is never passed to `startRunResponse` as work,
and is not re-stamped. Explicit Retry still requeues the original request and
removes it from the context-only set. Stop acknowledgment and held queues are
unchanged. Deploy the backend before CLI 0.81.1; older backends reject the new
query argument. The platform prevents automatic requeueing, but cannot guarantee
that a model will never choose to restart a job based on a new user request.

## QA Checklist

- `cliMessages.complete` persists `cliContext.continuationId`.
- `cliMessages.fail` persists `cliContext.continuationId` when a run observed a
  continuation before failing.
- `cliMessages.appendRunContent` persists `cliContext.continuationId` when the
  first session-bearing assistant chunk arrives.
- `cliMessages.getLatestContinuationForThread` returns the newest persisted
  continuation below the stranded tail, or `null`.
- `cliMessages.getResumeHandleForThread` sets `forkTurnId` only for a fork's
  copied Codex reply or its Codex seed; the fork's own replies resume plainly.
- `cliMessages.listUnprocessedUserMessages` prepends stranded user messages when
  the queue is non-empty, and returns only the queue when it is not.
- Message completion and chat status transitions are unchanged.
- No active code paths depend on `cliContext.claudeSessionId`.
- Retry, edit-last, cancellation, stranded-run recovery, timeline, and steering
  use `runId` as their only run-membership key.
