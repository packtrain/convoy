# CLI Thread Cancel/Stop Processing Specification

This document defines how user-initiated stop/cancel works for CLI threads.

## Overview

- A thread can be cancelled while:
  - waiting in `pending` (no assistant stream yet), or
  - actively `streaming`.
- Cancellation is represented with existing `failed` statuses and an explicit error reason:
  - `Response stopped by user`
- No new `cancelled` enum/state is introduced.
- Messages queued **behind an active run** are not cancelled (OS-1374): they
  survive the stop in a **held queue** (`cliThreads.queueHeldAt`) and resume
  with the user's next send. See
  `docs/specs/cli-thread-edit-last-message.md` for the full held-queue
  lifecycle.
- A stop with **no active run** (thread waiting for CLI pickup) is different
  (OS-1459): the pending messages are the *sent* run, not a queue — they
  are stamped into a run behind a synthetic failed assistant
  ("Response stopped by user") so the turn reads as sent + stopped and stays
  retryable. No hold is created.

## User Interaction Rules

- In thread detail composer:
  - when thread processing is active and textarea is empty, submit control becomes `Stop`.
  - when user types any text, the control switches back to normal `Submit`.
  - submitting while processing queues the message as usual — except while an
    interaction request is pending, where submitting stops the run and sends
    right away (see `docs/specs/cli-interactive-approvals.md`).
- After a stop, tool calls that were still running stop spinning and render as
  interrupted (see `docs/specs/cli-thread-tool-parts.md`).
- `Esc` anywhere in the composer stops the run while `Stop` is offered and
  enabled. A menu that handles `Esc` first, such as the suggestion list, keeps
  it (OS-2256).
- The submit control's tooltip names its keys: `Send Enter` and
  `New line Shift+Enter`, or `Stop Esc` while it is the Stop control. It
  opens only after a 2-second hover, so moving to click Send doesn't flash it
  (OS-2384).

## Waiting and offline states (OS-2256)

- The composer's default placeholder is `Describe a task or ask a question`,
  for new threads and follow-ups. A caller can pass its own.
- A reply that is streaming but has no output yet shows a `Working` spinner,
  as does the assistant message footer while it streams.
- While the thread's CLI profile is loaded and offline, a banner above the
  composer reads `CLI offline. Messages will queue until it reconnects.`, and
  the pending reply reads `Queued until the CLI reconnects` instead of
  `Waiting for <CLI>...`. A profile that is still loading shows neither.

## Backend Cancellation Rules

Public mutation: `cliThreads.cancelProcessing({ threadId, superseded? })`

Behavior (a list of rules, not an execution order — the implementation cancels
pending interaction requests first, because their count decides rules 4, 7 and
10):
1. Verify thread ownership + project permission.
2. Cancel active stream watchdog. `streamWatchdogId` only ever holds a run's
   **first** tick: later ticks reschedule themselves without restamping the
   thread (a healthy tick writes nothing, so it cannot force OCC retries of
   `appendRunContent`, which reads the thread doc on every chunk batch).
   A chain that outlived its run is stopped by the tick's own check that the
   thread's `activeAssistantMessageId` still matches the run it was scheduled
   for — so cancellation is best-effort and a stale tick may fire once (≤ one
   watchdog interval) before dying without side effects.
3. Pending interaction requests for the thread are cancelled
   ("response stopped by user") — the run that would answer them is gone. The
   cancelled count is also the "was parked" signal (see rule 10).
4. If an active assistant run exists:
   - mark that assistant message `failed` with `Response stopped by user`
     (`completed` with no error when the turn ends as finished — rules 9 and 10)
   - clear assistant claim fields; keep its original `runId` (a run-less
     legacy assistant gets a fresh one)
5. Unprocessed user messages:
   - **active run stopped** → they stay queued and unprocessed; only stale
     `steerRequestedAt` markers are cleared (there is no run left to steer
     into; see `docs/specs/cli-steering.md`); no cancellation run
   - **no active run** (OS-1459) → they are the sent run: stamped
     `processedAt` under one fresh `runId` and a synthetic **failed**
     assistant message ("Response stopped by user") is inserted for that
     run
   - the stopped run's own messages remain stamped. Claude and Codex user-stopped
     runs are excluded from automatic stranded-tail recovery, even without a
     continuation ID. Explicit Retry can requeue them. See `docs/specs/cli-message-context.md`.
6. Clear chat claim/streaming fields:
   - `claimedBySessionId`, `claimedAt`, `claimLeaseExpiresAt`
   - `activeAssistantMessageId`, `streamWatchdogId`
   - `processingState = "idle"`
7. Queue/state outcome — `status = "failed"` unless the turn ends as finished
   (rules 9 and 10):
   - active run stopped with unprocessed messages behind it →
     `hasPendingUserMessages = true` and `queueHeldAt = now` (held:
     excluded from `listPendingThreads`, `claimThread` refuses; cleared by
     the next send, retry, "Send now", or the queue emptying via deletes)
   - otherwise → `hasPendingUserMessages = false`, no hold
8. Idempotency: a second `cancelProcessing` on an already-held thread with no
   active assistant is a no-op — it must not recompute a `failed` thread back
   to `pending` or re-stamp the hold. A second stop after a **parked** stop
   (rule 10) is a no-op too, through the other guard: that thread is idle with
   no active assistant and nothing unprocessed, so it keeps `waiting_input`
   rather than being recomputed into a failure.
9. `superseded: true` (OS-1461) means the user took the turn over rather than
   stopping it — sending a message while parked on a prompt (which is also how
   "keep planning" works, so it has no button). Everything above still happens (claim released, watchdog cancelled,
   pending interaction requests cancelled), except the ended turn reads as
   finished instead of errored: the active assistant message becomes
   `completed` with no `errorMessage`, the thread status becomes `completed`,
   and no `thread.failed` event is emitted (the replacing turn emits its own).
   So no "Response stopped by user" footer and no Continue/Retry appear.
10. **Stopping a run parked on a prompt is not a failure** (OS-1463). A run
    waiting on an approval/question is the user's turn, not work in flight, and
    Stop is how the user takes that turn back — it is the only control the
    composer offers while it is empty. So when the stop cancels at least one
    pending interaction request and nothing is queued behind it, the turn ends
    as finished like `superseded`, except the thread
    lands in `waiting_input` rather than `completed`: the user stopped in order
    to type, and that is the bucket the thread already had while the prompt was
    open, so the row and its container do not change colour on Stop. The
    assistant message becomes `completed` with no `errorMessage` and no
    `thread.failed` event is emitted (the request's creation already notified
    the owner). The parked signal is `isParkedWindDown`, shared with
    `failStreamingChat` and `messages.fail`; only the signal is shared, not
    their status mapping (a stop holds its queue instead of requeueing it).
    Queued messages behind the stop keep the ordinary stopped-run outcome
    (`failed` + held queue): that turn really was interrupted and stays
    retryable. A workflow run's lane thread (`workflowRunId` set) never
    parks — its Stop is the ordinary `failed` outcome, so the run Step fails
    and stays recoverable (workflows.md → Step / run lifecycle).

Held threads are **not running** anywhere in the UI: `deriveThreadWatchStatus`
buckets a held pending thread as `waiting_input` (not `running`), the thread
list's running indicator ignores held threads, and the task `agentThreadWork`
summary mirrors the same rule.

## Releasing a held queue

Public mutation: `cliThreads.releaseQueueHold({ threadId })`

- While the queue is held, the held messages fill the queued strip and the
  first row offers **Send now** in Steer's slot (OS-2171):
  releasing clears `queueHeldAt`, flips the thread to `pending`, and makes it
  claimable again — the held messages run as-is without composing a new
  message.
- Idempotent when nothing is held; a stale hold with no messages behind it is
  self-corrected (hold cleared, `hasPendingUserMessages` recomputed).

## Retry Compatibility Rules

- The stopped turn remains retryable using existing `cliMessages.retry` on
  its failed assistant message; retry also clears the queue hold, so held
  messages ride along in the requeued run.
- Legacy threads with pre-OS-1374 cancellation runs keep working through
  the same retry path (no migration).

## CLI Runtime Race Handling

- CLI message handler must tolerate stale start snapshots:
  - if `startRunResponse` fails because user messages are no longer pending, skip and continue loop.
- CLI must detect lost claim during execution via `cliThreads.isClaimActiveForSession`,
  **subscribed for the duration of the run, not polled** (OS-1719). A 3s poll's
  read cost scaled with run duration (a 20-minute run re-read the thread, its
  session and its profile 400×) and reacted up to one interval late. The
  error-path one-shot checks (stale run start, post-run) stay as queries.
  This query only checks authentication, session ownership, thread ownership,
  and active claim state; project permission is enforced by work discovery,
  claim, run start, and terminal message mutations rather than high-frequency
  lifecycle watches/appends.
- On claim loss, CLI aborts the local subprocess runner immediately.

## Thread Deletion Rules

Public mutation: `cliThreads.remove({ threadId })`

Behavior:
1. Verify thread ownership + project permission.
2. If the thread is actively streaming:
   - cancel the active stream watchdog
   - mark the active assistant message `failed` with `CLI thread deleted during response generation`
   - clear assistant claim fields
   - clear thread claim/streaming fields:
     - `claimedBySessionId`, `claimedAt`, `claimLeaseExpiresAt`
     - `activeAssistantMessageId`, `streamWatchdogId`
     - `processingState = "idle"`
3. If the thread is claimed but not actively streaming:
   - cancel any active stream watchdog
   - clear thread claim/streaming fields
4. Soft-delete the thread by setting `isDeleted` and `deletedAt`.
5. Deleting an idle thread remains a plain soft-delete.

CLI workers observe a deleted thread as claim loss through `cliThreads.isClaimActiveForSession`, which returns `false` for deleted threads.

## Acceptance Checklist

- Stop works while thread is pending (no assistant stream yet): the sent
  run fails in place — user messages stay in the conversation as sent, a
  "Response stopped by user" turn with Retry follows, no held queue
  (OS-1459).
- Stop works while assistant is streaming.
- Claim race (picked up but cancelled before status/chunks) does not continue streaming output.
- Typing follow-up text while processing restores submit behavior and queues message.
- Retry remains available for user-stopped runs.
- Messages queued behind a stopped run survive in a held queue: they stay
  in the queued strip with Edit and Delete, the first row offers "Send now"
  (OS-2171), and the CLI does not pick them up until the next send (or
  "Send now").
- A held thread never shows as running (thread list, Watch Tower, task
  summaries).
- Stopping an already-stopped held thread changes nothing.
- Stopping a run parked on a plan approval (or any prompt) with an empty queue
  leaves the thread `waiting_input` with no error footer: the row stays amber
  and a thread container holding it does not turn red.

## Service-selected cancellation, OS-1994

`cancelProcessing` also accepts API-key authentication and an optional
`expectedRunId`. API-key callers must supply it. Authorization preserves ownership
and uses the principal including key scope for CLI_THREAD permission. When a run
ID is supplied, the mutation checks the active assistant's run ID and streaming
status in the same transaction before stopping it. A stale selection returns
`Selected run is no longer active`; an API-key call without selection returns
`Select a run ID before cancelling from the service`. Existing browser calls keep
their current whole-thread stop behavior.


## Runtime shutdown confirmation, OS-2046

For Claude and Codex, Stop still cancels the run and releases its claim
immediately. The composer separately shows "Stopping…" until the CLI confirms
runtime shutdown. Last-known job descriptions stay available in that indicator,
labelled as last-known rather than running or confirmed stopped.

`metadata.stopConfirmation` holds one bounded record: run ID, assistant message
ID, claiming session ID when present, request time, confirmation status, optional
acknowledgment time, and the last valid jobs snapshot for that assistant. A new
Stop replaces this record. Repeated Stop while idle preserves it. A superseding
send does not create a new stop record. Stops before an assistant exists use the
existing pending-run cancellation behavior; no runtime has started to acknowledge.

A scheduled mutation changes `stopping` to `unconfirmed` after 15 seconds, guarded
by run ID and request time. The composer then shows "Couldn't confirm stopped"
and explains that the CLI may be disconnected. Old CLIs that cannot acknowledge
also reach this state. Matching late acknowledgments change it to `stopped`.
The composer shows only one jobs/stop pill. Current live jobs take precedence
over a previous stop notice. "Runtime stopped" disappears five seconds after
`acknowledgedAt`, including when the thread is reopened. Stopping and unconfirmed
notices do not auto-dismiss. The stored record remains available and never changes
the new turn's claim, status, or snapshot.

The CLI watches the claim with its assistant message ID as well as session ID.
After claim loss, it aborts, closes the execution iterator, and waits for runtime
shutdown before calling `acknowledgeStop`. Both runtime adapters wait for their
spawned process's exit, including when generator cleanup has already cleared the
active process reference. Failed shutdown or failed acknowledgment leaves the
record unconfirmed. Authentication checks thread ownership, project permission,
and session ownership; acknowledgment must match the stored run, assistant, and
session. Stale acknowledgments and timeout callbacks cannot settle a later Stop.

"Runtime stopped" confirms the provider runtime process exited. It does not
promise that every detached process or remote job terminated. The details say
"Detached processes and remote jobs may still be running." Completed output and
file changes remain intact. Existing held-queue rules remain unchanged; Stop does
not enqueue a job restart. User-stopped Claude and Codex prompts are excluded
from executable stranded-tail re-delivery. Updated CLIs supply their text as
interrupted history instead, without requeueing cancelled work. Explicit Retry
remains available.
Persistent jobs, individual job controls, and guaranteed detached or remote work
cancellation remain outside this feature.

Regression coverage includes both providers, repeated Stop, retained snapshots,
timeouts, a disconnected CLI, wrong-session acknowledgments, late acknowledgment
during a newer run, process-exit waits, and composer feedback with and without jobs.

## Context after Stop (OS-1613)

The next ordinary Claude/Codex turn carries stopped user messages as interrupted
history until a successful resumable turn acknowledges that history. This does
not requeue the stopped request or restart its jobs. Runtime commands and script
runs defer history. See `cli-message-context.md` for delivery and checkpoint rules.
