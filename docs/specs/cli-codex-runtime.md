# Codex Runtime Specification

This document defines how the `codex` CLI runtime executes and renders in Convoy. Two transports exist:

- **`codex app-server`** (default since OS-1659; introduced as an opt-in transport in OS-1109) — JSON-RPC transport adding interactive approvals, plan mode, live text/reasoning deltas, and the context-window meter.
- **`codex exec --json`** (opt in via `convoy connect --codex-exec`) — non-interactive JSONL, the v1 integration.

The transport is app-server unless the connection passes `--codex-exec`; there is no profile setting and no positive twin flag. The CLI downgrades to exec automatically when the detected codex predates 0.142.0, printing a warning — the default must not break machines with an older binary.

## Scope

- Execution of Codex runs in `apps/cli` (`src/agent/runtimes/codex/`).
- Backend normalization and metadata in `apps/web/convex/cli/lib/runtimes/codex/`.
- Frontend selector/mode/model metadata in `apps/web/lib/cli-runtime-ui/codex.tsx`.
- Devcontainer provisioning of the Codex CLI.

## Execution (apps/cli)

- The runner spawns the user's installed `codex` binary (never bundled). Resolution order: `CONVOY_CODEX_EXECUTABLE` env override, then `PATH`.
- Detection (`detectCodex`) runs `codex --version` and reports `{ type: "codex", version }` in the session's `availableClis`; machines without Codex simply do not advertise it.
- Invocation: `codex exec --json --skip-git-repo-check <mode flags> [--model <runModel>] [-c model_reasoning_effort="<runEffort>"] [resume <threadId>] -`
  - The prompt is always delivered over stdin (`-`), avoiding argv length limits.
  - `--skip-git-repo-check` keeps non-git working directories usable.
  - One `codex exec` process per assistant run; the runner yields one `ContentChunk { type, data }` per JSONL stdout line, with `type` mirroring the event's `type` field.
  - Non-JSON stdout lines are dropped (debug-logged), never stored.
- Continuation: the thread id from the `thread.started` event is the provider `continuationId`. Follow-up runs execute `codex exec ... resume <threadId> -`. Codex re-emits `thread.started` with the same id on resume.
- Failure: non-zero exit fails the run with the exit code and a bounded stderr tail; the continuation id is preserved on `RunnerExecutionError` so retries can resume.
- Abort: SIGTERM, then SIGKILL after 5s, always signalled to the whole process group (npm installs wrap the native codex binary in a JS launcher that cannot forward SIGKILL). An idle watchdog SIGKILLs the group after 10 minutes without stdout output. Abort also runs the per-run cleanup directly because the processor may abandon the runner generator mid-yield.
- Environment: inherits the process env minus `CONVOY_API_KEY` (must never leak into agent subprocesses).
- No partial streaming on the exec transport: `codex exec --json` emits whole items only, so streaming has no effect for exec-transport Codex threads.
- No interactive approvals on the exec transport: the exec runner ignores `interactionBridge`. Codex exec cannot prompt mid-run.

## App-Server Transport (default)

The Codex runner (only) speaks the `codex app-server` protocol unless the connection opts out with `convoy connect --codex-exec`. The choice is connection-level; the web cannot tell which transport a thread will run on, so approval-style modes silently degrade on the exec transport (see Modes).

- Protocol: newline-delimited JSON-RPC over stdio with bare `{ id, method, params }` messages (no `jsonrpc` envelope). Client: `apps/cli/src/agent/runtimes/codex/app-server-rpc.ts`; runner: `app-server-runner.ts`.
- Lifecycle per assistant run: spawn `codex app-server` → `initialize` (with `capabilities.experimentalApi: true`) + `initialized` → `thread/start` (or `thread/resume <continuationId>`) with `cwd`/`approvalPolicy`/`sandbox`/`model` → `turn/start` with the prompt as `input: [{type:"text", text}]` plus `model`/`effort`/`collaborationMode` → stream notifications until `turn/completed` → kill the process. A resume failure fails the run (same cross-machine limitation as exec).
- Chunk contract: `type` = the notification method (slash-separated, distinguishing app-server chunks from exec's dot-separated events), `data` = the notification params JSON. Forwarded: `turn/started`, `turn/completed`, `turn/plan/updated`, `item/started`, `item/completed`, `thread/tokenUsage/updated`, `model/rerouted` for the active thread/turn, `error`, plus (only when streaming is on) `item/agentMessage/delta`, `item/plan/delta`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`. `turn/plan/updated` forwards unconditionally: it is a full state snapshot, not partial text, so it does not gate on streaming. A synthetic `thread/started` chunk carries the thread id and resolved model, preferring the explicit turn override over the opened thread model. The live `thread/started` notification is not forwarded. Model attribution persists per assistant run; see [cost tracking](cost-tracking.md#codex-model-attribution-os-1529).
- Usage baselines, OS-1527: before a current turn ID is known, tag forwarded
  `thread/tokenUsage/updated` params with `convoyUsageBaseline: true`. Resume
  emits historical totals at that point. The backend persists them without
  recording spend or counting a run. Once the turn starts, notifications have
  no marker and use cumulative deltas. See [cost tracking](cost-tracking.md)
  for verified versions, token categories, and captured evidence.
- Delta coalescing (`codexChunkStreamPolicy` in `runtimes/codex/streaming.ts`): the three delta methods are deferrable, and consecutive deltas of the same method with the same thread, turn, and `itemId` merge by concatenating `delta`. Codex emits one delta per token, so without the policy every token became its own chunk row and one append could exceed Convex's transaction limits, stalling the message in `streaming` (OS-1761). See `cli-sdk-integration.md`.
- Server requests and async question items use the interaction bridge. Command
  approvals preserve available decisions and permission context; native
  permission grants and MCP form/URL elicitations have dedicated responses.
  Questions preserve provider IDs and custom/secret/blocking semantics.
  Async answers steer the originating thread without ending its turn.
  Provider resolution and turn completion clear matching prompts.
  The full contract is in [Interactive approvals](cli-interactive-approvals.md).
- Host-executed dynamic tools and external token refresh remain unsupported
  server requests and receive a method-not-found error.
- Steering (OS-1111): the runner implements `steer()` via the `turn/steer` RPC (`{ threadId, input, expectedTurnId }`), injecting a queued user message into the active turn; `expectedTurnId` makes codex reject steers against an ended turn, so a rejected steer falls back to the next run. Connections on the app-server transport advertise `codex` in the session's `steeringCliTypes`, which is what unlocks the web Steer button for codex threads. See `docs/specs/cli-steering.md`.
- Abort: graceful `turn/interrupt`, then process-group SIGKILL after 5s (and on generator teardown). Idle watchdog: 10 minutes without notifications.
- Failure: `turn/completed` with `status: "failed"` or a non-retried `error` notification fails the run with the provider message; unexpected process exit fails with the exit detail and stderr tail. The continuation id is preserved.

## Startup failures and authentication diagnostics, OS-2035

Unexpected exits during initialization, authentication, thread start/resume or
turn start carry the exit code or signal and recent stderr through the existing
`RunnerExecutionError` to the web message. An exit without stderr says no
diagnostic was reported. Spawn failures retain `launchFailed`; continuation IDs,
user cancellation and idle timeout retain their existing meanings.

Before native thread startup, Convoy reads `account/read` with
`refreshToken: false`. Only `account: null` together with
`requiresOpenaiAuth: true` blocks the run as unauthenticated. An authenticated
account or a provider that does not require OpenAI authentication proceeds.
An unsupported, failed, malformed or silent probe does not establish missing
authentication; the silent probe is bounded to five seconds. Managed credentials
continue through the existing explicit API-key setup, without this native probe.
The native response was checked against a fresh HOME with Codex 0.156.1.

Explicit missing/invalid authentication diagnostics include private project-shell
login instructions and the managed OpenAI API-key alternative. Managed failures
refer to the assigned key. An exit code, HTTP 403, permission error, configuration
failure or network failure alone does not imply missing authentication. The
original sanitized diagnostic remains available in the message.

Stderr collection retains the last 12 nonempty lines, capped at 512 characters
per line after redaction. Input lines over 8192 characters are discarded whole,
including their remaining fragments, so a truncated credential is never logged.
The collector flushes the last line at EOF. Diagnostic messages are capped at
6144 characters before recovery guidance. Managed credential values, recognizable
API keys, bearer/basic credentials, JWTs, credential assignments and URL userinfo
are redacted before logging, storage or truncation. Terminal control characters
are removed. These rules apply to diagnostic text, not arbitrary agent prose.

The runner uses the existing failure mutation and web error presentation. No
new backend fields or UI error renderer are required. Fake-process tests cover
the failure paths; managed-container/web acceptance is separate from local
process verification.

## AWS providers, OS-2105

A profile can assign Codex a Mantle or Bedrock Runtime key. The runner then
selects Codex's built-in `amazon-bedrock` or `amazon-bedrock-runtime` provider
per process, checks the effective config, and confirms the provider on every
thread open. Credentials, checks, failure messages and limits are specified in
`cli-provider-keys.md` → Codex on AWS Bedrock and Mantle. Verified against
codex-cli 0.156.1, including a live Mantle turn with `openai.gpt-6-sol` in
`us-east-1` and a 401 on a bad token.

## Subagents and source identity, OS-1962

Only the active root thread and turn can update the root turn ID, complete or
fail the run, change model attribution, or supply usage. Explicit stale turn
IDs and malformed lifecycle notifications are ignored. Older payloads without
a thread ID remain compatible when their turn matches. Global errors without
thread or turn identity retain their existing fatal-error behavior. Root
completion waits for registered active children before forwarding the root
completion and closing the queue. Spawned children count as active before their
first turn starts. Child completions cannot finish a still-running root. Stale
child terminal events cannot end a newer turn. While draining, child output and
approvals remain live and root steering is disabled. Root failure/interruption,
Stop, and the idle watchdog retain their termination behavior. An app-server exit
while children remain is a failed run. This preserves child findings in the
transcript; it does not create another root turn to synthesize them. Agents that
need to incorporate findings into their own answer must wait before finishing.
Notifications received while opening a thread are buffered until the root ID
is known, then classified in receipt order. File-edit approval changes are
cached before child routing, keyed by provider thread and item ID, so child
approvals retain their diffs even when item IDs overlap.

The CLI must be upgraded to receive these transport fixes. Version 0.61.0 adds
root/child isolation; 0.61.1 also preserves child approval diffs and handles
notifications received before root identity. A web deployment alone cannot
prevent an older CLI from ending the root run on a child completion.

The runner registers children from `thread/started` with
`source.subAgent.thread_spawn`, `subAgentActivity.agentThreadId`, or explicit
`collabAgentToolCall.receiverThreadIds`. It excludes the root provider ID and
paths `/root` and `/` on every registration path that carries a path. Registry
entries retain the provider parent thread and agent path. Late spawn metadata
corrects a parent inferred from earlier activity. Tool-call IDs and
provider thread IDs occupy separate namespaces.

Foreign notifications travel as `convoy/child` envelopes containing the original
`method`, `params`, and source identity. Their original lifecycle, usage, model,
plan, and continuation fields cannot reach root consumers. Unknown foreign
threads remain unregistered. The runner keeps the latest early lifecycle for
up to 128 unidentified threads and replays it after explicit registration.
A duplicate start cannot replace a terminal event for the same child turn.
Other early payloads remain in the raw envelopes with unknown scope.

Codex agent activity renders in one accordion per assistant message. It combines
`subAgentActivity` lifecycle notices with `collabAgentToolCall` operations.
Each child retains its provider thread ID, path, parent, and lifecycle state
inside the group. Root-path activity is silent. One child uses its path as the
accordion title; multiple children use an agent count. The group stays running
while any child or operation is active and exposes failures in its header.
Interrupted collaboration calls are unsuccessful terminal outcomes and show
as interrupted in the body. Normalized collaboration events carry an optional
`toolFamily: codex-collaboration` marker; the composer does not infer their
identity by parsing unrelated tools' JSON.

The expanded body shows each child's lifecycle event history, current status,
and available operation prompts/results. All collaboration operations, including
successful waits without results, remain visible inside the group. Grouping
must not discard event history or replace it with only the final status.
Consecutive identical lifecycle labels collapse to one visible entry per agent;
later transitions remain visible and the raw history retains every notification.
A wait with no receiver IDs stays at group level and is never assigned to a
guessed child. Full retained event payloads are inspectable through the collapsed
Show raw data control and copyable through the debug action. JSON is hidden
until requested. The same composition applies to retained normalized chunks.
The debug copy action reports success or clipboard failure.

Duplicate or late activity cannot reopen a completed child turn, and events
from an earlier known turn cannot overwrite a newer turn's status.
The child's explicit terminal outcome overrides a generic activity completion
for that turn, including failed and interrupted outcomes.
Late call completions can create a group without a preceding start; a later start cannot
reopen that call. When the parent run ends, unfinished child activity is marked
ended or interrupted, and unfinished operations stop spinning. Nested children
retain their parent ID and appear within the same accordion.

Child text and reasoning are intentionally absent from the main transcript,
agent-readable answer, and completion preview. Their normalized events retain
source identity. Child tools, plans, usage, and other state remain in raw child
envelopes without changing root presentation. The shared narrative contract
and Claude behavior are defined in [CLI SDK integration](cli-sdk-integration.md#narrative-source-identity-os-1962).

Root narrative events carry thread, turn, and item identity plus explicit root
scope. Child envelopes carry child or unknown scope. Coalescing requires the
same method, thread, turn, and item; child envelopes must also have the same
source. Child deltas use the normal ephemeral cleanup policy.

Source labels and collaboration markers are written during normalization.
OS-1962 does not repair historical narrative or collaboration events on read.
Readers need no extra database lookups for identity. Silent child metadata
omits the full provider payload, which remains in the raw chunk.

Validation uses fake app-server replay and normalization/composer tests. The
spawn metadata shape follows the local T3 capture and implementation inspected
for Codex 0.145.0 and the task's 0.153.4 investigation. No new live-provider
compatibility claim is made by these tests.

## Modes

The OS sandbox remains the safety knob; the app-server transport adds approval prompts and plan mode:

| Thread mode | exec transport (`--codex-exec`) | app-server transport (default) |
|---|---|---|
| `agent` (default, or unset) | `--dangerously-bypass-approvals-and-sandbox` | approvalPolicy `never`, sandbox `danger-full-access` |
| `default` ("Ask to approve") | `--sandbox workspace-write` (degrades: never asks) | approvalPolicy `untrusted`, sandbox `workspace-write` — approval cards for untrusted commands/edits |
| `auto` ("Sandboxed") | `--sandbox workspace-write` | approvalPolicy `never`, sandbox `workspace-write` |
| `plan` | `--sandbox workspace-write` (degrades: not read-only) | approvalPolicy `on-request`, sandbox `read-only`, `collaborationMode {mode:"plan"}` with plan-mode developer instructions |
| `acceptEdits` (not offered in UI) | `--sandbox workspace-write` | approvalPolicy `on-request`, sandbox `workspace-write` |
| `dontAsk` (not offered in UI) | `--sandbox workspace-write` | approvalPolicy `never`, sandbox `workspace-write` |

The UI offers Act / Ask to approve / Sandboxed / Plan for Codex. The internal mode value remains `agent` for compatibility. Every turn explicitly selects collaboration mode `plan` or `default`, independently of sandbox permissions. Mode settings use `developer_instructions: null` to select Codex's built-in instructions; the agent prompt and thread identity remain in thread-level `developerInstructions`.

The required mode model resolves from the explicit run selection, then the opened thread. For a new thread only, a missing model falls back to the advertised default from `model/list`. A resumed thread that reports no model requires an explicit user selection; it must not silently switch to the catalog default. The synthetic `thread/started` marker reports the same resolved model used by the turn. Empty catalogs and lookup failures produce an explicit error instead of silently dropping collaboration mode. Runtime commands such as `/compact` skip catalog lookup and collaboration-mode construction.

## Proposed plans (OS-1481)

Native `plan` items render in the shared plan panel. With partial streaming enabled, `item/plan/delta` appends to a draft keyed by turn and item id. Completion replaces the draft with authoritative text; later deltas cannot change the completed plan. These events are separate from the execution checklist and steps pill.

The chunk-insert path stores a bounded pointer in `cliThreads.metadata.proposedPlan`: assistant message id, provider turn/item ids, completed chunk id, and readiness. Markdown stays in the chunk. A matching successful `turn/completed` makes the pointer ready; message completion then sets `waiting_input`. Empty plans, interrupted/failed turns, and queued user messages do not become actionable. A new send clears the pointer. Historical plan panels remain in the transcript.

The plan footer offers Sandboxed as the primary action, Act in its joined dropdown, and Ask to approve beside it. Approval calls the ordinary send mutation with the proposal identity. The server checks ownership, project permission, thread idle/waiting state, absence of queued input or pending interactions, and the source message/chunk identity. It loads the stored markdown and sends "Implement the approved plan." followed by that text. Accepted approval modes are `auto`, `default`, and `agent`. The transaction consumes the pointer, so a duplicate or stale approval fails. The next run resumes the existing continuation with explicit default collaboration mode and the chosen execution permissions.

Feedback sends another plan-mode message. A later plan supersedes the prior proposal. Approval visibility follows the stored proposal and successful completion, never the composer's mode alone. Viewers have no approval controls. Claude's live approval bridge and orphaned-gate recovery remain separate paths using the same panel presentation.

Failed, stopped, disconnected, and watchdog-ended runs clear their proposal pointer. Releasing a claim after successful completion preserves a ready proposal awaiting approval. The panel and submission handler match the stored message, turn, and item identity; stale clicks show an error without sending.

Completed proposal text is also available to MCP message readers and notification previews. They exclude drafts and ephemeral rows and retain their existing scan and character limits.

The app-server integration needs no tag parser: Codex extracts the proposed-plan block. The exec transport has no proposed-plan support. Historical silent-metadata chunks are not reinterpreted into actionable proposals.

Compatibility was checked on codex-cli 0.142.0 and 0.153.4 using real app-server processes with a local mock Responses endpoint. Both preserved thread instruction markers alongside built-in plan instructions, emitted native plan items without duplicate assistant text, and appended default-mode instructions on a resumed turn. A separate 0.153.4 probe also preserved the instructions and continuation across an app-server process restart. These probes test protocol and prompt composition, not model behavior.

## Models

- Selectable slots: `default`, `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
- Retired slots `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark` are no longer offered in the model catalog. They remain valid for stored drafts, messages, favorites, and recent selections, keep their labels, and still resolve to `--model <slug>`.
- GPT-6 Astra, 6.1 Sol, Sol, and Luna appear first after `default`, labeled "GPT-6 Astra", "GPT-6.1 Sol", "GPT-6 Sol", and "GPT-6 Luna". Adding them does not change the default selection.
- GPT-5.6 Sol/Terra/Luna and older models keep the shared reasoning-effort catalog. Astra, 6.1 Sol, and Sol add `max` and `ultra`; Luna adds `max`.
- `default` sends no `--model` flag — Codex uses the machine's `~/.codex/config.toml` model.
- Every other slot resolves 1:1 to a `--model <slug>` argument.
- Unknown stored model values resolve to no run model (never leak into `--model`).
- On an AWS-assigned profile the catalog narrows to the AWS slots and resolves to AWS IDs. See `cli-thread-model-selection.md` → Codex on AWS.

## Reasoning Effort

- Base slots: `default`, `low`, `medium`, `high`, `xhigh`.
- `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-6-sol` also offer `max` and `ultra`. `gpt-6-luna` also offers `max`, without `ultra`. Sol and Luna levels come from the Codex model catalog (`~/.codex/models_cache.json`, client 0.155.1) inspected on 2026-09-24.
- GPT-6.1 Sol levels come from Codex's bundled catalog (`codex-rs/models-manager/models.json` on `main`) inspected on 2026-09-29. Its [model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) lists `low` through `max` for the API.
- For Astra, the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra) confirms the model ID and `low` through `max`. The Codex 0.153.4 model catalog inspected on 2026-09-07 also advertises `ultra`, described as maximum reasoning with automatic task delegation. No GPT-6 model offers `none` or `minimal`.
- Non-default efforts pass unchanged as `model_reasoning_effort` to exec and as `effort` to app-server. Plan mode also receives the effort in `collaborationMode.settings.reasoning_effort`. A `/goal <objective>` or `/goal resume` run sends no `turn/start`, so it sets the same `effort` and `collaborationMode` through `thread/settings/update` before the goal starts ([cli-thread-goal.md](cli-thread-goal.md#run-lifecycle)).
- Model-less storage accepts all known Codex efforts so GPT-6 selections survive a round trip. Option building and run resolution allow `max` and `ultra` only with an explicit GPT-6 model that offers them. Switching to an older, default, or unknown model drops those efforts.
- `default` continues to omit the effort override, leaving the connected machine's configuration in control. Machines running GPT-6 models need a Codex version and account that support it.
- Selection UI and storage/resolution rules: `docs/specs/cli-thread-effort-selection.md`.

## Event Normalization (apps/web backend)

`normalizeCodexChunk` maps JSONL events to `CliNormalizedEvent`:

| Codex event | Normalized event |
|---|---|
| `thread.started` | `metadata` with `sessionId = thread_id` (feeds continuation extraction) |
| `turn.started` | silent `metadata` |
| `turn.completed` | silent `metadata` carrying `usage` (input/cached/output/reasoning tokens) |
| `turn.failed` | `runtime-notice` (`codex-turn-failed`) with the raw payload in `detailsJson` |
| `error` | `warning` (`codex-error`) |
| `item.*` × `agent_message` | `text` on completion; silent `metadata` otherwise |
| `item.*` × `reasoning` | `reasoning` on completion; silent `metadata` otherwise |
| `item.*` × `command_execution` | `tool-input` (toolName `Shell`, `{command}`) on start; `tool-output` `{output, exitCode}` on success; `tool-error` on failure/non-zero exit |
| `item.*` × `file_change` | `tool-input` (toolName `Apply changes`, `{changes}`) on start; `tool-output`/`tool-error` on completion |
| `item.*` × `mcp_tool_call` | `tool-input` (toolName `server.tool`) on start; `tool-output`/`tool-error` on completion |
| `item.*` × `web_search` | `tool-input` (toolName `Web search`) on start; `tool-output` on completion |
| `item.*` × `todo_list` | `plan-progress` snapshot (`completed` → completed, everything else → pending; exec JSON has no in-progress status and none is guessed); silent `metadata` when the list is empty |
| anything else | `unknown` (raw JSON fallback rendering) |

App-server chunks are normalized by `normalizeCodexAppServerChunk` (`appServerEvents.ts`), dispatched from `normalizeCodexChunk` by the slash in the chunk type:

| App-server chunk | Normalized event |
|---|---|
| `thread/started` | `metadata` with `sessionId = thread.id` (feeds continuation extraction) |
| `turn/started` | silent `metadata` |
| `turn/completed` | `runtime-notice` (`codex-turn-failed`) when `turn.status === "failed"`; silent `metadata` otherwise |
| `error` | `warning` (`codex-error`, message from `error.message`) |
| `thread/tokenUsage/updated` | `context-window` (`usedTokens = tokenUsage.last.totalTokens`, `maxTokens = modelContextWindow`, plus input/cached/output breakdown); silent `metadata` when either is missing |
| `item/agentMessage/delta` | `text-delta` (ephemeral) |
| `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta` | `reasoning-delta` (ephemeral) |
| `item/*` × `agentMessage` | `text` on completion; the runner also bridges structured async questions |
| `item/*` × `reasoning` | `reasoning` on completion (`content` joined, falling back to `summary`) |
| `item/*` × `commandExecution` | `tool-input`/`tool-output`/`tool-error` like exec (camelCase fields; `declined` status is a tool-error) |
| `item/*` × `fileChange` / `mcpToolCall` / `webSearch` | `tool-input`/`tool-output`/`tool-error` like exec |
| `item/*` × `imageView` | lightweight `tool-input`/`tool-output` lifecycle (toolName `View image`, optional `{path}`); the UI shows the image-view activity and filename/path but does not load or render the image |
| `item/*` × `userMessage` | silent `metadata` (codex echoes the prompt as a thread item) |
| `item/*` × `sleep` | `sleep` lifecycle with item/turn/session identity and optional duration/timestamps; inline countdown and completion handling follow [Codex sleep](codex-sleep.md) |
| `item/*` × `contextCompaction` | `context-compaction`: `item/started` → in-progress ("Compacting…", `inProgress: true`), `item/completed` → "Conversation compacted"; the composer replaces the pending part in place so one compaction renders one separator (OS-1385) |
| `item/completed` × `plan` | `proposed-plan` with completed text and turn/item identity |
| `item/plan/delta` | `proposed-plan` draft delta, ephemeral and coalesced in the CLI |
| `item/started` × `plan`, `item/*` × `todoList` | silent `metadata` |
| `convoy/goal/snapshot`, `thread/goal/updated`, `thread/goal/cleared` | `goal` event plus a `goal-*` notice, root thread only ([cli-thread-goal.md](cli-thread-goal.md#codex)) |
| `turn/plan/updated` | `plan-progress` snapshot with exact statuses (`pending` / `inProgress` → `in-progress` / `completed`); silent `metadata` when the plan carries no usable steps |

- `toolCallId` is the Codex item id, pairing `tool-input` with its `tool-output`/`tool-error` in the composer.
- Exec chunks are never ephemeral; app-server delta chunks are (`isCodexAppServerEphemeralChunk`), so completion deletes their rows like OpenCode deltas.
- Local resume command: `codex resume <threadId>`.
- Plan/steps pill: both transports feed it. App-server `turn/plan/updated` carries the active step, so the pill reads "Step X/Y" against the real in-progress step; exec `todo_list` only distinguishes completed from incomplete, so the pill points at the first incomplete step. See `docs/specs/cli-thread-plan-progress.md`.
- Context-window meter: populated only on the app-server transport (from `thread/tokenUsage/updated`); `codex exec` usage lacks the model context window.

## Devcontainer

- `@openai/codex` is installed globally from `latest` by `postCreateCommand`, not in the image: a Dockerfile `RUN npm install -g` layer is cached, so rebuilds would freeze the version at whatever the first build installed.
- Host `~/.codex` is bind-mounted to `/home/node/.codex` so container Codex reuses host auth (`auth.json`), config, and sessions. The directory must exist on the host before starting the container.
- Strict-mode firewall allowlists the OpenAI/ChatGPT endpoint set (`api.openai.com`, `auth.openai.com`, `auth.api.openai.org`, `chatgpt.com`, `chat.openai.com`, `ab.chatgpt.com`, `persistent.oaistatic.com`); keep in sync with Codex releases.

## Known Limitations

- On the exec transport (`--codex-exec`, or an auto-downgrade from codex < 0.142.0): no mid-run approvals, questions, plan review, steering, live token streaming, or context-window meter — the default app-server transport provides all of these.
- The web UI offers approval-style modes (Ask to approve, Plan) regardless of transport; on an exec-transport connection they degrade to the sandboxed never-asks behavior.
- Codex has no live plan-approval gate. Proposed-plan approval starts a new turn, as described above.
- Codex quota is available through `/usage`. Automatic quota pills remain Claude-only because their persisted state has no account identity; see the account usage section below.
- Resuming a thread on a different machine than the one that started it fails (Codex sessions are stored locally per machine); the run fails with Codex's error and the user can start a fresh thread.
- The app-server protocol is experimental and may change between codex releases; the interaction additions were checked against the installed codex-cli 0.153.4 schema, while retaining older basic approval behavior.

## Related Specs

- Runtime subsystem layout: `docs/specs/cli-runtime-architecture.md`
- Claude execution behavior (reference runner): `docs/specs/cli-sdk-integration.md`
- Interactive approvals: `docs/specs/cli-interactive-approvals.md`
- Context-window meter contract: `docs/specs/cli-thread-context-window-meter.md`
- Model selection UI behavior: `docs/specs/cli-thread-model-selection.md`
- Reasoning-effort selection: `docs/specs/cli-thread-effort-selection.md`
- Thread modes: `docs/specs/cli-thread-modes.md`

## Native goals, OS-2277

The app-server advertises `/goal` and drives native Codex goals: read, set,
pause, resume and clear. Before Convoy reopens a thread it pauses an active
goal, so Codex never starts goal work unattended. Goal turns that Codex starts
by itself run inside the same Convoy run. Full contract:
[cli-thread-goal.md → Codex](cli-thread-goal.md#codex).

## Account usage on request, OS-2001

Codex app-server advertises `/usage` alongside `/compact`. The shared composer
also includes the locally implemented `/usage` before discovery, so it works as
a new thread's first message. The command uses
`account/read`, `account/rateLimits/read`, then `account/read` again after
initialization and authentication. It never opens, resumes or forks a Codex
thread, looks up a model, or starts a turn. It preserves the existing
continuation ID and returns no turn ID. The exec transport rejects the command.
Arguments are rejected. Runtime command boundaries keep it in its own queued
run; it cannot steer an active model turn.

`codex/usage/` owns RPC lookup, account checks and bucket parsing.
Its only runner interface creates per-execution state, receives account
notifications, and reads a report. Wiring outside that folder is command
discovery and the app-server runner. The shared message invariant checks runner
availability at create, send and edit/resend before accepting a Codex usage
command. `USAGE_RUNNER_OFFLINE` asks the user to reconnect. A runner that goes
offline after acceptance follows the existing queued-message lifecycle.

The runner emits a `convoy.account_usage` chunk containing the account, refresh
time and quota buckets. The Codex normalizer validates it into an `account-usage`
event; the stream composer carries it to the renderer registry. The isolated
`components/blocks/account-usage` module renders one card with quota rows and
a shared account-information control through its index export. Every reported primary and secondary window is shown,
including values below 80%. Bucket IDs are
stable keys; optional bucket names supplement them. The multi-bucket map
replaces the legacy single-bucket value for matching IDs. Window durations
come from the provider in minutes and display as weekly, daily, hour or minute
limits. Missing duration uses the primary/secondary label; missing utilization
or reset time stays explicitly unavailable. Reset timestamps are Unix seconds and convert to
milliseconds only for formatting; refresh time is local Unix milliseconds.
Invalid numbers stay unknown. Remaining percentage is 100 minus valid used
percentage. These values are subscription quota, not thread tokens or API cost.

The runtime account must be a ChatGPT account with a reported email. API-key,
missing or unidentified accounts produce an explicit unavailable error. The
account identity before and after lookup must match. `account/updated` reports
an auth mode and plan, not an account identity. The startup notification and
repeated notifications for an unchanged mode do not invalidate a lookup.
An observed change of auth mode, including logout and a change away and back,
invalidates the result. A completed login also invalidates it, even if the auth
mode stays ChatGPT. Before/after account reads detect identity or plan changes
within the same auth mode. `account/rateLimits/updated` updates the current lookup's bucket map.
This map is discarded on success, failure or timeout and never reused by a
later run. Lookup is bounded to 15 seconds after authentication. RPC failures
surface through the existing sanitized runner error path.

Each report retains its account and refresh timestamp in the stored snapshot.
The UI puts the email in an info-icon popover and omits the timestamp footer.
Previous messages remain history after an account
switch; they are never presented as the current account's state. Do not merge
these results into `metadata.usageLimits`, whose account-less per-window keys
cannot safely represent multiple Codex accounts or buckets. Claude's automatic
warning behavior is unchanged.

Protocol reference: [OpenAI app-server documentation](https://developers.openai.com/codex/app-server).
