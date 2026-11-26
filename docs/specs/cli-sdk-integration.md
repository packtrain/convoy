# CLI SDK Integration Specification

This document defines how `apps/cli` executes Claude Code. Claude execution is
backed by the official `@anthropic-ai/claude-agent-sdk` (`query()`); the
internal supervised-subprocess SDK (`apps/cli/src/agent/sdk/`) remains as the
generic execution layer reserved for future non-Claude runtimes (e.g. Codex).

## Scope

- Applies to `apps/cli` runtime behavior (`convoy connect`).
- Covers execution, streaming, continuation persistence, and fixture simulation mode.
- Claude-first scope: only `cliType = "claude-code"` is executable in this phase.
- Runtime metadata/parsing ownership in `apps/web` is defined separately in `docs/specs/cli-runtime-architecture.md`.

## Runtime Defaults

- `convoy connect` uses the Agent-SDK-backed Claude runner by default.
- The Agent SDK must execute the user's installed `claude` binary
  (PATH-resolved), never an SDK-bundled CLI, via `pathToClaudeCodeExecutable`.
  The `CONVOY_CLAUDE_EXECUTABLE` env var overrides the resolved path.
- Claude runs must load the user's filesystem settings and CLAUDE.md
  (`settingSources: ["user", "project", "local"]`) and the default Claude Code
  system-prompt/tool presets, matching direct `claude` CLI invocation. The
  Agent SDK's isolation-mode defaults must not silently apply.
- CLI detection warns (non-fatal) when the installed Claude Code major version
  is older than 2.x.
- If Claude CLI is unavailable on PATH, startup fails with a clear error.
- No implicit fallback to fixture streaming.
- Chat processing concurrency is bounded to `1-50`. Resolution order is the
  explicit `-c, --concurrency <n>` flag, the resolved profile's optional
  `concurrency` value, then the default `5`.
- The same concurrency behavior applies in real Claude mode and fixture `--stream` mode.
- Before registering, `convoy connect` prints the resolved profile config it will use for that session: profile key, display name, resolution source when applicable, Convex URL, project ID, masked API key, and configured paths.
- After registering, `convoy connect` prints detected CLI runtimes. For Claude Code, the line must include provider metadata and an explicit `Bedrock: yes` or `Bedrock: no` indicator based on the same provider detection stored in session `availableClis`.

## Fixture Simulation Mode

- `convoy connect --stream <jsonl>` enables fixture replay mode.
- Fixture replay preserves line-order and applies optional `--delay` pacing.
- Fixture mode remains the supported testing path for deterministic streamed outputs.

## Transport Contract

- Assistant stream chunks are persisted as raw `{ type, data }` records in `cliMessageChunks` (one DB row per chunk).
- `cliMessages` keeps one assistant envelope row per Thread run for lifecycle, status, claims, and conversion metadata.
- `cliMessages.content[]` remains canonical for user messages.
- Each Agent SDK `SDKMessage` is serialized to one JSON line; `data` is that
  raw JSON text and `type` is the message's top-level `type` field. SDK
  messages are byte-compatible with `claude --output-format stream-json`
  output, so the chunk pipeline is provider-invocation agnostic.
- Assistant envelopes track `nextChunkOrder` so chunk appends can stay incremental without rereading prior chunk rows.
- Assistant message reads in thread detail are split by responsibility:
  - `cliMessages.listByThread` returns envelope data and empty assistant `content[]`
  - normalized assistant render data is fetched from chunk queries
- No inline assistant-content fallback or migration is required; invalid old assistant rows may fail append-time streaming.
- For SDK subprocess stdout frames, `data` is persisted as raw JSON text (or text line fallback) and `type` is derived from the JSON `type` field when available.
- In `apps/web`, chunk normalization is dispatched by runtime through `apps/web/convex/cli/lib/runtimes/registry.ts`; Claude-specific normalization lives under `apps/web/convex/cli/lib/runtimes/claudeCode/`.
- This preserves compatibility with server-side conversion in `apps/web/convex/lib/cliMessageConversion`.
- On `cliMessages.startRunResponse`, the backend persists the executing CLI version (from the claiming session's `availableClis` entry matching thread `cliType`) into the created assistant message and the run's user messages when available.
- Claude `system` chunks with subtype `init` continue to feed run metadata.
- Claude `system` chunks with non-`init` subtypes must be preserved as user-visible runtime notices in the assistant thread UI, not dropped as debug-only warnings — except pure telemetry subtypes explicitly listed below.
- Runtime notices must render inline at their actual stream position in the assistant response timeline; they must not be extracted into a top-of-response summary bucket that reorders them.
- Claude `api_retry` notices must surface retry attempt/max-retries/delay information inline in the assistant message while retaining raw details for expansion/debugging.
- Claude `status` system events (e.g. `status: "requesting"`, permission-mode changes) are transient progress heartbeats: they normalize to silent `metadata` and never render inline. The compaction pair is the sole exception (OS-1593):
  - `status: "compacting"` normalizes to a pending `context-compaction` event ("Compacting…", `inProgress: true`) — it is the only signal that a compaction has begun, so without it the thread showed a bare "Streaming…" for the whole compaction. The paired `compact_boundary` replaces the pending part in place, so one compaction still renders one separator. Claude re-emits `status: "compacting"` every 30 seconds as a keepalive while a long compaction runs; the composer collapses every repeated pending event into the existing pending part, so keepalive ticks never add separators (OS-1909).
  - A cleared status (`status: null`) carries the outcome in `compact_result`/`compact_error`. `success` stays silent `metadata` — `compact_boundary` already reports it with trigger and token counts. `failed` normalizes to a resolving `context-compaction` event ("Compaction failed: {compact_error}." falling back to "Compaction failed."), because a failed compaction emits no boundary and the pending shimmer would otherwise never resolve.
- Claude `compact_boundary` system notices must normalize to first-class `context-compaction` events and render inline at their stream position. `context-compaction` parts render as a full-width separator marker with the message centered (not a collapsible notice card); a pending compaction (`inProgress: true`, emitted by runtimes with started/completed pairs like codex) renders the message as shimmer text until the completed event replaces it in place.
- Claude `compact_boundary` messages must include the compaction trigger and pre-compaction token count when `compact_metadata` provides them (e.g. "Context compacted automatically (was ~145,000 tokens).").
- Claude `vcs_state_changed` system events (repo state changed: e.g. `kind: "commit"`) are silent `metadata` in the thread and ephemeral in storage; the CLI consumes them live as a signal to refresh the thread's branch and PR snapshot mid-run (OS-1386, see `docs/specs/cli-thread-pr-badge.md`).
- Claude `code_change_published` system events (a PR/MR was published; payload carries `provider`, `url`, `repo`, `identifier`) render a one-line runtime notice (`claude-code-change-published`) and also trigger the CLI's mid-run branch/PR snapshot refresh (OS-1387).
  - The row uses only the event: the open-PR icon, "Opened pull request" (`action: created`; any other action reads "Published"), a chip with `{repo} #{identifier}` that opens `url` on GitHub in a new tab, and the `branch`. No JSON body. The event has no PR state; the icon is the open one because the agent just opened it (OS-2611).
  - A payload without `url` keeps the generic notice with the message "Published {repo}#{identifier}." and the JSON details.
- Claude telemetry events must stay silent: `thinking_tokens`, `hook_started`, `hook_progress`, successful `hook_response`, `status` system events, and non-authenticating `auth_status` without a nonempty error normalize to `metadata` events, which the assistant UI never renders. Raw payloads remain stored on the chunk row.
- Claude `commands_changed` system events (mid-session slash-command catalog updates, e.g. after `/reload-skills`) are likewise silent `metadata` — they are consumed by the slash-command inventory pipeline (`docs/specs/cli-runtime-commands.md`), never rendered in the thread.
- Claude `background_tasks_changed` system events remain silent `metadata` and ephemeral in chunk storage. OS-1443 projects the newest snapshot into thread metadata for the composer background-task pill, described below. `tasks[]` replaces membership; task lifecycle edges never determine the count.
  - The snapshot is also the Claude runner's **run-lifecycle gate** (OS-1661). Background agents run *in-process*, so ending the turn at its first `result` kills them: their output is lost, and because every follow-up turn resumes with `resume + forkSession`, Claude's orphan scan then synthesizes a `task_notification` with `status: "failed"` ("was running when the previous Claude Code process exited") against the **next** turn — a failure card for work the previous turn silently killed. So a run with a live in-process background task must not end at that `result`: it holds its input open, and the agent's completion notification wakes a fresh turn that streams the result normally. The snapshot empties to `[]` before that turn's own `result`, so the gate clears itself.
    - Membership is the intersection of the snapshot with the ids this turn spawned, tracked from the typed `task_started` edge events (only tool-spawned tasks carry a `tool_use_id`). The snapshot payload is undeclared in the SDK's types and is emitted by the separately-installed `claude` binary (observed on `@anthropic-ai/claude-code` 2.1.224), which `apps/cli` resolves from `PATH`/`CONVOY_CLAUDE_EXECUTABLE` and does not pin — so `task_type` alone must not decide the turn boundary. In particular the CLI registers its own backgrounded main session as a `local_agent` and the projection strips the `agentType` that would distinguish it; requiring a `task_started` means such an entry can never hold a turn open. Only `remote_agent` is excluded because it outlives the process. Spawned `local_bash` jobs must hold the turn open too. Closing the process at the foreground answer kills those jobs and produces orphaned-task notices on resume. Unknown task types also hold. A snapshot whose `tasks` is not an array is "unknown", not "empty": prior state stands and it is logged, because treating it as empty would clear the gate and restore the bug.
    - The wait is bounded by `BACKGROUND_AGENT_WAIT_MS` (1 hour default since OS-2285, was 30 min; override `CONVOY_BACKGROUND_AGENT_WAIT_MS`), checked **once per loop iteration** — not only at a `result`. A running agent emits `task_progress`, which keeps the loop consuming, so a result-only check never fires and the bound would not exist. While holding, the wait re-arms the idle deadline (as an interaction parked on the user does); on expiry the turn ends with an `convoy.background_wait_timeout` chunk — a first-class Convoy notice, not an impersonated `task_notification`, whose text would otherwise be dropped for generic "Claude reported task_notification." boilerplate.
    - Shell-only holds use `CONVOY_BACKGROUND_SHELL_WAIT_MS` (milliseconds; 30 minutes by default), starting at the first foreground result while shell jobs remain. Before that result they do not impose a new foreground execution limit. A live spawned agent takes precedence and retains the existing agent ceiling; when only shells remain, the shell deadline applies. Silent waits wake at the applicable deadline. Shell expiry emits `convoy.background_wait_timeout` with `taskKind: "shell"`, the configured duration, and an explicit shell-jobs-stopped notice. A persistent dev server or watch process can be ended with this turn; this bounded wait does not detach or preserve it. Run persistent services outside the agent turn or stop them before answering. Orphan notices are not suppressed.
    - A resume after such a stop replays the orphan `task_notification` as its own no-model turn (`num_turns: 0`) ahead of the prompt. Its `result` must not end the run, or the prompt is never answered. The runner stamps each prompt frame with a `uuid` and ends only at a `result` whose `user_message_uuids` contains one of them; a `task_notification` for a task this run never saw start counts as one pending orphan turn, and the next `result` without the prompt's uuid is skipped. CLIs that don't stamp `user_message_uuids` fall back to that count alone (OS-2094).
    - A held turn occupies one of `DEFAULT_MAX_CONCURRENT_CHATS` (5) worker slots while producing nothing, so the ceiling trades a thread's slot against losing the agent's work. An explicit abort/shutdown ends the turn at the next `result` without waiting — otherwise the graceful interrupt that preserves the continuation id is stranded until the 5s hard-abort fallback (OS-1463).
- Failure-ish variants of those events must surface as inline runtime notices: failed/blocking `hook_response` (`claude-hook-failed`) and authenticating `auth_status` (`claude-auth-status`).
- Claude `memory_recall` system events normalize to the first-class provider-agnostic `memory-recall` event (OS-1598). This is the one unmapped subtype that earns dedicated UI: it changes *how* the answer was produced, the SDK explicitly asks renderers to show it inline, and it needs structure a flat title/message cannot hold.
  - `mode` is renamed to describe the payload rather than the retrieval strategy: SDK `select` → `files` (the agent chose whole memory files; bodies are not shipped, so the renderer shows paths), SDK `synthesize` → `synthesis` (one authored paragraph in `content`).
  - Each entry carries optional `path`, `scope` (`personal | team`), and `content`. The synthesis sentinel path (`<synthesis:DIR>`) is dropped rather than passed through — it is not a file the renderer could open. Entries with neither a path nor content are dropped, and a recall that matched nothing at all is silent `metadata`, not an empty card.
  - Renders as a separator marker ("Recalled N memories" / "Recalled from memory" — the same treatment as `context-compaction`, because both mark a change in how the turn was assembled) above a collapsed disclosure listing each memory's scope, path, and inline body when present. Kept in storage: it is a durable record of the turn's inputs.
- Claude `local_command_output` system events normalize to a plain `text` event and render as assistant prose (OS-1598). The SDK's own guidance is "Displayed as assistant-style text in the transcript": it is the direct answer to a slash command the user just typed, so no new event kind, no new renderer, and no collapsed card hiding the requested output. Blank content stays silent `metadata` instead of an empty text part. Note that column-aligned output (e.g. `/cost`) loses its alignment in a proportional font; if that reads badly in practice the fix belongs in the text renderer, not in a different event shape.
- Claude `/goal` (OS-2276). A root `assistant` reply with `local_command_run.command: "goal"` normalizes to a `goal` event (`set`, `report`, `cleared`) plus a `goal-set`, `goal-status` or `goal-cleared` notice, replacing the text event. A root text-only `user` chunk `Stop hook feedback:\n[X]: R` was silent metadata. It now emits a `goal` `check` event and a `goal-check` notice ("Goal not met yet"). Without the `[X]: ` prefix it is a user Stop hook and emits a `stop-hook-feedback` notice only. A `result` with `terminal_reason: "completed"` and a completed outcome adds `goal` `run-completed`. Parsing rules, fold and goal button: `docs/specs/cli-thread-goal.md`.
- Claude `plugin_install` system events follow the `hook_response` rule — only the failure is worth a card (OS-1598). `started`, `installed`, and `completed` are session-start housekeeping superseded by the terminal event: silent `metadata`, ephemeral in storage. `status: "failed"` is the only record that a plugin the user configured is not loaded and it carries error text, so it renders a `claude-plugin-install-failed` notice ("{name}: {error}", falling back to "{name} did not install.") and must outlive ephemeral cleanup — the same carve-out shape as a failed compaction `status`. Because the clean path renders nothing, N failed plugins produce N independent notices; there is no single row progressing through statuses.
- Claude `notification` system events are priority-gated (OS-1598). The payload is already a finished human-readable sentence, so `high` and `immediate` render a `claude-notification` notice using `text` verbatim, and are kept in storage. `low` and `medium` are silent `metadata` and ephemeral: the SDK mirrors the interactive REPL's auto-dismissing queue (hence `timeout_ms`), and a thread transcript has no auto-dismiss, so a low-priority notice would become permanent history. A notice above the threshold with no `text` has nothing to render and stays silent.
- Claude `session_state_changed` system events are silent `metadata` and ephemeral in storage (OS-1598). Like `background_tasks_changed` this is a **level** signal — the whole state (`idle | running | requires_action`) re-emitted on every transition, with no outcome to report — and the thread already derives turn state authoritatively from message status and the `result` chunk. (Emitted only under `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`, which `apps/cli` does not set.)
- Claude `elicitation_complete` system events are silent `metadata` and ephemeral in storage (OS-1598). An elicitation is an MCP server asking the *user* for input mid-run, modelled as a control request answered via the SDK's `onElicitation` callback (structurally the same channel as `canUseTool`); this message only reports that a URL-mode elicitation finished. Its payload is two bare identifiers (`mcp_server_name`, `elicitation_id`) with no outcome, value, or error, so a card could only restate an id. The paired request uses the `onElicitation` interaction bridge described in [interactive approvals](cli-interactive-approvals.md).
- Claude `post_turn_summary` system events are silent `metadata` (OS-1598). The subtype is marked `@internal`, is absent from the exported `SDKMessage` union, and is intercepted by the SDK's own reader before being yielded to consumers, so it cannot reach a chunk row through `query()` — mapping it to UI now would be untestable dead code. It is nonetheless the richest status signal the SDK defines (`title`, `description`, `recent_action`, `needs_action`, and a `status_category` of `blocked | completed | review_ready` that maps almost 1:1 onto Watch Tower's `watchStatus` buckets); real UI is tracked in OS-1610, gated on verifying reachability first.
- Claude `prompt_suggestion` chunks normalize to silent `metadata` carrying the suggestion text under `promptSuggestion` (OS-1598). Their top-level `type` is `prompt_suggestion`, **not** `system`, so they never reach the system-subtype switch — before this they fell through to the `unsupported-type` branch and rendered the louder "Unsupported CLI event" card. A predicted next prompt is a composer affordance, not transcript content: rendering last turn's guess as permanent history is wrong. The clickable affordance is tracked in OS-1609, which also has to pass `promptSuggestions: true` from `apps/cli` before any of this is reachable.
- Claude `command_lifecycle` chunks (a queued prompt's `queued` / `started` / `cancelled` state) normalize to silent `metadata`. Like `prompt_suggestion`, the top-level `type` is not `system`; without its own branch it rendered one "Unsupported CLI event" card per state change.
- The generic unmapped-subtype fallback (`claude-system-<subtype>`, "Claude runtime notice", "Claude reported {subtype}.") stays as it is, deliberately (OS-1598). Its noise is the point: the card is how anyone learns that Claude emitted something this repo does not handle, including subtypes future SDK releases add. Silencing it was considered and rejected — a silent fallback means new subtypes arrive invisibly with nobody to notice them. The accepted cost is that unmapped events stay noisy until mapped.
- Claude `rate_limit_event` chunks normalize to first-class provider-agnostic `usage-limit` events (usage is account state, not a conversation event): `window` (`five_hour` → `5h`, `seven_day`/`weekly` → `weekly`), `utilization`, `resetsAt`, `isUsingOverage`, `status`, raw payload in `detailsJson`. Events without `rate_limit_info` stay silent `metadata`.
- `usage-limit` events never render as inline cards. The thread footer shows a usage pill per rate-limit window next to the context-window meter, driven by the latest snapshot per window (persisted on `cliThreads.metadata.usageLimits` at chunk insert, since the loaded chunk window is bounded; OS-1889, `docs/specs/cli-thread-context-window-meter.md`): hidden below 80% utilization, warning tier at 80–95%, critical at ≥ 95% or when using overage; the pill shows the window label, percentage, relative reset time, and an overage suffix, with details in a popover.
- Inline, only a severity escalation per window (none → warning, warning → critical) surfaces a single collapsed runtime-notice line (`usage-limit` code); same-tier repeats stay silent, and severity tracking persists across messages within a thread.
- Claude `permission_denied` system notices surface as `claude-permission-denied` ("Tool blocked") runtime notices; `files_persisted` and `mirror_error` surface as `claude-files-persisted` / `claude-mirror-error` notices.
- Claude `tool_progress` chunks normalize to first-class `tool-progress` events (`toolCallId`, optional `toolName`/`elapsedSeconds`/`parentToolUseId`). They are persisted for future live-progress UI and are not rendered yet.
- Claude checklist tools normalize into provider-agnostic plan events instead of `tool-input`, so they drive the composer steps pill rather than an inline card per update. `TodoWrite` becomes a `plan-progress` snapshot; `TaskUpdate` becomes a `plan-step-update` patch from its input; `TaskCreate`/`TaskList` calls go silent and their **results** carry the plan (`TaskCreate`'s id exists only there), normalized per result block so sibling tool results in the same chunk are preserved. Subagent calls (`parent_tool_use_id` set) and empty lists keep the plain tool call. See `docs/specs/cli-thread-plan-progress.md`.
- Claude `tool_use_summary` chunks surface their summary text as a `claude-tool-summary` runtime notice.
- Claude `system` `init` metadata additionally captures `slash_commands`, `agents`, and `plugins` when present.
- Claude `result` chunks with an error subtype or `is_error: true` must bundle a `claude-result-error` runtime notice alongside the result metadata, except for interruption. See the terminal outcome rules below.
- Read-time re-normalization: `result`/`system`/`rate_limit_event`/`auth_status` chunks and chunks whose stored normalized event is `unknown` are re-normalized on read, so improved mappings apply retroactively to existing threads without a data migration.
- Consecutive Claude task lifecycle notices (`task_started`, `task_progress`, `task_notification`) for the same execution must collapse into one inline grouped notice that stays anchored at the position of the first lifecycle event while later events update that existing inline card.
- Claude `task_updated` system events are **patches, not events** (OS-1597): the payload is `{ task_id, patch }` where `patch` holds only the fields that changed (`status`, `description`, `end_time`, `total_paused_ms`, `error`, `is_backgrounded`), documented by the SDK as "Clients merge into their local task map". They must never render as a standalone card — they carry no `tool_use_id`, description, or summary of their own, so a card for one can only say "something changed", and the SDK emits several per subagent.
  - They fold into the lifecycle group for their `task_id`, top-level or nested. Correlation is on `task_id` **alone**: a patch has no `tool_use_id`, so its group key is a bare `task_id` while its siblings key on `task_id::tool_use_id` — keying on the group key would open a second, sibling group.
  - `patch.status` is read from the patch, not the top level (where the edge events carry it), and adds a status the edge events never emit (`killed`). The last status-bearing notice wins, whichever subtype carried it.
  - A patch whose `task_id` has no group is dropped as silent state — nothing renderable to fall back to. This also covers `skip_transcript` tasks and runs whose `task_started` predates the current assistant message.
  - Storage: ephemeral, because intermediate patches are superseded by the terminal `task_notification`. Two carve-outs must outlive ephemeral cleanup: `patch.error` is the **only** place a failed task's error text appears (`task_notification` has `status`/`summary`, never `error`), and `is_backgrounded` is only observable here. Both surface in the grouped card (error row, "backgrounded" title suffix).
- Claude task lifecycle events carrying `skip_transcript: true` (`task_started`, `task_progress`, `task_notification`) are ambient/housekeeping work and normalize to silent `metadata` — the SDK documents them as "Consumers should hide this from the inline transcript; it may still appear in a tasks panel". They must not produce a grouped card.
- Claude normalized `tool-input`, `tool-output`, and `tool-error` events must preserve top-level `parent_tool_use_id` as `parentToolUseId` when present so spawned sub-agent child calls can be re-associated with their parent sub-agent tool in the thread UI.
- The parent sub-agent tool may be named `Task` or `Agent`; both names map to the same grouped thread-card behavior.
- Unknown or unrecognized CLI chunks (including `no-recognized-content-blocks`) must preserve the original raw chunk payload in normalized data so the assistant UI can render an inspectable inline notice with the exact event body and a copy-debug-info action.
- The assistant UI may suppress an unknown nested Claude `user` text chunk only when it can prove the chunk is a duplicate of a task lifecycle prompt already rendered for the same `tool_use_id`.
- Claude `result` chunks never emit context-window events: `result.usage` is cumulative API/cost usage for the whole run, not the current context size, and stays in result metadata for the cost pipeline.
- Top-level `assistant` chunks bundle a max-less `context-window` event from `message.usage` (prompt size of that API call), so the meter moves once per API call during a turn (OS-1900). Subagent messages (`parent_tool_use_id`) emit none.
- After each `result` the runner queries the Agent SDK `getContextUsage()` control request while the query is still active and emits a durable synthetic `convoy.context_usage` chunk (`{ usedTokens, maxTokens }`, from SDK `totalTokens` / effective `maxTokens`), which normalizes to the provider-agnostic `context-window` event for the shared thread footer meter. The request may take several seconds and must remain pending until it resolves or the run is cancelled/closed; rejection, unsupported Claude versions, or non-positive values skip the snapshot without failing the run. See `docs/specs/cli-thread-context-window-meter.md`.

## Partial Event Streaming (default on)

Live token-level streaming of assistant output to the web UI (OS-991).

Toggle:

- On by default per CLI connection since OS-1659; opt out with
  `convoy connect --buffered` (also honored by the smart-default `convoy`
  entry, and in either flag position). There is no positive twin flag —
  passing nothing already means streaming.
- A profile may set `streaming = false` in `~/.config/convoy/config.toml` to
  default it off; `--buffered` takes precedence over the profile value.
- The internal option is named provider-neutrally (`partialStreaming`); future
  runtimes (Codex, …) must reuse the same switch.
- The choice is reported at session registration as
  `cliSessions.supportsPartialStreaming` and surfaced in session list queries.
- When enabled for Claude runs, the runner passes Agent SDK
  `includePartialMessages: true`, which emits `stream_event` messages between
  the whole `assistant`/`user` messages.

Delta transport protocol (CLI → Convex):

- One in-flight `appendRunContent` per assistant message; never concurrent
  appends for the same message.
- Chunks arriving while a send is in flight accumulate in a CLI-side buffer and
  go out together in the next call (`chunks[]` batch).
- Deferrable chunks (runtime-defined; Claude: `stream_event`) wait for a flush
  window: ~250ms since last flush or ~16KB buffered. Whole messages, tool
  lifecycle, and result chunks flush immediately.
- Redacted thinking progress is dropped in the Claude Code runner and never
  reaches Convex: `system`/`thinking_tokens` frames and `thinking_delta`s with
  empty `thinking` (both carry only a token estimate, about one pair per second
  of thinking). Nothing rendered them, and `thinking_tokens` forced an
  immediate flush, so each second of thinking cost a mutation and two rows.
- Consecutive `text_delta`/`thinking_delta` deltas for the same content block
  are coalesced into one chunk before sending (per-token rows have no rendering
  value). The coalescing policy is owned by the runtime
  (`ChunkStreamPolicy` in `apps/cli/src/agent/runtimes/contracts.ts`), and every
  runtime that streams deltas must define one — Claude Code, Cursor, OpenCode,
  Codex. A delta-streaming runtime without a policy treats every token as
  non-deferrable, so nothing coalesces (OS-1761). The policy's `text`,
  `withText` and `stream` let the buffer hold back a delta's ending that could
  start a provider token (see `cli-provider-keys.md`, OS-2109). Claude
  `input_json_delta` deltas for the same block coalesce too; the web does not
  render them live.
- One send carries at most 256 chunks and ~1 MiB of `data`; a batch over either
  cap is split and the remainder goes out in the next send, immediately (the
  remainder counts as urgent, so it does not wait a flush window). The server
  inserts one row per chunk in a single transaction, so an unbounded batch
  exceeds Convex's system-op and data-written limits and can never commit —
  which stalls the message in `streaming` forever (OS-1761). A single chunk
  above the byte cap is still sent alone. This is a runtime-agnostic backstop;
  coalescing is what keeps normal batches small.
- A send that fails outside the app is resent, same batch, up to four times
  after waits of 1, 2, 4 and 8 seconds. Convex reports a stalled database as
  `Your request timed out performing too many system operations.` once a
  function has spent 15 seconds in syscalls, and an overload the same way;
  neither says anything about the run, so neither may end it. A failed mutation
  never committed, so the resend cannot duplicate rows, and it stays inside the
  one in-flight send, so order holds. A `ConvexError` is the server's own
  verdict (claim lost, message gone) and fails the run at once, as before. Once
  the resends run out the run fails with the last error. Stopping the buffer
  cancels a pending resend. Other mutations of a run (`startRunResponse`,
  `complete`, `fail`, notices) are not resent.
- Coalescing stops once the merged chunk reaches 32KB; the next delta starts a
  new chunk (OS-1521). Without the cap, deltas accumulating behind a stalled
  send (network hiccup, Convex reconnect) could grow one chunk past the
  server's per-row storage budget and fail the whole append. The server also
  defends independently: oversized `stream_event` delta chunks are split back
  into smaller deltas at insert time (see `cli-message-chunks-storage.md`), so
  older CLIs without the cap cannot kill a stream.
- Non-deferrable chunks over the server's 100k-char storage budget are
  scrubbed before upload (OS-1521): base64 payloads are dropped (both
  Anthropic `type:"base64"` source blocks and bare `base64` keys such as
  Claude's `tool_use_result.file.base64`) and other huge strings clamped with
  a truncation notice — trying the widest per-string cap that fits, so
  barely-over chunks keep most of their content. A chunk the scrub cannot
  bring under the budget (many medium strings, non-JSON data) is raw-truncated
  to the budget, matching the server's insert-time fallback, so oversized data
  never leaves the agent machine. This covers tool results that inline whole
  files — a `Read` of an image would otherwise ship megabytes per chunk and
  blow Convex's document/argument limits. The scrub is a structural JSON walk
  with a base64-block heuristic and runs in the shared flush buffer
  (`apps/cli/src/agent/app/chunk-scrub.ts`), so every runtime — Claude Code,
  Codex, OpenCode, Cursor — gets it. Deferrable delta chunks are exempt:
  coalescing caps them, Claude Code's server-side splitter recovers oversized
  deltas losslessly, and other runtimes' token-sized deltas are covered by the
  server backstop. The server applies the same scrub at insert time for older
  CLIs.

Normalization (`stream_event` chunks):

- `content_block_delta` + `text_delta` → `text-delta`; `thinking_delta` →
  `reasoning-delta` (new provider-agnostic normalized event kinds).
- Child deltas preserve `source.parentToolUseId` and child scope. The composer
  suppresses their text and reasoning under the shared narrative policy below.
- `content_block_start` for a `thinking` block → empty `reasoning-delta`. It is
  the live "Reasoning" marker, because the CLI never sends redacted thinking
  progress (see below).
- `input_json_delta`, `signature_delta`, `message_start/stop`, other
  `content_block_start`, `content_block_stop`, and `message_delta` stay silent `metadata`
  (usage payloads preserved in `otherJson`; the live meter reads the
  `assistant` message's usage instead, OS-1900).

Redundancy cleanup (ephemeral chunks):

- `stream_event` chunk rows are marked `ephemeral: true` at insert (runtime
  hook `isEphemeralChunk`); they are fully superseded by the whole `assistant`
  chunk that follows.
- Pure-telemetry `system` chunks (`thinking_tokens`, `hook_started`,
  `hook_progress`, `status`, `commands_changed`, `vcs_state_changed`,
  `background_tasks_changed`, `session_state_changed`, `plugin_install`,
  `notification`, `elicitation_complete`) are also
  marked ephemeral:
  they only matter while
  streaming and would otherwise dominate the historical chunk window (a short
  run can emit dozens of `thinking_tokens` heartbeats, starving pagination of
  renderable rows). Meaningful `system` subtypes (`init`, `hook_response`,
  `compact_boundary`, `api_retry`, `memory_recall`, `local_command_output`, …)
  are kept. Three carve-outs must outlive cleanup because they render inline:
  a `status` row reporting `compact_result: "failed"` (the only record of that
  failure, OS-1593), a `plugin_install` row with `status: "failed"`, and a
  `notification` row whose `priority` is at or above the render threshold
  (OS-1598) — deleting either of the latter two would drop the row out from
  under a card still on screen. Pre-existing stored telemetry rows are removed
  by the `deleteTelemetryCliMessageChunks` migration.
- `cliMessages.complete` schedules a batched internal cleanup that deletes the
  message's ephemeral rows. `fail` keeps them — for a failed run the deltas are
  the only record of partial output.
- A client delta cursor anchored on a deleted ephemeral row triggers the
  existing `resetRequired` rebootstrap path.

Client composer merge:

- `text-delta`/`reasoning-delta` events append into a growing text/reasoning
  part while streaming.
- Legacy events without item identity replace legacy drafts when final content
  arrives. They cannot remove drafts with explicit item identity.
- Identified events follow the source contract below.

## Narrative source identity, OS-1962

The shared text, reasoning, and delta validators accept an optional `source`
with provider `threadId`, `turnId`, `itemId`, `parentThreadId`,
`parentToolUseId`, and `scope`. Scope is `root`, `child`, or `unknown` when the
transport can classify it. Fields are optional because runtimes expose different identities.

The main transcript intentionally suppresses child and unknown-source
narratives. Claude whole text/thinking blocks and deltas retain their parent
tool identity, so a child completion cannot erase a parent draft. Existing
nested Claude tool cards keep their current grouping. OS-1973 owns further
Claude rendering against this contract.

Root text and reasoning with item identity have independent draft parts keyed
by kind, provider thread, turn, and item. A completion replaces only that part.
An empty completion removes its draft or creates no visible part, while still
marking the item complete. Duplicate completions replace in place; later
deltas cannot reopen a completed item. Different items never concatenate.
Legacy unkeyed events retain their existing concatenation behavior but cannot
merge into an identified part or delete an identified draft.

UI, agent transcript, and notification readers use the normalized source
labels and share the foreign-source exclusion predicate. Child narratives,
including entries in bundled events, stay excluded from exported text and
previews. Readers do not reconstruct missing source labels or collaboration
markers from old raw payloads, and do not fetch message or thread records for
that purpose. OS-1962 targets newly ingested events; historical compatibility
is not required before release. Existing bounded scans remain unchanged.

## Continuation Contract

- As soon as Claude emits a session-bearing chunk, `cliMessages.appendRunContent`
  must persist it on the assistant message as:
  - `cliContext.continuationId`
- CLI stores provider continuation metadata in `cliMessages.complete` as:
  - `cliContext.continuationId`
- If a Claude run observes a continuation and later fails, CLI must persist that
  observed continuation in `cliMessages.fail` as:
  - `cliContext.continuationId`
- `cliMessages.complete` and `cliMessages.fail` must preserve an already stored
  `cliContext.continuationId` when called without `cliContext`.
- Before each Thread run, CLI resolves the latest continuation from the newest
  assistant message, including failed or streaming assistant turns, via:
  - `cliMessages.getLatestContinuationForThread`
- No fallback to chunk storage or older assistant rows is required. If the
  newest assistant message has no persisted continuation id, the thread is not
  resumable.
- Claude follow-up runs use the Agent SDK `resume: <continuationId>` +
  `forkSession: true` options (equivalent to `--resume … --fork-session`).
- If a Claude run reports completed status but no `session_id`/`sessionId` is observed in output, run completion must fail.

## Attachment Execution Contract

- Before each run, CLI resolves unprocessed user message attachments to local files via a thread-scoped cache:
  - `~/.cache/convoy/thread-attachments/<threadId>/<storageId>__<sanitizedName>`
- Non-image attachments must be represented in prompt text using local paths.
- For supported image MIME types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), CLI passes the bootstrap user message as Agent SDK streaming input (an async-iterable `SDKUserMessage` prompt, equivalent to `--input-format stream-json`) with content blocks containing:
  - text context block
  - image blocks with `source.type = "base64"` (`media_type` + base64 `data`)
- Unsupported image MIME types fall back to prompt text path context.
- Cache files are reused across continuation runs and GC'd by last access with a 7-day TTL.

## Mode Mapping Contract (Claude)

- CLI message mode must be mapped to Claude runtime permission behavior via Agent SDK options:
  - `agent` -> `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` (legacy full-access value)
  - `plan` -> `permissionMode: "plan"` + `systemPrompt: { type: "preset", preset: "claude_code", append: <plan-mode constraints> }`
  - `default` / `acceptEdits` / `auto` / `dontAsk` -> the same-named Agent SDK `permissionMode`
- `mode` in prompt text is informational and must not be the only signal for runtime mode behavior.
- The plan-mode appended prompt instructs the agent to operate in read-only mode: no file creation, modification, or deletion; no state-changing commands; exploration and planning only.
- Non-bypass modes install the SDK `canUseTool` callback backed by the interactive-approval channel and run with open-ended streaming input; see `docs/specs/cli-interactive-approvals.md`. Without a bridge, permission prompts auto-deny like headless `claude -p`.
- Steer-enabled runs (all Claude runs started by the CLI, including bypass/`agent` mode) also hold the streaming input open so queued user messages can be injected mid-run; injected messages are usually absorbed into the running turn, so a steered run ends by closing the input at the first `result` and draining to natural stream completion (which may include an extra `result` for a late-queued turn). See `docs/specs/cli-steering.md`.

## Unsupported CLI Types (Phase 1)

- If a claimed thread has `cliType !== "claude-code"`, CLI starts the assistant run target and marks it failed with an explicit unsupported-type error.
- This keeps each thread's run behavior deterministic while non-Claude executors are not yet enabled.

## Chat Scheduling and Concurrency

- Pending chats are processed with bounded parallelism up to the configured concurrency cap.
- `profiles.<key>.concurrency` is an optional integer from `1` through `50`;
  omission preserves the default cap of `5`, while an explicit connect flag
  overrides it for that run.
- A single thread remains single-claimed and processes its runs sequentially under that claim.
- Duplicate queue inserts for already queued/active chats are ignored.
- CLI shutdown stops new dispatch, aborts active subprocess runs, and drains active workers before exit.
- A run that shutdown aborted ends `failed` with "CLI stopped during response generation", even when the runtime ended it cleanly (Claude's graceful interrupt). The continuation id is kept, and Retry requeues the prompt. Completing it instead would mark the prompt delivered, so it would never run again (OS-2098).

## Reliability Expectations

Claude runs (Agent SDK):

- The Agent SDK owns the `claude` child process; cancellation uses the run's
  `AbortController` plus `Query.close()`.
- Startup inactivity (no SDK message within 120s) and mid-run inactivity (no
  SDK message for 600s) must fail the run with an explicit timeout reason.
- The subprocess environment must strip `CONVOY_API_KEY` and pin
  `HOME`/`XDG_*` overrides so Claude auth/config resolution is stable.
- stderr output is captured (bounded tail) and included in failure messages.
- Runs whose `result` message reports an error subtype (or `is_error`) must
  fail run completion even if the stream ends cleanly, preserving any
  observed continuation id. Explicit interruption is exempt; structured failures
  also fail even when tagged success. See the terminal outcome rules below.

Generic subprocess layer (reserved for future non-Claude runtimes):

- SDK runtime provides process-group termination, timeout guards, line truncation, and bounded queue handling.
- SDK subprocesses run under a supervisor shim process with IPC control.
- Parent-side startup must complete an IPC handshake (`started` or `spawn_error`) with a bounded timeout before treating a provider run as started.
- If the parent CLI process exits unexpectedly and IPC disconnects, the supervisor must terminate the managed provider process group before exiting.
- Parent-initiated interrupt/terminate requests must be sent to the supervisor over IPC so provider runs can be interrupted/terminated without orphaning detached subprocess groups.
- Parent shutdown is completion-based with bounded safety watchdogs; it should prefer graceful cleanup while avoiding indefinite hangs.

Shared:
- CLI must continue to use existing chat-level claim/heartbeat/release invariants.
- Session heartbeats (`/api/agent/heartbeat`) and claim-lease heartbeats (`cliThreads.heartbeatClaim`) are separate signals and must both remain healthy during streaming.
- Streaming hot-path mutations (`cliMessages.appendRunContent`, `cliMessages.complete`, `cliMessages.fail`, and `cliThreads.heartbeatClaim`) must authorize against the already-established thread/message claim and must not read the `cliSessions` heartbeat row. `claimThread` and `startRunResponse` remain responsible for validating live session ownership before a stream starts.
- Releasing an active streaming claim must not leave the thread in `streaming`; it must normalize to a terminal/requeue state.
- User-initiated stop/cancel must cause prompt local subprocess abort when thread claim is no longer active.
- Concurrent cancellation races around `startRunResponse` (stale pending message snapshots) must be handled without crashing the chat processing loop.

## API Path

The `cliMessages` callable module lives in `convex/cli/messages.ts`, under the
`api.cli.messages.*` public paths
  (`send`, `startRunResponse`, `appendRunContent`, `complete`, `fail`,
`retry`, `listByThread`, `listEnvelopesByThread`, `listUnprocessedUserMessages`,
`getLatestContinuationForThread`, the attachment-upload mutations, etc.). The
bare `cliMessages.<fn>` names used throughout these specs are unchanged function
names. The `cliMessages` **table** name is unchanged.

## Related Specs

- Runtime ownership and extension rules: `docs/specs/cli-runtime-architecture.md`
- Thread composer context-window meter: `docs/specs/cli-thread-context-window-meter.md`
- Continuation metadata shape: `docs/specs/cli-message-context.md`
- Attachment behavior and web contract: `docs/specs/cli-message-attachments.md`
- Chunk storage and migration details: `docs/specs/cli-message-chunks-storage.md`
- AskUserQuestion inline UI behavior: `docs/specs/cli-ask-user-question-ui.md`
- Playground SDK transport baseline: `docs/specs/cli-agent-sdk-raw-transport.md`
- Thread cancel behavior: `docs/specs/cli-thread-cancel-processing.md`

## Claude interactions and terminal outcomes (OS-1972)

- Install `onElicitation` whenever the interactive bridge is available, including
  Act and Plan modes. Use the same tracked bridge as `canUseTool`, so a pending
  form or URL request suspends the idle timeout. SDK cancellation and connection
  teardown return `cancel`; server lifecycle mutations remove abandoned cards.
- An `auth_status` with a nonempty `error` emits one `claude-auth-error` notice,
  regardless of `isAuthenticating`. Include the error and distinct output lines,
  with the raw payload in details. Completed authentication without an error
  stays silent. Read-time normalization applies this to stored events too.
- Runner and UI use the same result precedence: explicit `aborted_tools` or
  `aborted_streaming`, or the legacy parked-interrupt diagnostic, is interrupted
  and has no failure notice. Otherwise HTTP 529 or a known failure terminal
  reason is failed, even with `subtype: success` and `is_error: false`. Existing
  error subtypes and `is_error: true` still fail. Other results are completed.
  Interruption ends the runner without throwing; the existing stop lifecycle
  determines the thread state.
- Known failure reasons are `blocking_limit`, `rapid_refill_breaker`,
  `prompt_too_long`, `image_error`, `model_error`, `api_error`,
  `malformed_tool_use_exhausted`, `budget_exhausted`,
  `structured_output_retry_exhausted`, `tool_deferred_unavailable`, and
  `turn_setup_failed`. Unknown reasons retain subtype/is_error behavior.
  `completed`, hook stops, deferred tools, `max_turns`, and
  `background_requested` do not independently imply failure.
- Structured failure text takes precedence over generic result text. Preserve
  errors/result text and the existing synthetic-assistant fallback when no
  structured reason supplies a message. Result metadata retains `terminalReason`,
  `apiErrorStatus`, and `resultOutcome` when either structured field is present;
  notice details retain the raw error fields.

### Version evidence and fixtures

Verified locally on 2026-09-23 with Agent SDK 0.2.112 and the PATH-resolved
Claude Code 2.1.281 binary. No dependency upgrade is required. The SDK declares
`onElicitation`, both result fields, and the older terminal-reason subset in
`sdk.d.ts`. Its `sdk.mjs` passes the callback the control request's abort signal
and aborts pending control requests during cleanup.

The installed `@anthropic-ai/claude-code/bin/claude.exe` contains result schemas
and serialization for both fields. Its terminal classifier explicitly names
all failure reasons above and identifies the two abort reasons as interruption.
This is binary inspection, not a captured production overload. Inline fixtures
in `claudeCode/sdk.test.ts` and `chunks/normalizedEvents.test.ts` are synthetic
representatives of those shapes: success + HTTP 529, success + terminal failure,
and error subtype + explicit abort. They verify the runner and UI independently,
which ship from separate applications. Live service failure reproduction is not
part of automated validation.


## Live background tasks, OS-1443

The composer shows a compact "N jobs" pill beside the usage and
context indicators while Claude or Codex has live jobs. Clicking it opens a
scrollable popover with descriptions and task-type icons. The popover header
says "Background tasks" without repeating the count. Use "1 job" for a single
job. The accessible name is "N jobs running", including the visible label. In narrow composers,
the trigger keeps the activity glyph and count, with the full accessible label.
Descriptions wrap;
unknown types use a generic icon. The open list updates as snapshots arrive.
An empty snapshot hides the pill and closes its popover. Escape closes the
popover and returns focus to the trigger. The activity glyph respects reduced
motion. There are no per-task cancellation controls or completed-task history
in this popover; results remain in the existing conversation cards.

### State and lifecycle

`background_tasks_changed.tasks` is the complete current set. Normalization
validates entries, deduplicates IDs, and preserves all task types, including
shell commands, remote agents, and housekeeping jobs. Missing descriptions
use the task-type label. Missing or malformed arrays and wholly invalid
nonempty arrays do not overwrite the previous snapshot. Child-process
snapshots do not replace the root process's membership.

`cliThreads.metadata.backgroundTasks` holds the active assistant message ID,
provider session ID when supplied, total task count, and task descriptions.
The chunk-ingestion fold replaces it with the last valid snapshot in arrival
order, including when several changes share a batch. Identical snapshots do
not write the thread. This uses the existing metadata subscription and adds
no chunk scans or query endpoints. Codex uses a synthetic snapshot chunk. Only the active
Claude or Codex assistant message on a streaming thread can update this projection.

A root `system/init` clears membership, including a restart with the same
provider session ID. Consumers do not depend on Claude emitting an empty
membership snapshot at startup. Starting a different run, changing the
claiming session, ending a stream, releasing a claim, or deleting the thread
clears the projection through the thread repository's lifecycle write path.
Completion, failure, stop, and watchdog recovery share those paths. Stop first
copies the last-known jobs into a separate shutdown confirmation record. Its
indicator remains available while waiting and after a 15-second timeout.
Confirmed shutdown disappears five seconds after acknowledgment. The composer
shows only one jobs/stop pill, with current live jobs taking precedence. See [runtime shutdown confirmation](cli-thread-cancel-processing.md#runtime-shutdown-confirmation-os-2046). Late
chunks from a previous run cannot repopulate it. A Claude `result` chunk alone
does not clear it: the runner keeps the process alive for spawned background
agents and shell jobs. The shell-job wait policy is included in CLI 0.80.1.
The UI also checks that the snapshot belongs to the active streaming message.

The CLI structurally bounds both providers' snapshots before generic transport
scrubbing. It sends at most 200 entries, descriptions up to 2,000 UTF-16 code
units, type names up to 128, and a serialized JSON budget of 60,000 characters.
Escaping counts toward that budget. Text truncation preserves surrogate pairs.
IDs over 512 characters are omitted from the display list. `total_count` retains
the full valid unique count separately from that list, including omitted entries.
The normalizer validates that count and applies its own entry/text caps.
The popover reports how many entries are shown when fewer than the total fit.
No data migration is needed; absent snapshots render nothing.

Metadata comparisons use Convex's canonical JSON encoding so object key order
does not cause redundant writes. Lifecycle clearing copies the caller's patch
rather than mutating it. The UI retains active-message and streaming guards.

### Module boundary and verification

`components/blocks/background-tasks/index.ts` exports only `BackgroundTasksPill`.
ThreadView passes current thread state through ThreadComposer to this module.
Backend entities stay in the shared validators, Claude normalizer, chunk fold,
and owning thread repository. The UI does not correlate task lifecycle edges
or reuse the runner's filtered set for deciding whether a turn can end.

Tests cover snapshot replacement and empty sets, malformed and child payloads,
unknown task types, count and text bounds, init ordering, stream completion,
failure, claim release/replacement, new-run isolation, query serialization,
composer mounting, live popover updates, and Escape focus restoration.

### Codex jobs

CLI 0.80.1 maps app-server lifecycle events to `convoy/background_tasks`
complete snapshots. The shared parser validates and caps their displayed list
at 200 entries while retaining the full count, just as for Claude. These chunks
are silent metadata and ephemeral. The runner emits only changed membership
or descriptions; a new root `thread/started` clears the projection.

Root `commandExecution` items count as running jobs from start to completion,
including failure or decline. The protocol does not provide a dependable
background-only flag, so foreground commands count too. Shell commands within
an agent are represented by that agent rather than counted twice.

Registered child turn starts and `subAgentActivity.started` add agents.
Completion, interruption and non-retried errors remove them. Collaboration
`agentsStates` supplies running/pending and terminal states without treating
wait calls or agent registration alone as new work. Unknown child envelopes
and the root thread never count as agents. Turn IDs reject late completed-turn
starts and stop an older completion from removing a newer active turn.
Known child-turn evidence takes precedence over unversioned activity and
collaboration reports. Those reports cannot resurrect a finished child or
remove a known active child turn; they remain a fallback for agents without
child lifecycle events. Terminal history is retained for this execute invocation
so late events cannot restore finished work. It is released when execution ends.
Root completion/failure and the existing thread stop/claim lifecycle clear jobs.

This support uses app-server events. Legacy Codex exec JSONL does not emit the
new snapshots. It does not infer detached shell processes from command text,
change Codex turn lifetime, or display finished jobs as still running.

## Account usage on request, OS-2002

Claude threads offer `/usage` before command discovery. A solo command becomes
a dedicated SDK control request, with no prompt frames, model turn, session
resume or fork. Arguments are rejected. The previous continuation ID survives
both successful and unavailable lookups. Runtime command boundaries keep the
request out of steering. An offline runner rejects create/send/edit-resend.

`claudeCode/usage/` owns parsing, account checks and the experimental
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` call. The SDK is pinned
to 0.3.295; `skipBehaviors` avoids scanning local transcripts. The runtime still
uses the runner's installed Claude executable, so an older executable can reject
the request. Account reads before and after lookup must identify the same
first-party subscription account. A 15-second deadline covers these requests;
SDK failures become a sanitized unavailable report. Cancellation releases the
request and closes its control channel.

The response becomes a `convoy.account_usage` chunk and one shared account-usage
card. Its header has one account-information control; quota windows and extra
usage occupy separate rows inside the same border. All reported named windows,
model-scoped windows and extra-usage state
render, including utilization below 80%. Known windows include five-hour,
weekly, weekly OAuth apps, Opus and Sonnet. Additional named window objects keep
their provider name or field label. Percentages are 0–100, reset timestamps are
ISO strings converted to Unix seconds, and invalid/missing values stay unknown.
Extra-usage spend is separate from session token cost and uses currency minor
units only when the response supplies a currency.

The SDK may return cached quota. The report uses the response's timestamp,
without a duplicate Reported at line, and says Claude may return cached data;
it does not claim a live refresh. The
control response exposes provider-selected windows, not a guarantee that every
limit in Claude's interactive UI is available. Structured headless `/usage`
reports exist upstream, but this implementation uses the no-prompt control
request to avoid command text ever reaching a model on an older executable.

On unavailable lookup, chunk insertion freezes the thread's existing
`metadata.usageLimits` into the stored report. Each window retains its original
`reportedAt` observation time. Legacy snapshots without that field stay undated.
The UI labels this fallback historical thread data with an unverified account,
since those snapshots carry no login identity. With no snapshots it shows
unavailable. Later quota events do not rewrite an earlier report. Automatic
warning pills and their thresholds remain unchanged. Schema additions are
optional, so historical documents need no backfill.
