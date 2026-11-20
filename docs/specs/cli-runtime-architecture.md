# CLI Runtime Architecture Specification

This document defines how CLI-specific behavior is organized in `apps/web` so provider-specific logic stays cohesive and top-level Convex files remain orchestration-only.

## Scope

- Applies to CLI runtime metadata and parsing in `apps/web`.
- Covers shared backend and web logic for CLI runtime types such as Claude Code and future Codex support.
- Does not define subprocess execution inside `apps/cli`; that remains covered by runtime execution specs such as `docs/specs/cli-sdk-integration.md`.

## Subsystem Ownership

- Backend runtime logic lives under `apps/web/convex/cli/lib/runtimes/`.
- Frontend runtime UI metadata lives under `apps/web/lib/cli-runtime-ui/`.
- The subsystem contains:
  - `apps/web/convex/cli/lib/runtimes/registry.ts` for backend runtime composition and dispatch
  - `apps/web/convex/cli/lib/runtimes/contracts.ts` for shared backend runtime types/constants
  - `apps/web/convex/cli/lib/runtimes/shared/` for generic backend helpers/factories
  - one backend runtime folder per specialized runtime (`claudeCode/`, `codex/`, etc.)
  - `acp/` for protocol-only Agent Client Protocol code that ACP runtimes compose
    (`antigravity/` adds agy's quirks over it). The CLI mirrors this with
    `apps/cli/src/agent/runtimes/acp/` and the shared `runtimes/json-rpc.ts` client
  - `apps/web/lib/cli-runtime-ui/registry.ts` for frontend runtime UI composition
- Claude-specific backend behavior must live under `apps/web/convex/cli/lib/runtimes/claudeCode/`, not in top-level Convex files such as `convex/http.ts` or shared contract files outside the runtime subtree.
- Frontend-specific icons, labels, selector metadata, and mode definitions must live under `apps/web/lib/cli-runtime-ui/`, not under `convex/`.
- `apps/web/lib/cli-runtime-ui/registry.ts` is the single frontend entrypoint for
  runtime *behavior*; `apps/web/lib/threads/types.ts` carries thread *types* and
  constants only. `threads/types.ts` must not re-export runtime functions — a
  second import path for one function is how the effort-`context` argument got
  silently dropped (OS-1790).

## Registry Responsibilities

- The registry is the single runtime combiner for `apps/web`.
- Top-level callers must delegate runtime-specific behavior through registry entrypoints rather than branching on `cliType` inline.
- Registry-owned dispatch includes:
  - parsing `availableClis` payloads from session registration
  - splitting an advertised payload into the runtimes stored on the session/profile
    rows and the model catalogs stored in `cliRuntimeCatalogs`, and re-attaching them
    for readers (`splitAdvertisedCatalogs` / `hydrateAvailableClis`, in
    `convex/lib/contracts/validators.ts` because the MCP domain projects them too)
  - validating/storing runtime-specific `cliModel` values
  - resolving runtime-specific run-model arguments
  - normalizing raw stream chunks into `CliNormalizedEvent`
  - local resume command construction/support checks

## Top-Level Module Rules

- Top-level Convex files are orchestration-only:
  - `convex/http.ts` handles route wiring, auth, HTTP status mapping, and delegates CLI payload parsing
  - `convex/lib/contracts/validators.ts` exposes assembled validators/types, but does not own runtime-specific parsing/catalog logic
  - modules like `cli/messages.ts`, `cli/threads/`, and `cli/sessions.ts` call generic registry helpers instead of embedding runtime-specific branches
- Shared web modules outside the subsystem may re-export or consume runtime helpers, but runtime-specific logic must remain implemented in the correct backend or frontend runtime folder.

## Extension Rules

- Adding a new runtime may require changes inside `apps/web/convex/cli/lib/runtimes/` and `apps/web/lib/cli-runtime-ui/`.
- Adding a new runtime must not require edits to top-level Convex modules.
- If a runtime has no specialized behavior yet, it may be represented by a generic runtime definition inside the subsystem until its own folder is warranted.
- Runtime additions must preserve backward-compatible behavior for existing runtimes unless a spec explicitly changes that behavior.

## Data and Compatibility Rules

- `cliType` is runtime-registry owned.
- `cliModel` storage is provider-agnostic at the schema boundary; runtime-specific validation/defaulting happens inside the runtime subsystem.
- Existing Claude stored model values remain valid and unchanged. The current slots and provider mappings are defined in [model selection](cli-thread-model-selection.md).
- Existing `availableClis` payloads and normalized event shapes remain backward-compatible for current Claude flows.

## Claude Metadata Normalization

- Claude `result` chunks normalize run metadata under:
  - `resultSubtype`
  - `totalCostUsd`
  - `durationMs`
  - `usage`
  - `modelUsage`
  - `terminalReason`, `apiErrorStatus`, and `resultOutcome` when a structured
    terminal field is present. Outcome rules live in `cli-sdk-integration.md`.
- Runtime-specific usage parsing that feeds shared composer/footer UI must normalize into provider-agnostic CLI events inside the owning runtime folder.
- Context-window usage is one such provider-agnostic event and must not be derived from raw runtime payloads in thread pages or shared UI components.
- Claude `system` init chunks normalize runtime bootstrap metadata under:
  - `systemInit`
- Claude `system` chunks with non-`init` subtypes normalize into:
  - `runtime-notice`
  - `context-compaction` for `compact_boundary`
  - `memory-recall` for `memory_recall`
  - `text` for `local_command_output` (the SDK documents it as assistant-style
    transcript content, not telemetry)
  - silent `metadata` for pure telemetry subtypes (`thinking_tokens`,
    `hook_started`, `hook_progress`, successful `hook_response`, `status`,
    `session_state_changed`, `elicitation_complete`, `post_turn_summary`) —
    the assistant UI never renders `metadata` events
- Non-system Claude telemetry chunk types (`rate_limit_event`, `tool_progress`,
  `tool_use_summary`, `auth_status`) normalize inside the Claude runtime folder
  as well; `tool_progress` uses the provider-agnostic `tool-progress` event
  kind and `rate_limit_event` uses the provider-agnostic `usage-limit` event
  kind (thread-footer usage pill + escalation-only inline notice). See
  `docs/specs/cli-sdk-integration.md` for the authoritative per-event
  visibility rules.
- Agent checklists (Claude `TodoWrite` and the task tools, Codex `todo_list` /
  `turn/plan/updated`) normalize into the provider-agnostic `plan-progress`
  (snapshot) and `plan-step-update` (patch) events inside each runtime folder,
  built through `runtimes/shared/planProgress.ts`. Neither renders inline: the
  chunk-insert path folds them into `cliThreads.metadata.plan`, which the
  composer steps pill reads. Thread-level state derived from the chunk stream
  belongs in `metadata` rather than being recomputed from loaded chunks, which
  pagination makes unreliable. See `docs/specs/cli-thread-plan-progress.md`.
- Partial-streaming `stream_event` chunks normalize inside the Claude runtime
  folder into the provider-agnostic `text-delta` / `reasoning-delta` event
  kinds (or silent `metadata`); the client composer merges deltas and replaces
  them when the final whole message arrives. Runtimes mark such
  live-streaming-only chunks via the registry `isEphemeralChunk` hook so the
  backend can delete their rows after message completion. See
  `docs/specs/cli-sdk-integration.md` ("Partial Event Streaming") for the
  toggle, transport protocol, and cleanup rules.
- `runtime-notice` carries:
  - `code`
  - `title`
  - `message`
  - optional `detailsJson`
  - optional `sessionId`
- `context-compaction` carries:
  - `message`
  - optional `detailsJson`
  - optional `sessionId`
- `memory-recall` carries:
  - `mode` (`files` | `synthesis`)
  - `memories`, each with optional `path`, `scope` (`personal` | `team`), and
    `content`
  - optional `detailsJson`
  - optional `sessionId`
- Claude `api_retry` must normalize to a stable `runtime-notice` code (`claude-api-retry`) with a human-readable retry summary and raw retry details preserved in `detailsJson`.
- Claude `compact_boundary` must normalize to a provider-agnostic `context-compaction` event with a stable user-facing message and raw boundary payload preserved in `detailsJson`.
- Frontend assistant-message renderers must surface `runtime-notice` inline in the message body; these notices are not limited to fallback JSON or raw-data dialogs.
- Frontend assistant-message renderers must surface `context-compaction` inline at its stream position.
- Frontend assistant-message renderers must surface `memory-recall` inline at its stream position, as a separator marker over a collapsed list of the recalled memories. See `docs/specs/cli-sdk-integration.md` for the per-mode rules.
- Frontend renderers must remain backward-compatible with previously stored Claude metadata that used:
  - `subtype` instead of `resultSubtype`
  - flat system metadata fields (`model`, `claudeCodeVersion`, `permissionMode`, `tools`) instead of `systemInit`

## Related Specs

- Execution/runtime behavior in `apps/cli`: `docs/specs/cli-sdk-integration.md`
- Codex runtime behavior (exec --json mapping, modes, models): `docs/specs/cli-codex-runtime.md`
- Cursor runtime behavior (stream-json mapping, modes, models): `docs/specs/cli-cursor-runtime.md`
- Antigravity runtime behavior (ACP mapping, modes, continuation): `docs/specs/cli-antigravity-runtime.md`
- Claude model selection behavior: `docs/specs/cli-thread-model-selection.md`
- Context-window footer meter behavior: `docs/specs/cli-thread-context-window-meter.md`
- Plan/steps pill behavior: `docs/specs/cli-thread-plan-progress.md`
- Context selector behavior: `docs/specs/cli-thread-context-selectors.md`
