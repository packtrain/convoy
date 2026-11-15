# CLI Thread Edit Last Message Specification

Editing the last user message in a thread (OS-1374): **edit in place and
resend**. The bubble turns into the shared thread composer with Cancel and Send;
sending discards the message's own response (when its turn already ran),
replaces its content and composer settings, and reruns the queue. The message
keeps its identity and position. Editing never interrupts a run: while
a response is in flight the user must explicitly **Stop** it first.

Related specs: `cli-thread-cancel-processing.md` (the held queue Stop leaves
behind), `cli-steering.md` (queued-message Edit/Delete in the strip),
`cli-thread-failed-message-actions.md` (Retry/Continue on the failed turn).

## User-visible behavior

- The **newest user message** shows an always-visible **Edit** (pencil)
  action in the metadata row under its bubble (next to the
  runtime/timestamp footer) — but only while **no response is in flight**:
  idle, failed, completed, or held threads. While a run is streaming or
  queued for pickup the pencil is hidden; the user must Stop the response
  first (Stop parks the queue held, the thread goes idle, and the pencil
  appears). Only that message is editable — no history rewriting.
  Attachment-only and task-only messages can be edited. Interactive
  question-response bubbles do not offer it.
- Clicking Edit swaps the bubble for `EditLastMessage`, which hosts the shared
  `ThreadComposer`. It restores text, command and skill pills, task, attachments,
  mode, model, and effort. Commands, skills, file mentions, and attachments use
  the same controls as a follow-up message. Runtime, workspace, and agent stay
  bound to the thread. The edit form hides the top context bar because those
  values cannot change here; model, mode, and effort remain in the footer
  as selectors. On mobile (`useIsMobile`) they are icon-only, so Cancel and
  Send fit a phone-width bubble (OS-2151). The labels stay in each trigger's title and accessible name.
  Existing command links resolve against the current
  catalog; deleted or unavailable references remain plain text.
- The editor owns its draft and upload queue. It never overwrites the follow-up
  composer's draft. Cancel or Escape restores the bubble; Escape first dismisses
  an open suggestion menu. Send accepts text, attachments, or a task.
- **Send** calls `cli.messages.editLastResend`:
  - a thread with a response in flight is rejected
    (`EDIT_LAST_THREAD_PROCESSING`) — Stop first,
  - if the edited message's turn already ran, that response is discarded
    (deleted) and the next run forks from the previous turn's continuation,
  - the edited message rejoins the queue at its original position; other
    queued messages stay and rerun with it in original order (a held queue
    is released — resend is a "go" signal),
  - retained attachments keep their storage references; new attachments require
    the sender's pending-upload claim; removed attachments lose their message
    references and unreferenced blobs are deleted only on successful resend,
  - command and skill references expand again, and mode, model, effort, and task
    changes persist on the message. The thread remembers the submitted selection.
- **Cancel** sits on the right of the footer, immediately before Send.
  Cancel or Escape restores the bubble unchanged. A failed resend
  keeps the editor open with the draft intact.
- The queued-messages strip keeps its own Edit (composer restore) and
  Delete actions for queued/held messages — unchanged.

## Continuation / fork semantics

- Deleting the discarded turn's assistant message makes
  `getLatestContinuationForThread` (which reads the newest assistant
  message) fall back to the previous turn's `continuationId`.
- Claude Code runs with `resume + forkSession: true`, and each turn stores
  the *forked* session id on its own assistant message — so resuming from
  the previous turn's id is a genuine fork that never contained the
  discarded exchange.
- Codex / Cursor / OpenCode have no fork primitive (mutable session resume):
  their local transcripts still contain the discarded turn. Accepted — same
  fidelity as the existing `cliMessages.retry`.
- In a forked thread (`cli-thread-fork.md`) the copied run is the newest
  one, so its user message is editable like any other. Discarding the copied
  reply leaves no assistant with a continuation, and
  `getLatestContinuationForThread` falls back to
  `forkedFrom.continuationId`, the parent's turn before the copied run.

## Held queue (`cliThreads.queueHeldAt`)

A held queue keeps unprocessed user messages parked: they stay queued and
individually editable/deletable, but the CLI does not pick the thread up.

- **Set by**:
  - `cliThreads.cancelProcessing` when unprocessed messages remain at Stop
    (see `cli-thread-cancel-processing.md`).
- **Cleared by**:
  - `cliMessages.send` (`markThreadPending`) — a new send is the "go"
    signal; the messages then run in their original order, with the new message last,
  - `cliMessages.editLastResend` — resending the edited message releases
    the whole queue,
  - `cliThreads.releaseQueueHold` — the strip's **Send now** action: run the
    held messages as-is without composing anything (see
    `cli-thread-cancel-processing.md`),
  - `cliMessages.retry` (`requeueThreadForRetry`),
  - the queue emptying via `removeQueued` deletes
    (`setThreadPendingUserMessages` with no remaining unprocessed).
- `resetThreadClaim` requires an explicit `queueHeldAt` in its patch — every
  caller states whether it keeps, sets, or clears the hold; forgetting the
  field is a type error, never a silent un-hold.
- **Enforcement**: `listPendingThreadsByProfile` excludes held threads and
  `claimThread` refuses them, so a held queue is invisible to CLI workers.
  `hasPendingUserMessages` keeps meaning "unprocessed messages exist" —
  held threads keep it `true`.
- **Held ⇒ not running**: `deriveThreadWatchStatus` buckets a held
  `pending` thread as `waiting_input`, the thread list's running indicator
  and the task `agentThreadWork` summary apply the same rule.
- **UI** (OS-2171): a held queue only exists behind a stopped streaming run
  (a no-run stop fails its run in place instead, OS-1459 — see
  `docs/specs/cli-thread-cancel-processing.md`), so its messages were never
  sent. They render in the queued-messages strip like messages queued behind
  a streaming run, hidden from the conversation, with the strip's Edit
  (composer restore) and Delete. Steer does not apply (nothing is running);
  the first row's Steer slot shows **Send now** instead, which releases the
  whole queue in order. No notice line sits above the strip. While held, no
  bubble shows the edit-last pencil: the newest user message is in the
  strip. The composer stays in Submit mode (`isThreadProcessing` treats a
  held thread as idle) and no "Waiting for CLI" placeholder shows.

## Contract

`cli.messages.editLastResend` uses web/user authentication and returns null.
Required arguments are `messageId` and `content`. Optional arguments are
`composerDocument`, `cliMode`, `cliModel`, `cliEffort`, `taskId`, `attachments`,
and `runtimeCommand`. Omitted settings, task, and attachments preserve the old
values. Null clears a setting or task, and an empty attachment list removes all
attachments. Runtime commands require a leading slash and no attachments.

Validations:
- message is a user message and the thread's newest user message
  (`EDIT_LAST_NOT_LAST_USER_MESSAGE`),
- trimmed `content` non-empty, unless the edited message carries attachments or a task
  (`MESSAGE_CONTENT_REQUIRED`),
- the thread's `processingState` is `idle` (`EDIT_LAST_THREAD_PROCESSING`)
  — editing never interrupts a claimed or streaming run,
- a processed message without `runId` is rejected
  (`EDIT_LAST_LEGACY_MESSAGE`) — its response can't be found, so a rewind
  would orphan the assistant reply and leave the continuation pointing at
  the discarded turn.

Behavior (one atomic mutation, thread guaranteed idle by the guard):
1. If the message was processed: delete its run's assistant message(s)
   and chunk rows and un-stamp the run's other user messages back into
   the queue (`unstampRunUserMessages`).
2. Replace the message's chunk rows with the new text. Resolve the submitted
   command document again, clearing the old expansion. Validate task access and
   new upload claims, replace attachment references, and normalize the submitted
   runtime selection using the same rules as Send. These changes and the rewind
   share one transaction, so validation failures leave the original turn intact.
3. Un-stamp the message itself (`processedAt`/`processedBySessionId`/
   `runId`/`steerRequestedAt`/`steeredAt`/
   `errorMessage` cleared).
4. `resetThreadClaim` to `pending` with `hasPendingUserMessages: true` and
   the queue hold cleared — the CLI picks the whole queue up as one run,
   edited message first in original `createdAt` order.

CLI-side note: a mutation that flips a thread back to pending can race the
thread's worker still draining from a just-stopped run (e.g. resend or
Retry immediately after Stop). The pending-list subscription fires at a
moment the worker is still marked active — and never again afterwards — so
the message handler defers such an enqueue instead of dropping it and
re-enqueues the thread when the worker exits (`deferredChats` in
`thread-processor.ts`); the follow-up claim is a no-op when nothing is
pending by then.

## Non-goals

- Editing arbitrary (non-last) messages.
- Agent-side transcript truncation for runtimes without a fork primitive.

## Implementation boundary

The UI lives in `components/blocks/thread/edit-last-message/`, exporting only
`EditLastMessage`. `thread-message-list` mounts it, `thread-view` supplies the
thread context, and `use-cli-messages` forwards the submitted fields. The
existing `cli.messages.editLastResend` mutation owns persistence and rewind.
