# CLI Thread Context Window Meter

This document defines the context-window usage meter rendered under the shared CLI thread composer.

## Scope

- Applies to the shared thread composer in `apps/web/components/blocks/thread/thread-composer.tsx`.
- First live surface is the existing-thread detail composer on `/threads/[threadId]`.
- New-thread and task-sidebar composers remain compatible through the same shared prop, but render nothing until runtime usage data is available.

## Normalized Event Contract

- Runtime parsing is provider-owned.
- Providers that support the meter emit a normalized CLI event with:
  - `kind: "context-window"`
  - `usedTokens`
  - optional `maxTokens` (absent on Claude's per-API-call events, see Claude
    Code Rules; the client carries the last known max forward)
  - optional `inputTokens`
  - optional `cachedInputTokens`
  - optional `outputTokens`
- The composer and thread pages must not branch on `cliType` to interpret raw usage payloads.

## Claude Code Rules

- Claude extraction lives under `apps/web/convex/cli/lib/runtimes/claudeCode/`.
- Two sources feed the meter:
  - Live, once per API call (OS-1900): every top-level `assistant` message
    carries `message.usage` for the call that produced it. The normalizer
    bundles a `context-window` event with `usedTokens = input_tokens +
    cache_creation_input_tokens + cache_read_input_tokens` and no `maxTokens`
    alongside the message's content events. This is the number Claude Code's
    own status line shows. Messages with `parent_tool_use_id` (subagents) emit
    none: a subagent has its own context. A zero prompt size emits none.
  - Authoritative, once per turn: the synthetic `convoy.context_usage` chunk
    emitted by the Convoy CLI runner after each completed turn (each `result`
    message), populated from the Agent SDK `getContextUsage()` control request:
    - `usedTokens` = SDK `totalTokens` (current context size)
    - `maxTokens` = SDK effective `maxTokens` (accounts for the auto-compaction
      buffer; not raw model capacity)
  - The turn snapshot corrects any drift between the per-call prompt size and
    the SDK's `totalTokens`, and is the only source of `maxTokens`. A thread
    shows no meter until its first completed turn has produced one.
- Claude `result.usage` is cumulative API/cost usage for the whole run (all
  API calls, cache reads/creations, helper models) and must never be
  interpreted as current context. It stays in result metadata for the cost
  pipeline; `result` chunks emit no context-window event.
- The control request may take several seconds and remains pending until it
  resolves or the run is cancelled/closed. Rejection, unsupported Claude
  versions, or non-positive values skip the snapshot for that turn without
  failing the run; the meter keeps its last valid snapshot.
- The snapshot requires the live SDK control channel (open-input streaming
  runs); runs without it emit no snapshot.
- If `usedTokens <= 0` or `maxTokens <= 0`, the synthetic chunk normalizes to
  silent metadata and no context-window event is emitted.
- The synthetic chunk is durable (not ephemeral), and its value is also
  persisted on the thread doc (Shared State Rules below). Per-call events are
  not persisted there.
- No data migration or backfill: stored `result` chunks are re-normalized on
  read, so stale cumulative-usage meters disappear immediately; threads show
  no meter until their next completed turn produces a snapshot. Stored
  `assistant` chunks keep their stored event, so the live meter starts with
  the next run.

## OpenCode Rules

- After a completed turn, the CLI emits a durable `convoy.context_usage`
  snapshot from the latest valid assistant `message.updated` event for that
  session. Fresh and resumed runs use the same path.
- Used tokens are the latest message's input, output, reasoning, cache-read,
  and cache-write counts added together. Never sum messages or turns for this
  meter. The model limit comes from the matching provider/model in
  `provider.list()`, using the message's actual model even when the selected
  slot is `default`.
- This matches [OpenCode's own context meter](https://github.com/anomalyco/opencode/blob/v1.17.13/packages/tui/src/feature-plugins/sidebar/context.tsx).
  It represents the runtime's reported token usage against model capacity,
  not an independent measurement of the prompt or its compaction threshold.
- Missing or invalid token categories, zero output, missing model limits, and
  failed provider lookup produce no snapshot. Lookup has a two-second timeout
  and must not fail the run. The prior persisted snapshot remains available.
- Successful limits are cached for five minutes across runner lifecycles,
  scoped to the server instance, working directory, provider and model. Each
  server holds at most 256 entries, evicting the oldest insertion when full.
  A server restart gets a fresh cache even if its URL is reused. Missing,
  invalid and failed lookups are not cached and retry on the next turn.
- The backend normalizes valid positive counts to `context-window` and stores
  them through the shared snapshot fold below. Cost accounting ignores this
  synthetic chunk and continues to use step costs.

## Rendering Rules

- The meter renders in its own right-aligned row directly below the composer shell.
- The meter is percentage-based and only renders when both `usedTokens` and `maxTokens` are present and valid.
- The ring fill uses `min(100, usedTokens / maxTokens * 100)`.
- Ring tone tiers by absolute `usedTokens` (not percentage — a 40% ring on a
  1m window is still a large, expensive context):
  - `<= 150k`: muted foreground
  - `> 150k`: amber
  - `> 300k`: destructive
  - Tiers reuse the usage-limit pill palette so the footer row reads as one system.
- The trigger opens a popover with:
  - `30% used (70% left)`
  - `100k / 300k tokens used`
- When the runtime advertises `compact`, the popover ends with a divider and a
  full-width "Compact context" menu row (icon + label, highlight on hover).
  Clicking it closes the popover and sends
  `/compact` ahead of the queue. See `cli-runtime-commands.md` → Compact button (OS-2339).
- Compact token formatting:
  - `<1000`: full number
  - `1k–999k`: compact `k`
  - `>=1m`: compact `m`

## Shared State Rules

- The latest valid `context-window` event that carries `maxTokens` is folded
  onto the thread doc at chunk-insert time as
  `cliThreads.metadata.contextWindow` (OS-1889), the same fold that keeps the
  plan (`docs/specs/cli-thread-plan-progress.md` → Where the plan lives). The
  chunk window a reader loads is bounded to roughly ten messages, and the
  snapshot is emitted once per turn, so a long streaming turn pushes the
  previous turn's snapshot out of the window.
- Max-less per-call events (OS-1900) never touch the thread doc: they would
  patch `cliThreads` on every API call in the streaming path, which otherwise
  never writes it.
- The client keeps the newest stream snapshot: the latest event's `usedTokens`
  with `maxTokens` carried forward from the newest event that has one, else
  from the previous stream snapshot, else from the thread doc. It renders that
  when the loaded chunks hold one (it is newer), and the thread snapshot
  otherwise. Without any max source the meter stays hidden. The stream
  derivation belongs to shared thread stream state, not to per-message
  assistant render state.
- `usage-limit` snapshots follow the same rule: folded per window onto
  `cliThreads.metadata.usageLimits`, merged under the stream-derived set.
  New snapshots retain their chunk observation time as `reportedAt`. Old
  snapshots without this optional field keep an unknown age. Claude `/usage`
  can display these historical values below the warning threshold; see
  `cli-sdk-integration.md`, Account usage on request.
- `context-compaction` events are message-body timeline events and do not update the meter unless a separate `context-window` event is emitted.
- Message-body rendering remains unchanged for `context-window` events.

## Usage-Limit Pills (same footer row)

- Provider usage/rate-limit state (`usage-limit` normalized events) renders as
  pills in the same right-aligned footer row, to the left of the meter.
- One pill per rate-limit window (e.g. `5h`, `weekly`), driven by the latest
  snapshot per window from thread stream state (state, never stacked).
- Visibility tiers: hidden below 80% utilization; subdued amber warning
  styling at 80–95%; critical styling at ≥ 95% utilization or when
  `isUsingOverage` is set.
- Pill text: `<window label> <percent> · resets <relative time>` with a
  `· using overage` suffix when applicable. The pill opens a popover with the
  window label, percentage, absolute reset time, and overage state.
- Inline message-body rendering for usage events is escalation-only; see
  `docs/specs/cli-sdk-integration.md`.

## Related Specs

- Runtime ownership: `docs/specs/cli-runtime-architecture.md`
- CLI SDK transport/runtime behavior: `docs/specs/cli-sdk-integration.md`
- Thread header/composer layout context: `docs/specs/cli-thread-header.md`

## Codex account quota reports, OS-2001

Select or type `/usage` in a Codex composer, including a new thread, to request a
fresh account quota report. Menu selection sends immediately. A structured
`account-usage` message part displays compact cards for every window, including
usage below the automatic warning threshold. Each card shows a friendly duration
label, reset countdown, percentage remaining and progress bar. Used percentage
and absolute reset time are available on hover. Bucket headings distinguish
multiple limits. Expired reset times ask for a refresh without resetting the
historical allowance. Cards fill the available message width. An info icon in
each card header opens a popover with the runtime account email. There is no
footer or visible snapshot/refresh timestamp. Missing values read as unavailable. It does not replace the context
meter or change Claude's warning pills. Offline runners reject the request
with a reconnect message. Authentication, missing quota, account changes and
refresh failures appear as runner errors. See [Codex runtime](cli-codex-runtime.md#account-usage-on-request-os-2001)
for RPC and account-scoping rules.
