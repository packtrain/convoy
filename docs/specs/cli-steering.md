# CLI Steering Specification

Steering for CLI agent runs (OS-1111). While a run is streaming, the user can
inject a queued message into the in-progress run instead of waiting for it to
finish. The injected message becomes the next turn of the same provider
session and streams into the same assistant message. Supported for Claude
Code runs, for Codex runs served over the app-server transport (the
default; absent under `convoy connect --codex-exec`) and for Antigravity
runs (CLI 0.155.0 and newer).

## User-visible behavior

- Sending a message while a thread is processing still just queues it
  (existing behavior; `processedAt === undefined` is the queue marker).
- While an assistant run is actively streaming (`processingState ===
  "streaming"`), queued user messages are hidden from the message list and
  shown in a **queued-messages strip docked above the composer**
  (`components/blocks/thread/queued-messages-strip.tsx`) — one row per
  message with a **Steer** button. The rows share one bordered list with
  dividers between them, not separate cards (OS-2153). Docking keeps the button stationary while
  the stream scrolls. A held queue (Stop) uses the same strip, with
  **Send now** in place of the first row's Steer (OS-2171, see
  `cli-thread-edit-last-message.md`). So does a queue waiting for an
  offline CLI (OS-2311): Edit and Delete only, no Steer or Send now, and the
  "Queued until the CLI reconnects" row stays in the list. Otherwise
  queued messages render as normal bubbles in the list (between runs). A files-only
  message shows its attachment file name (or "N attachments") as a muted
  label instead of an empty row; text plus files adds a paperclip + count
  badge before the text, next to the queue icon, so it doesn't read as an
  action button (OS-1877). Both are non-interactive — Edit restores the
  attachments into the composer for inspection.
- A row's text never depends on the loaded history window. A long run can
  write more chunks after a queued message than the window holds, so the
  thread view reads the chunks of unprocessed messages outside the window by
  id (`cli.messageChunks.listNormalizedByMessages`) for the strip text.
  Edit does not use the client's copy: `removeQueued` reads the text from the
  message's chunk rows before deleting them and returns it (OS-2422).
- Each strip row also offers **Edit**: `cli.messages.removeQueued({
  messageId, preserveAttachments: true })` (web/user-auth) deletes the queued
  message (chunk rows and attachment refs) and recomputes
  `hasPendingUserMessages`, but keeps the attachment blobs: each ref is
  converted into a `cliMessagePendingUploads` row (the same lifecycle as a
  freshly uploaded, not-yet-sent attachment). It returns `{ text, attachments }`:
  the message text and the attachment summaries. The client restores that text into the composer and
  re-attaches the returned storage ids without re-uploading (seeded into the
  upload queue in `done` state, with matching composer file parts whose URL
  is the signed URL for preview). Exact, unambiguous `#filename` references
  become composer pills linked to those file-part IDs, including JSON-quoted
  filenames. Their hover previews and lightbox actions work immediately.
  Unknown or duplicate filenames remain plain text. Re-sending converts the
  pending rows back into refs; removing the pill or abandoning the composer deletes the blob
  via the standard pending-upload cleanup. If the composer already holds a
  draft, the queued text is appended after a blank line so neither text is
  lost. Rejected once the message is processed or a steer is in flight (the
  run may already have received it).
- Each strip row also offers **Delete**: the same `removeQueued` mutation
  without `preserveAttachments` and without the composer restore — the queued
  message is discarded outright and blobs with no remaining refs are deleted.
  Available for every runtime (the strip shows regardless of steering
  support) and subject to the same rejections as Edit. Emptying the queue of
  an unclaimed `pending` thread (CLI offline) settles it to `completed`, so
  it does not read as running with nothing queued (OS-2311).
- Clicking Steer marks the message; the running CLI picks it up and injects
  it into the live run. Until consumed it shows a "Steering..." state. The
  agent usually sees the message mid-turn (absorbed at the next inference
  boundary); at latest it is handled as the run's next turn.
- **Inline rendering**: consumption appends a marker chunk to the streaming
  assistant message (`convoy_notice` with `code: "steered-message"`, the
  message text, and the steered user message's `messageId`), so the steered
  message renders as a user-style bubble inline in the assistant stream at
  its injection position. The standalone user bubble is hidden once
  `steeredAt` is set. The inline bubble renders the message's attachment
  pills by resolving `messageId` against the (hidden but still subscribed)
  user message envelope, so signed URLs stay fresh; task pills are not
  repeated inline. Legacy markers without `messageId` render text only.
  Retry clears `steeredAt`, so a requeued message renders as a normal
  bubble again.
- **A steer never counts as the thread's latest message.** It is stored after
  the assistant message it was injected into but renders inside it, so "latest"
  always means the newest message that renders as its own row —
  `findLatestRowMessage` / `findLatestRowUserMessage` in
  `lib/threads/message-rows.ts`, which share their steer predicate with the
  list's inline-rendering rule. This governs:
  - the failed banner with Retry/Continue, and the continuing-message reset:
    reading the raw envelope tail let an invisible steer take the latest slot
    and silently suppress the failure state of the assistant turn below it, so
    the thread page showed a clean turn while the thread list and its container
    showed the failure (OS-1463);
  - the inline **Edit** action on the newest user message: keyed to the steer
    it rendered on no bubble at all, so it falls back to the newest user
    message that has one. Editing that message resends from before the steer —
    Edit has always meant "the last bubble you can see";
  - the status-only envelope kept in the chunk window
    (`use-cli-messages.ts`), so a trailing steer cannot push a chunk-less
    pending/streaming/failed assistant out of view.
  The plan panel's anchor is deliberately *not* one of these: it filters to
  assistant messages, which excludes steers by construction.
- Display ordering fallback: for user messages in the run that still render
  standalone (legacy steered messages without `steeredAt`, cancel runs),
  the thread view anchors them just before their run's assistant bubble
  (presentation-only reorder in the thread detail page).
- If the run ends before the steer is consumed, nothing is lost: the message
  stays queued and is processed as the next run (the standard path).
- Steering is offered only when **all** of the following hold:
  - the thread's runtime supports steering (backend runtime registry
    `supportsSteering`, currently `claude-code` and `codex`),
  - the claiming CLI session advertised steering for the thread's runtime at
    registration (`steeringCliTypes`, CLI ≥ 0.8.0; the legacy boolean
    `supportsSteering` from CLI 0.6–0.7 means Claude Code only) — codex is
    advertised only when the connection runs the app-server transport, so
    exec-transport codex threads never show Steer,
  - the thread is streaming with an active, unexpired claim.

## Data model

- `cliMessages.steerRequestedAt?: number` — user asked to inject this queued
  message into the active run. Only meaningful while `processedAt` is
  unset. Set by `requestSteer` (the strip's Steer button) or at insert by
  `send` with `steer: true` (OS-1873, the MCP `send_thread_message` path) —
  both behind the same availability check, so it never exists without a run
  that can consume it. Cleared whenever the message is stamped into any run
  (`consumeSteeredMessages`, `startRunResponse`, `cancelProcessing`) or
  un-stamped by `retry`, so stale steer state never lingers.
- `cliMessages.steeredAt?: number` — set by `consumeSteeredMessages` when the
  message was injected into an active run; the thread view hides the
  standalone bubble (its content renders inline via the marker chunk).
  Cleared by `retry`.
- `cliSessions.supportsSteering?: boolean` — legacy capability flag
  registered by the CLI (`POST /api/agent/register`), same pattern as
  `supportsInteractiveApprovals`. On sessions without `steeringCliTypes` it
  means "steers Claude Code".
- `cliSessions.steeringCliTypes?: string[]` — per-runtime capability (CLI ≥
  0.8.0): the cliType slugs this connection can steer. Always includes
  `claude-code`; includes `codex` only when the connection runs the
  app-server transport (the default — excluded under
  `--codex-exec` or an auto-downgrade from codex < 0.142.0).
  `sessionSupportsSteeringForCliType(session, cliType)`
  (`convex/cli/lib/cliSessionsRepo.ts`) is the one canonical resolution
  helper (used by `requestSteer` and `getSessionCapabilities`); it falls back
  to the legacy boolean for old sessions. Exposed to the web via
  `cli.sessions.getSessionCapabilities({ sessionId, cliType? })` — with
  `cliType` the returned `supportsSteering` is resolved for that runtime.
- Runtime capability: `supportsSteering` on the backend runtime definition
  (`convex/cli/lib/runtimes/`), `true` for `claude-code` and `codex`. The
  frontend re-exports `cliTypeSupportsSteering` from the same registry — one
  canonical capability source. Enabling another runtime later = flip its
  registry flag, implement `steer()` in that runtime's CLI runner, and add
  its slug to the CLI's registered `steeringCliTypes`.

## Contracts

- `cli.messages.requestSteer({ messageId })` — web/user-auth. Validates:
  runtime supports steering; message is an unprocessed user message
  (`MESSAGE_NOT_QUEUED`); thread streaming, claim active and unexpired,
  claiming session supports steering for the thread's runtime
  (`STEER_NOT_AVAILABLE`). Idempotent when already requested. Patches
  `steerRequestedAt`.
- `cli.messages.send({ ..., steer: true })` — the same availability check
  (shared `steerAvailable` helper), but best-effort: when it fails the flag is
  dropped and the message queues normally, since for a sender the fallback is
  the standard delivery path, not an error. Runtime commands never stamp.
  This is how another agent steers at send time via MCP `send_thread_message`
  (OS-1873, `docs/specs/mcp-server.md`).
- `cli.messages.listSteerRequestedUserMessages({ threadId, sessionId })` —
  CLI query, the per-run subscription target. Returns steer-requested
  unprocessed user messages (oldest first, `processedContent` preferred).
  Returns `[]` unless `sessionId` holds the live claim, so the subscription
  goes quiet on claim loss or expiry.
- `cli.messages.consumeSteeredMessages({ threadId, sessionId,
  assistantMessageId, userMessageIds })` — CLI session-auth. Mirrors
  `startRunResponse` consumption: validates the assistant target (same
  thread, `role: assistant`, `status: streaming`, claimed by the session) and
  each user message (unprocessed + steer-requested,
  `STEERED_MESSAGES_NOT_PENDING`), then stamps
  `processedAt`/`processedBySessionId`/`runId` (from the assistant
  message)/`cliVersion`/`steeredAt`, clears `steerRequestedAt`, appends one
  `steered-message` marker chunk per message (carrying the message text and
  the steered user message's `messageId`) to the assistant stream, and
  recomputes `hasPendingUserMessages`. Thread claim/streaming state is left
  untouched.

## CLI runtime protocol

- `CliRuntimeRunner.steer?(injection: PreparedRuntimeExecution): boolean |
  Promise<boolean>` — optional; runtimes without mid-run injection omit it.
  May be synchronous (Claude pushes into an open input stream) or async
  (codex round-trips a `turn/steer` RPC). The injection is produced by the
  runtime's own `prepareRunExecution` (same formatting as a run,
  including stream-json frames for inline images).
- `RunnerExecutionOptions.steerEnabled` — set by the thread processor when
  the runner implements `steer`; tells the runner to hold its input open.

### Thread processor (per active run)

- When the runner is steerable, `processChat` subscribes to
  `listSteerRequestedUserMessages` for the duration of the run (one
  bounded, thread-scoped subscription per active run) and serializes updates
  through a promise chain with a handled-id dedupe set.
- **Push first, consume after.** For each fresh steer message: resolve
  attachments → `prepareRunExecution` → `runner.steer(injection)`. If it
  returns `false` (run already ended) the message is left queued for the
  next run. If `true`, `consumeSteeredMessages` stamps it into the running
  run. A consume failure after a successful push degrades to a rare
  duplicate turn in the next run — never lost input.
- Teardown: the subscription is unsubscribed and the steer chain awaited
  after the run's output drains and before `messages.complete` (and in the
  run `finally` for error paths), so an in-flight consume cannot race the
  next run snapshot.
- Model/effort are **not** re-resolved for steered messages — they are fixed
  at `startRunResponse`. Mode is passed to `runner.steer(injection, cliMode)`
  (latest steered message with a mode). Claude Code applies it with
  `setPermissionMode` before injecting, so an Act steer into an Ask run runs
  as Act; a failed switch returns `false` and the message stays queued for
  the next run. Other runtimes ignore it and inject under the running mode.

### Claude Code runner

- Steering rides the open-ended streaming input already used for interactive
  approvals: `openEnded = interactive || steerEnabled`. The open input is
  pushable (`push(frames)` appends mid-run user messages). Any open-input run
  (including steer-enabled `agent`/bypass runs) gets the graceful
  `interrupt()` abort path.
- **Absorption semantics** (verified against Agent SDK 0.2.x): a user message
  pushed while a turn is running is *absorbed into that turn* — the model
  sees it at the next inference boundary and the turn produces a single
  `result`. Only a message pushed after the turn already finalized queues a
  new turn with its own `result`. Results therefore cannot be mapped to
  pushed frames.
- **End-of-run protocol**: an unsteered open-input run still ends at its
  first `result`. When any steer was pushed, the run loop instead nulls the
  steer state (synchronously — later `steer()` calls return `false` and fall
  back to the next run), closes the input stream (EOF), and drains until
  the SDK stream completes naturally. An absorbed steer ends the stream
  immediately; a late-queued steer gets its turn processed and streamed
  before the EOF takes effect.
- A steered run may thus emit more than one `result` chunk in one assistant
  message. Consumers treat result metadata as last-wins (the web composer
  `Object.assign`s metadata; the runner's error summary keeps the last
  result).

### Codex app-server runner

- Available only on the app-server transport (the default); `codex exec` has
  no mid-run input channel, so connections on that transport omit `codex`
  from `steeringCliTypes`.
- `steer()` sends the `turn/steer` RPC (`{ threadId, input: [{type: "text",
  text}], expectedTurnId }`) against the run's active turn and resolves
  `true` on success. `expectedTurnId` is a server-side precondition: codex
  rejects the steer when that turn is no longer active, so a `false`
  resolution reliably means the message stayed queued for the next run —
  the push-first/consume-after contract holds without an open input stream.
- Guarded locally too: steers after abort, process exit, or `turn/completed`
  resolve `false` without an RPC.
- Codex absorbs the steered input into the active turn (it does not open a
  second turn), so the run still ends at its single `turn/completed`.

### Antigravity runner

- `steer()` sends another `session/prompt` on the run's session and returns
  `true` once it is written. agy (1.5.14, verified) answers the open prompt
  with `end_turn` and carries on under the new one, so the run ends when the
  last open prompt has answered. Cancel and restart would kill running
  commands and subagents, so it is never used.
- It returns `false` after the last prompt has answered, after abort and
  between runs. The message then rides the next run. That includes the wait
  for a backgrounded command: see
  [cli-antigravity-runtime.md](cli-antigravity-runtime.md#run-lifecycle).
- The steered messages' mode is ignored. agy's mode is the spawn flag.
- One `convoy/acp_prompt_result` per run, with usage summed across its
  prompts.

### Non-steerable runtimes

- Cursor (`cursor-agent`) has no mid-run input channel at all: every turn is
  a fresh `cursor-agent -p` process with the prompt on stdin followed by
  EOF. `supportsSteering` stays unset, sessions never advertise `cursor` in
  `steeringCliTypes`, and queued messages ride the next `--resume` run —
  the generic fallback with no runtime-specific wiring.

## Interaction with other lifecycles

- **Stop** (`cancelProcessing`): revokes the claim (existing poll → abort
  path); queued messages — including steer-requested ones — stay queued in
  a held queue with `steerRequestedAt` cleared (OS-1374). See
  `docs/specs/cli-thread-cancel-processing.md` and
  `docs/specs/cli-thread-edit-last-message.md`.
- **Retry** of an assistant run un-stamps all its user messages (steered
  ones included) and clears `steerRequestedAt`, so they requeue cleanly.
- **Next run fallback**: `startRunResponse` clears `steerRequestedAt` on
  the messages it absorbs, covering steers that missed their run.
- **Claim moves to another session**: the steer query returns `[]` for the
  old claimant; the new claimant sees the message as ordinary queued input.
