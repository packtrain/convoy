# Cursor Runtime Specification

Cursor CLI (`cursor-agent`) as a first-class Convoy runtime (`cliType:
"cursor"`): threads run Cursor agents from the web UI with streamed output,
resume-based follow-ups, model + reasoning selection, and slash-command
discovery.

## Scope

- Backend runtime definition: `apps/web/convex/cli/lib/runtimes/cursor/`
  (models, per-model effort, chunk normalization, continuation, synthetic
  slash-command extraction, resume command).
- Frontend UI definition: `apps/web/lib/cli-runtime-ui/cursor.tsx` (selector
  availability, modes, default-model tooltip).
- CLI executor: `apps/cli/src/agent/runtimes/cursor/` (detect, runner,
  chunk-stream policy, command discovery). CLI ≥ 0.14.0.

## Execution (apps/cli)

- Invocation: `cursor-agent -p --output-format=stream-json
  [--force | --trust] [--model <name>] [--resume <chatId>]`, spawned in the
  thread's working directory with the prompt written to **stdin** then EOF.
  Output is NDJSON on stdout; each line is stored as a raw chunk
  `{ type: <event type>, data: <raw line> }`.
- Executable: `cursor-agent` on PATH, overridable via
  `CONVOY_CURSOR_EXECUTABLE`. Detection runs `cursor-agent --version`
  (bare line like `2025.09.18-7ae6800`).
- The subprocess env strips `CONVOY_API_KEY`. The process runs in its own
  group; abort sends SIGTERM to the group with a 5 s SIGKILL escalation. A
  10-minute no-output watchdog kills and fails the run.
- Auth failures surface on **stderr** ("Authentication required…"); the
  runner maps a non-zero exit with that marker to an actionable error
  ("Run 'cursor-agent login' or set CURSOR_API_KEY.").
- Some fatal errors arrive as **plain text on stdout** with an empty stderr
  (verified live: `ActionRequiredError: Named models unavailable Free plans
  can only use Auto.` + exit 1). Non-JSON stdout lines are dropped from the
  stream but retained in the same error tail as stderr, so they surface in
  the failure message.
- Stream policy: `assistant` / `thinking` events arrive as micro-chunks
  (a few tokens each, no final aggregated message). The flush-buffer policy
  defers them and coalesces consecutive same-type chunks (text
  concatenation), bounding Convex chunk rows.
- Slash-command discovery: at run start the runner scans
  `<cwd>/.cursor/commands/` and `~/.cursor/commands/` for `*.md` files
  (basenames = command names, project wins dedup, fail-soft) and emits a
  synthetic `{ type: "convoy.commands", data: '{"commands": [...]}' }`
  chunk. See `docs/specs/cli-runtime-commands.md`.
- A solo runtime-command message is delivered as the raw trimmed prompt (no
  run envelope); cursor-agent interprets slash text natively, and unknown
  commands degrade to prose.

## Modes

Cursor print mode is non-interactive: no approval prompts, no plan mode. The
only permission knob is `--force`.

| UI mode | `cliMode` | Flags | Behavior |
|---|---|---|---|
| Act (default) | `agent` (or unset) | `--force` | Full access; auto-allows all commands |
| Guarded | `default` | `--trust` when supported | Follows the machine's Cursor permission config; denied commands are skipped, never asked |

- Legacy/unknown mode values degrade to the Guarded behavior (never
  `--force`).
- `--trust` (trust the working directory) exists only on newer cursor-agent
  builds; older builds (2025.09.x) trust the cwd by default and reject the
  flag. Support is probed once per process via `cursor-agent --help` (grep
  for `--trust`) — more robust than date-version comparison. The probe runs
  only for Guarded runs.

## Models

Selectable curated slots (Cursor advertises no inventory over the wire; catalog
refreshed from Cursor's model documentation in August 2026): `default`
(machine's configured model, no `--model` flag), `auto`, `composer-2.5`,
`claude-sonnet-5-5`, `claude-sonnet-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5-2`, `claude-fable-5-1`,
`claude-fable-5` (Fable slots: no zero-data-retention), `claude-haiku-5-5`,
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`,
`gpt-5.5`, `gpt-5.4`, `gpt-5-mini`, `gpt-5.3-codex`, `gemini-3.1-pro`,
`gemini-3.7-flash`, `gemini-3.5-flash`, `glm-5.2`, `kimi-k2.7-code`,
`grok-4.6`, `grok-4.5`, `grok-build-0.1`. Unknown stored values never leak
into `--model`.

The retired `claude-opus-4-8` slot remains accepted for stored threads,
favorites, and recent selections, with its label, model mapping, and effort
options intact. It is no longer offered in the model catalog.

Opus 5.5 uses the documented base ID `claude-opus-5-5`. Cursor lists 300k
context with a 1M maximum. Its CLI effort variants could not be verified on
2026-09-23 because `cursor-agent --list-models` required authentication.
Convoy therefore offers runtime-default reasoning only for this model;
stale effort selections are ignored and the bare ID is passed through.
Verify variants on an authenticated machine before adding effort overrides.
Source: [Cursor Opus 5.5](https://cursor.com/docs/models/claude-opus-5-5).

Sonnet 5.5 follows the same rule for the same reason: base ID
`claude-sonnet-5-5`, 200k context with a 1M maximum, and runtime-default
reasoning only until its CLI effort variants are verified.
Source: [Cursor Sonnet 5.5](https://cursor.com/docs/models/claude-sonnet-5-5).

Haiku 5.5 follows the same rule: base ID `claude-haiku-5-5`, up to 1M
context, and runtime-default reasoning only. Cursor documents effort levels
and a thinking variant but not their CLI IDs.
Source: [Cursor Haiku 5.5](https://cursor.com/docs/models/claude-haiku-5-5).

Fable 5.2 follows the same rule: base ID `claude-fable-5-2`, 1M context, and
runtime-default reasoning only. Cursor documents low through max effort and
no thinking toggle, but not the CLI IDs.
Source: [Cursor Fable 5.2](https://cursor.com/docs/models/claude-fable-5-2).

The model picker groups options by slot prefix into provider submenus:
Anthropic, OpenAI, Google, Z.ai, Moonshot AI, and xAI. Each submenu shows
the provider icon and name on the trigger, no icons on model rows, and the
group's Reasoning options above its models. Cursor's own entries (`default`,
`auto`, `composer-2.5`) stay one level up as plain rows. See
`docs/specs/cli-thread-model-selection.md` ("Selector Structure") for the
shared grouping/search/scroll rules.

Keep `apps/web/convex/cli/lib/runtimes/cursor/models.ts` and
`apps/cli/src/agent/runtimes/cursor/models.ts` in sync (no shared package
crosses the CLI/Convex boundary). Cursor renames models frequently. When
refreshing the catalog, re-verify ids with `cursor-agent --list-models`.

## Reasoning Effort

cursor-agent encodes reasoning inside the `--model` value, using bracket
parameters for current models and suffixes for legacy models. Effort options
are **per model** (backend `cursor/effort.ts`, surfaced through
`CliRuntimeEffortContext`):

- `claude-sonnet-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-fable-5-1`,
  `claude-fable-5`: `default/low/medium/high/xhigh/max/thinking`
- `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`:
  `default/none/low/medium/high/xhigh/max`
- `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`: `default/low/high/xhigh`
- `grok-4.6`: `default/low/medium/high/xhigh`
- `grok-4.5`: `default/low/medium/high`
- `glm-5.2`: `default/max` (only two tiers ship: `glm-5.2-high` canonical,
  `glm-5.2-max`)
- `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`, `auto`, `composer-2.5`, `gpt-5-mini`, `gemini-3.1-pro`,
  `gemini-3.7-flash`, `gemini-3.5-flash`, `kimi-k2.7-code`,
  `grok-build-0.1`, `default`: none (selector hidden)

The server resolves and stores model + effort separately; the CLI runner
combines them into the final `--model` id (`resolveCursorModelName`):

- Current parameterized models (`claude-fable-5-1`, `claude-opus-5`, the
  GPT-5.6 family, and Grok 4.5/4.6) use the bare base id for `default` or a
  missing/unknown effort. Other efforts resolve to `<base>[effort=<tier>]`.
  The Fable 5.1 and Opus 5 `thinking` tier resolves to
  `<base>[thinking=true,effort=high]`.
- Legacy Anthropic bases are **not** valid ids on their own; `default` (or a
  missing/unknown effort) resolves to the canonical `-high` tier
  (`claude-sonnet-5` → `claude-sonnet-5-high`), `thinking` →
  `<base>-thinking-high`, other tiers → `<base>-<effort>`.
- `gpt-5.5`/`gpt-5.4`: `default` → `<base>-medium` (the canonical 1M tier);
  `xhigh` on `gpt-5.5` is spelled `gpt-5.5-extra-high`.
- `gpt-5.3-codex`: the unsuffixed base is the canonical medium tier.
- `glm-5.2`: `default` → `glm-5.2-high` (bare id invalid), `max` →
  `glm-5.2-max`.
- Plain ids (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`, `auto`, `composer-2.5`, `gpt-5-mini`, `gemini-*`,
  `kimi-k2.7-code`, `grok-build-0.1`) pass through.

An effort the selected model does not offer never resolves, and is not
accepted by `isCursorEffortSupported` when a model context is supplied — so a
stale stored value self-corrects both in the composer pills and at run time
(OS-1466). Without a model context (storage normalization) acceptance stays
lenient: any single token passes, because model and effort are stored
separately. See `docs/specs/cli-thread-effort-selection.md` ("Dynamic
catalogs").

## Event Normalization (apps/web backend)

`convex/cli/lib/runtimes/cursor/normalizeChunk.ts`:

| Cursor event | Normalized event |
|---|---|
| `system` (init) | silent `metadata` (model, permissionMode; **no** sessionId — may fire before the session is initialized) |
| `user` | silent `metadata` with `sessionId` (prompt echo) |
| `assistant` | `text` (concatenated `message.content[].text`); empty → silent metadata |
| `thinking` | `reasoning`; empty (e.g. the `completed` marker) → silent metadata |
| `text` (2026.07+ builds, flat `{subtype, text}` like thinking) | `text`; empty → silent metadata |
| `tool_call` `started` | `tool-input` (`toolCallId` = `call_id`; toolName from the wrapper key: `shellToolCall`→Shell, `readToolCall`→Read, `editToolCall`→Edit, `writeToolCall`→Write, `grepToolCall`→Grep, `globToolCall`→Glob, `lsToolCall`→LS, `semSearchToolCall`→Search, `deleteToolCall`→Delete, `updateTodosToolCall`→Update todos, `mcpToolCall`→`provider.tool`; unknown key passes through) |
| `tool_call` `completed` (success) | `tool-output` |
| `tool_call` `completed` (failure: `failure` wrapper, `isError`, or shell exit ≠ 0) | `tool-error` |
| `result` with `is_error` | `runtime-notice` (`cursor-run-failed`) |
| `result` otherwise | silent `metadata` (duration) |
| `convoy.commands` | silent `metadata` |
| non-JSON / unrecognized | `unknown` |

Whole `text`/`reasoning` events (not deltas): cursor never emits a final
aggregated message, and delta events are ephemeral by contract (they would
be deleted on completion). The stream composer already concatenates
consecutive `text`/`reasoning` events into one rendered part.

## Continuation & Resume

- Chat id: the first `session_id` on a **non-`system`** stream event
  (`system` is skipped — it can fire before the session exists).
- Follow-ups: `--resume <chatId>` on a fresh process. History resume-to-
  latest only; cursor has no fork/truncate.
- Local resume command shown in the thread sidebar:
  `cursor-agent --resume <chatId>`. Cursor chats are stored on the machine
  that ran them, so resume works only there (same caveat as codex).

## Known Limitations

- **No steering**: no mid-run input channel (fresh process per turn).
  Queued messages ride the next `--resume` run. See
  `docs/specs/cli-steering.md`.
- No interactive approvals, no plan mode, no `acceptEdits` distinction.
- No context-window meter or usage events (cursor's `result` event carries
  no token totals).
- No partial-streaming deltas; micro-chunk coalescing approximates live
  streaming at flush-window granularity.
- Model/effort catalogs are curated snapshots; Cursor renames models
  frequently, so expect periodic table updates (backend slots + CLI model
  resolver).
- Slash-command execution relies on cursor-agent interpreting slash text in
  print mode; unknown commands degrade to prose (harmless).

## Related Specs

- `docs/specs/cli-runtime-architecture.md` — runtime subsystem ownership.
- `docs/specs/cli-codex-runtime.md` — the subprocess-runner template this
  runtime mirrors.
- `docs/specs/cli-runtime-commands.md` — slash-command discovery/execution.
- `docs/specs/cli-steering.md` — steering contract (cursor: unsupported).
- `docs/specs/cli-thread-model-selection.md`,
  `docs/specs/cli-thread-effort-selection.md`,
  `docs/specs/cli-thread-modes.md` — the pickers this runtime feeds.
