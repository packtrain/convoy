# CLI Interactive Approvals Specification

Interactive permission approvals for CLI agent runs (OS-992). The provider
connection lives in the CLI process; Convex is the signaling bus.

## Permission modes

- Thread/message `cliMode` values: `agent` (legacy, full access =
  `bypassPermissions` + skip flag), `default`, `acceptEdits`, `auto`,
  `dontAsk`, `plan`. Non-`agent` values map 1:1 to Agent SDK `PermissionMode`.
- Every bridged Claude run installs the SDK `canUseTool` callback — including
  bypass/`agent` mode — and always uses streaming-input mode with the input
  held open for the run (`interrupt()`, `setPermissionMode()`, and the
  permission control channel require it). In bypass mode the SDK
  short-circuits ordinary tools to allow before `canUseTool` is consulted, but
  tools flagged `requiresUserInteraction` (`AskUserQuestion`, `ExitPlanMode`)
  still route through it, so a question in `agent` mode blocks for the user
  instead of resolving unanswered.
  Steer-enabled runs also hold the input open and share the graceful
  `interrupt()` abort path; see `docs/specs/cli-steering.md`. An unsteered run
  loop still ends at the first `result`, so one provider result ends one Thread run; a steered run
  closes the input at the first result and drains to natural stream completion
  instead.
- Without an interaction bridge (e.g. fixture mode), permission prompts and
  questions auto-deny like headless `claude -p`.

### OpenCode

- OpenCode runs are the second bridge consumer (see
  `docs/specs/cli-opencode-runtime.md`): `permission.asked` SDK events become
  `tool-approval` requests (requestId = OpenCode's permission id) and
  `question.asked` events become `question` requests.
- Web decisions map to `client.permission.reply`: `allow` → `once`,
  `allow-always` → `always`, anything else → `reject`. Question answers map
  to OpenCode's ordered per-question label arrays; a dismissed question is
  rejected (`question.reject`).
- Non-`agent` OpenCode modes apply an ask-everything permission ruleset at
  session creation; `agent` mode allows all (asks can still fire for
  explicitly configured user denials and are answered through the same
  bridge). Without a bridge, permission asks auto-reject.

### Antigravity

- Antigravity runs are a bridge consumer (see
  `docs/specs/cli-antigravity-runtime.md#permissions-and-questions`). agy's
  `session/request_permission` becomes a `tool-approval` request, or a
  `question` request when its `toolCallId` starts with `interaction_`.
- Web decisions map to an offered option by kind: `allow` → `allow_once`,
  `allow-always` → `allow_always`, `deny` → `reject_once`. A missing kind falls
  back to the nearest offered one, and with none left the reply is
  `cancelled`. The card shows Always allow only when agy offers
  `allow_always`.
- A question answer maps back to its option id by label. An unknown or
  ambiguous label is `cancelled`.
- Only `default` ("Ask to approve") drops `--dangerously-skip-permissions`.
  Questions reach the bridge in both modes. Without a bridge, tool requests get
  `allow_once` and questions get `cancelled`.

### Codex (app-server transport only — the connect default)

- Codex runs join the bridge on the default app-server transport (see
  `docs/specs/cli-codex-runtime.md`); connections started with
  `convoy connect --codex-exec` (or auto-downgraded from a codex
  older than 0.142.0) use `codex exec`, which cannot prompt mid-run.
- Native command and file approvals use `tool-approval`; user input uses
  `question`. CLI-generated UUIDs identify web rows. The CLI separately retains
  the JSON-RPC request ID and provider thread ID for resolution notifications.
- Command approvals preserve `availableDecisions`, policy amendments, network
  context, and additional permissions. The card offers only the advertised
  decisions and sends the selected index. The CLI returns the original decision,
  including amendment objects. Older servers without a decision list retain
  Allow, Allow for session, Deny, and Cancel. File changes still include the
  changes captured from `item/started`.
- `item/permissions/requestApproval` shows the requested permissions and reason.
  Allow grants exactly those permissions for the turn; Allow for session uses
  session scope. Denial or cancellation grants an empty permissions object with
  turn scope. No permission supplied by the web response can widen the grant.
- `item/tool/requestUserInput` preserves `isBlocking`, question IDs, `isOther`,
  and `isSecret`. Answers use provider question IDs. Older clients can still
  answer by question text. `isOther: false` removes custom answers when choices
  exist; questions without options use a text field. Secret fields use password
  inputs, disable autocomplete, and preserve whitespace. Responses remain on the private interaction
  channel and are not copied into chat messages or debug logs.
- Completed `agentMessage` items with `delivery: async` and questions create
  nonblocking cards. Titles and options come from the structured questions;
  ordinary partial and completed text still streams. Generated question IDs
  include the item ID and question index. Deduplication uses thread, turn, and
  item identity, so duplicate completions do not recreate prompts and children
  can reuse item IDs. Answers use `turn/steer` for the originating provider
  thread and expected turn, without interrupting it or returning an RPC answer.
  Late answers to completed turns do not start another turn.
- `mcpServer/elicitation/request` supports standard `form` and `url` modes.
  Forms support string, number, integer, boolean, single-select enums, and
  multi-select enums, including titles, defaults, required fields, and bounds.
  The CLI validates typed content and string formats before accepting it.
  URL cards show an explicit HTTP/HTTPS link and Continue, Decline, and Cancel;
  rendering the card never opens the URL. Responses preserve MCP action values
  and use null content on decline, cancellation, and URL acceptance. Client
  metadata is null. Unsupported form extensions expose Decline and Cancel.
- `serverRequest/resolved` cancels only the matching provider request, removes
  its web card, aborts its local wait, and suppresses a late JSON-RPC reply.
  Cancellation waits for an in-flight row creation. Completed child turns clear
  their own prompts. Stop and run teardown abort all remaining waits; existing
  lifecycle mutations remove their cards. Expired web requests reject responses.
- Missing bridges fail closed. Host-executed dynamic tool calls and external
  token refresh are separate capabilities and remain unsupported; adding these
  interactions does not advertise or enable either capability.
- Protocol reference: [official app-server documentation](https://developers.openai.com/codex/app-server)
  and the installed Codex 0.153.4 experimental TypeScript schema.
- Codex plan mode uses a read-only sandbox and native proposals. It has no
  live `plan-approval` request. Completed proposals get approval controls
  that start a new implementation turn; see the Codex runtime spec.

MCP single-choice enum and boolean fields use the shared shadcn Select. Preserve
required validation, defaults, typed responses, optional clearing, and drafts
when switching cards. The field scroll area has a focus-ring gutter so keyboard
focus remains visible on all sides. Multi-select arrays retain their listbox.

## Claude MCP elicitation

`onElicitation` requests use blocking question cards with `elicitation: true`,
separate from AskUserQuestion. Preserve server name, message, schema, display
metadata, URL, and elicitation ID. Generate a unique bridge request ID for each
callback; the SDK owns control-request correlation. Omitted mode means form.

Reuse the MCP form validation and card used by Codex. Valid form acceptance
returns `{ action: "accept", content }`; URL acceptance returns only
`{ action: "accept" }`. Decline/cancel return only their action. Do not send
Codex's null content or metadata to Claude. Invalid JSON, actions, form values,
or non-HTTP/HTTPS URL acceptance decline. Abort or bridge disconnection cancels.
No URL opens automatically. Completion-only notifications remain silent.

## Signaling table: `cliInteractionRequests`

- Provider-neutral: `kind` (`tool-approval` | `question` | `plan-approval`) +
  opaque `payloadJson`/`responseJson`; nothing Claude-specific in schema or
  web components (Codex reuses the channel).
- Row: threadId, messageId (assistant run target), sessionId, profileId,
  CLI-generated `requestId` (unique per thread), status
  (`pending`/`answered`/`cancelled`), `expiresAt`, timestamps.
- `create` (CLI, apiKey + active-claim gated) is idempotent by requestId;
  repeated calls refresh `expiresAt` while pending only.
- `respond` (web, thread owner + CLI_THREAD permission): `pending → answered`
  once; repeat responds are no-ops; expired requests are rejected.
- `cancel` (CLI): `pending → cancelled`, idempotent; answered rows are final.
- Expiry is tied to the thread claim lease, NOT the 60s session heartbeat:
  `heartbeatClaim` extends pending request expiry with the lease, and
  `listPendingByThread` filters out lease-expired rows.
- `listPendingByThread` additionally drops rows whose claiming session is
  offline (`cliSessions.isOnline` false, set by the offline sweep; see
  [cli-bridge.md](../architecture/cli-bridge.md#online-status)). The lease outlives a
  killed CLI process by up to its full duration, and answering such a row
  writes into a request nobody is subscribed to: the click silently does
  nothing and the run only fails minutes later when the watchdog notices
  (OS-1463). Session liveness — not the lease alone — decides answerability.
- Lifecycle cancellation: `complete` ("run completed"), `fail` ("run failed"),
  `retry` ("message retried"), `releaseClaim` ("claim released"), and
  `failStreamingChat` (watchdog disconnect/lease expiry — "agent
  disconnected") cancel the thread's pending requests.
- Denormalized thread flag: the interaction-request write paths maintain
  `cliThreads.hasPendingInteraction`. Blocking creates set it; responses and
  cancellations clear it once no blocking requests remain.
  Nonblocking requests remain answerable but do not set this flag. Lifecycle
  cancellation counts only blocking requests when deciding whether a run was
  parked on user input. While set on a streaming/pending thread,
  `deriveThreadWatchStatus` buckets
  the thread as `waiting_input` instead of `running`, so a run parked on a
  mid-stream approval/question surfaces in the Watch Tower's "Waiting for
  your input" section (see `docs/specs/watch-tower.md`). The thread list
  items (`cli/threads` queries) expose the flag as `hasPendingInteraction`,
  and the sidebar/threads list applies the same rule: a streaming/pending
  thread with a pending interaction shows the amber "Awaiting input"
  indicator instead of the streaming spinner
  (`components/blocks/thread/thread-list-item.tsx`).

## CLI flow

1. Provider emits a permission request (`canUseTool`); the runtime classifies
   it: `ExitPlanMode` → `plan-approval` (payload: plan markdown),
   `AskUserQuestion` → `question` (payload: questions), else `tool-approval`
   (payload: toolName, inputJson, SDK `title`/`displayName`/`description`/
   `decisionReason`/`blockedPath`, hasSuggestions).
2. CLI parks the resolver by requestId (register **before** the create
   mutation so an instant answer cannot be missed) and inserts the row.
3. One standing per-session subscription (`listAnsweredBySession`) routes
   answers back; dispatch dedupes by requestId (subscriptions re-fire).
4. Abort signal → deny result locally; the server row deliberately stays
   pending (see "Losing the run while parked"). Malformed responses deny.

Response contracts (`responseJson`):

- tool-approval: `{ decision: "allow" | "allow-always" | "deny", message? }` —
  allow-always returns the SDK `suggestions` as `updatedPermissions`.
- question: `{ answers: { [questionText]: selectedLabel } }` → allow with
  `updatedInput: { questions, answers }` (multi-select labels comma-joined).
  The answer value is any non-empty string, not just a predefined option
  label: the web question card offers an "Other…" free-text input per
  question unless the provider explicitly disallows custom answers. Codex uses
  question IDs as keys and masks secret fields. Other runtimes retain text keys
  and pass the string through verbatim (multi-select combines picked
  labels and the custom text comma-joined).
- plan-approval: `{ decision: "approve", nextMode? }` — approve calls
  `setPermissionMode` on the live session, then allows `ExitPlanMode`.
  Act (`agent`) maps to SDK `bypassPermissions`; missing or invalid modes fall
  back to `default`. Plan and steer-enabled sessions enable
  `allowDangerouslySkipPermissions` so an explicit Act approval or Act steer
  can switch modes, while starting in their own mode.
  Approve is the only decision the web sends over the bridge
  (OS-1461: keeping planning is a sent message, which ends the run instead of
  answering the gate); any other/malformed response denies with a
  plan-not-approved message, which is also the abort path.

## Graceful interrupt

- `runner.abort()` on an interactive run calls `Query.interrupt()` first
  (graceful; preserves the continuation id) with a 5s hard-abort fallback
  (`AbortController` + `close()`). Non-interactive runs hard-abort as before.
- Interrupting a turn parked on an unresolved tool call (plan approval,
  question) makes the CLI end the turn with an `error_during_execution`
  result (`[ede_diagnostic] … stop_reason=tool_use`) plus a synthetic
  text-only user message ("[Request interrupted by user for tool use]").
  Both are self-inflicted wind-down artifacts, not failures (OS-1463), and all
  three layers stay quiet about them:
  - the runner suppresses the error-result throw when it initiated the abort,
  - chunk normalization maps text-only user messages to silent metadata (like
    string-content bookkeeping) instead of an "unsupported event" box. A
    nested (subagent) one stays `unknown` so the composer can dedupe the Task
    prompt echo, unless it carries `isSynthetic: true`, like the
    "[Image: original …]" note after a subagent reads an image (OS-2295),
  - and the `result` chunk emits no "Run error" notice when its `errors`
    carry the `[ede_diagnostic] … stop_reason=tool_use` signature (the turn
    ended on an unresolved tool call). Result metadata is still recorded; an
    `error_during_execution` without that signature still notices normally.

## Web UI

- Mode selector offers Act / Ask to approve / Accept edits / Auto / Plan as
  compact single-line items (description via tooltip); `agent` remains the
  default. `dontAsk` stays a valid backend/CLI mode value but is not offered
  in the selector.
- Pending tool-approval and question requests render as cards between the
  conversation and the composer: tool approval (Allow / Always allow when
  suggestions exist / Deny), question (option buttons per question, send once
  all answered).
- Multiple pending requests share an overlapping card deck. One request is
  open; up to three waiting cards peek out behind it. Hover or keyboard focus
  on a preview spreads the cards upward without moving the composer. Selecting
  a preview brings that request forward. Spring transitions respect reduced
  motion. Labels use the first question's header/text or the request
  title/server/tool name; long labels truncate.
- The pending-count text below the deck opens a bounded, scrollable picker
  containing every request. It reads "3 pending questions" for question-only
  queues or "3 pending requests" when other request types are present. This
  provides touch and keyboard access to all requests. There are no separate
  All or Spread cards buttons. The picker uses the shared dropdown radio items
  for standard row spacing, selection indicators, and keyboard navigation.
- Switching cards preserves question and MCP form drafts. Inactive forms stay
  mounted but hidden, inert, and disabled; exiting forms cannot respond.
  New requests
  do not replace the selected request. When it disappears, a remaining request
  becomes visible. A single request has no stack controls; transitions
  between one and multiple requests preserve its draft. Per-question tabs
  within a request keep their existing behavior.
- **Plan approvals are not cards.** They render in the thread, in the plan
  panel's footer (OS-1458) — which also keeps the composer area small enough
  for the mini/embedded thread view (OS-1457). See "Plan decisions" below.
- Cards disable after responding (server-side idempotent); cancelled/expired
  requests disappear from the pending query.
- An assistant message parked on an interactive prompt (`AskUserQuestion` or
  `ExitPlanMode` still at `input-streaming`/`input-available`) drops its
  `Working` indicator — the run is waiting on the user, and the prompt's
  own card carries that state.

## Plan decisions

One decision model for every runtime and both transports (OS-1458), in
`lib/threads/plan-decision.ts`:

- **Options**: approve only — there is no "Keep planning" button (OS-1461),
  because keeping planning is just sending the feedback (the send path already
  ends the parked run).
  - `Approve & continue in <mode label>` (→ mode `auto`, primary). The label
    borrows the runtime's own name for that mode, so Claude reads "Auto" and
    Codex reads "Sandboxed".
  - `Approve, ask per tool` (→ mode `default`).
  - The primary button has a joined dropdown trigger. The dropdown contains
    one extra action,
    `Approve & continue in Act` (→ mode `agent`). Selecting it approves
    immediately in Act; opening the dropdown does not change the mode.
    Ask remains a separate button. All controls disable during a decision.
  - Options are filtered to the modes the runtime offers, so OpenCode (no
    `auto`) uses Ask as its primary action with Act in the dropdown. An unknown runtime keeps all
    options rather than stranding the user with no way to approve.
    If Act is the only supported option, it becomes the primary button and
    no dropdown is shown.
- **Where**: the plan panel's footer. Claude uses a live plan gate or its
  orphaned-gate recovery path. Codex uses a completed native proposal with
  a ready pointer on the waiting thread. OpenCode has neither and continues
  through the composer.
- **When**: a pending `plan-approval` request, an orphaned Claude gate, or a
  ready Codex proposal exists. A completed answer or the composer's mode alone
  never enables approval. Codex's server verifies the selected proposal and
  consumes it atomically with the implementation message. Its provider turn
  already ended, so there is no bridge callback to resolve.
  Native proposal controls match the pending message, turn, and item IDs.
  The handler checks the same identity and reports a stale click without sending.
- **Anchoring**: the buttons belong to the last assistant message, not the
  last message — a trailing queued/steered user message must not push them out
  of the plan panel.
- **Applying approve** (one path, `handlePlanDecision`): the request is
  answered through `interactionRequests.respond` for a live gate. A Codex
  proposal instead sends its identity through `messages.send`, which loads
  the approved text from storage and accepts `auto`, `default`, or `agent`.
  The composer draft mode is set to the approved mode — approving is the only thing that moves a thread
  out of `plan`, and without this the next user message would silently re-enter
  plan mode.
- **Keeping planning** (OS-1461) has no button of its own: the user types their
  feedback and sends it, which is the same thing a "Keep planning" press would
  have done. Sending while parked ends the run as **superseded** (see below and
  `docs/specs/cli-thread-cancel-processing.md`), leaves the composer in `plan`,
  and starts the next run with the feedback in it. Answering the gate with a
  generic "revise the plan" denial is deliberately not offered — it would let
  the run keep planning without the user's feedback.

## Answering with a message instead of the buttons

A run parked on a prompt is waiting on the user, not working, so sending a
message is a decision — not something to queue behind a prompt nobody will
answer. Submitting while any interaction request is pending stops the run
first (`cliThreads.cancelProcessing({ superseded: true })`) and then sends, so
the message starts a new run immediately instead of joining the queued strip
(OS-1458). The stop is superseded, not a user stop — the parked turn must not
flash a "Response stopped by user" error on its way out (OS-1461).

`cancelProcessing` cancels the thread's pending interaction requests
("response stopped by user") along with the run, so the prompt UI clears with
it instead of lingering until the lease expires.

Pressing **Stop** while parked is the same decision reached the other way: the
composer only offers Stop while it is empty, so a user who wants to type
something other than an answer stops first. That stop ends the parked run
without failing it — assistant message `completed` with no error, thread
`waiting_input`, no `thread.failed` event — because the run was the user's turn
all along. It differs from the send path only in where the thread lands
(`waiting_input`, since no message follows yet, versus `completed`). Queued
messages behind the stop keep the ordinary stopped-run outcome. See rule 10 in
`docs/specs/cli-thread-cancel-processing.md`.

## Idle timeout while parked

A run blocked in `canUseTool` emits no SDK messages for as long as the user
takes to answer, which the Claude runner's `IDLE_TIMEOUT_MS` (10 min) read as a
dead run and failed as `timeout_idle` — cancelling the very request the user was
looking at. The runner counts requests parked on the bridge and re-arms the idle
deadline instead of failing while that count is above zero (OS-1458). The Codex
app-server, OpenCode and Antigravity runners apply the same rule to their idle watchdogs:
while `pendingInteractionIds` is non-empty the activity clock refreshes instead
of SIGKILLing/aborting the parked run (OS-1463). Startup timeout, abort, and
lease expiry are unchanged.

## Losing the run while parked

Even a patient runner cannot outlive the process: a plan left overnight ends
with the laptop asleep, `convoy connect` restarted, or Ctrl-C. A run parked
on **any** interaction kind is the user's turn, so its death must not read as
failure (OS-1463):

- **Server wind-down rule.** `failStreamingChat` (watchdog lease expiry,
  session disconnect/replaced, claim release, thread delete) and
  `messages.fail` use the pending-request count returned by
  `cancelPendingInteractionRequestsForThread` as the "was parked" signal.
  Parked and no queued user messages → thread `status: "waiting_input"`
  instead of `failed`, and **no** `thread.failed`/`thread.waiting_input`
  event (request creation already notified the owner). Queued user messages
  keep precedence (`pending`, requeue). In `failStreamingChat` the active
  assistant message completes with no error; in `messages.fail` the message
  stays `failed` with its error text (the CLI reported a real reason) — only
  the thread status softens.
- **The user's own Stop reads the same signal, not the same mapping.**
  `cancelProcessing` shares the parked predicate (`isParkedWindDown`) but
  diverges after it: a stop **holds** its queue rather than requeueing it
  (OS-1374), so queued work lands `failed` + `queueHeldAt`, never `pending`;
  and a parked stop lands `waiting_input` while a superseded one lands
  `completed`. In both parked cases the assistant message completes with no
  error and no `thread.failed` event is emitted. See rule 10 in
  `docs/specs/cli-thread-cancel-processing.md`.
- **CLI abandonment keeps the row pending.** The bridge's `cancel` takes a
  structural `{ abandoned }` flag, not a display string. Abandonment
  (abort/shutdown/runner teardown) does NOT call
  `interactionRequests.cancel`: the pending row is exactly the parked signal
  the wind-down mutations consume, and a fire-and-forget cancel raced them
  nondeterministically. A provider-withdrawn request (`abandoned: false` —
  the run continues without it) still cancels its row. Every server
  wind-down path cancels the thread's pending rows itself, so nothing leaks.
- **Approve survives via the send path.** The plan panel keeps its approve
  buttons when the latest assistant message's `ExitPlanMode` part never
  settled (an orphaned gate) and the run is no longer live — either the
  thread is `waiting_input` (a clean wind-down) or the profile is offline (a
  hard-killed CLI leaves the thread `streaming` until the watchdog fires). With no
  live request to answer, `handlePlanDecision` degrades to sending
  "Implement the approved plan." in the approved mode; the preserved
  continuation id resumes the runtime session with the plan in its
  transcript. This does not reopen the OS-1467 misfire: the signal is the
  unsettled gate on a waiting thread, never the composer's mode.
- **A question survives the same way.** An unanswered `AskUserQuestion` on
  the same orphaned run comes back as the inline questionnaire, answered with
  a new message. Without it the card vanishes, and the user is left with a
  collapsed tool row and no copy of what was asked. See
  `docs/specs/cli-ask-user-question-ui.md#orphaned-questions`.

## Session capability

- CLI reports `supportsInteractiveApprovals` at registration (stored on
  `cliSessions`, surfaced in session list queries) so UIs can distinguish
  connections that will actually answer approval requests.

## Related Specs

- Mode mapping + execution: `docs/specs/cli-sdk-integration.md`
- AskUserQuestion inline UI (legacy waiting-input path): `docs/specs/cli-ask-user-question-ui.md`
- Cancel behavior: `docs/specs/cli-thread-cancel-processing.md`

## Local elicitation fixture

`apps/cli/scripts/elicitation/server.mjs` is an opt-in stdio test server with
`test_form` and `test_url` tools. It uses the client's advertised elicitation
capabilities, sends real `elicitation/create` requests, and echoes responses.
It has no timeout, persistence, account access, or listening port. Cancellation
withdraws the corresponding request and late answers are ignored.

The URL fixture uses Example Domain and tests explicit navigation and response
only. It does not simulate OAuth or verify browser-side completion. Setup,
removal, exact prompts, and protocol checks are documented in its adjacent
README. Registration is local to the workspace where the dev CLI runs.
