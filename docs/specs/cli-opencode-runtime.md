# OpenCode Runtime Specification

This document defines how the `opencode` CLI runtime executes and renders in Convoy. Unlike Codex v1 (`codex exec --json`, non-interactive), OpenCode is the first **interactive session transport**: the executor keeps a long-lived `opencode serve` HTTP server, drives sessions through the OpenCode SDK, and routes permission and question requests through the OS-992 interaction bridge.

Implementation status: fully implemented (backend normalization, interactive executor, dynamic models, UI promotion, devcontainer). Implementation history: `docs/features/implemented/opencode-runtime/`. Outstanding: manual smoke test against a real `opencode` install (validates the synthetic normalization fixtures and the approval/resume round-trips).

## Scope

- Execution of OpenCode runs in `apps/cli` (`src/agent/runtimes/opencode/`).
- Backend normalization and metadata in `apps/web/convex/cli/lib/runtimes/opencode/`.
- Frontend selector/mode/model metadata in `apps/web/lib/cli-runtime-ui/opencode.tsx`.
- Devcontainer provisioning of the OpenCode CLI (`.devcontainer/`).

## Execution (apps/cli)

- The runner uses the user's installed `opencode` binary (never bundled). Resolution order: `CONVOY_OPENCODE_EXECUTABLE` env override, then `PATH`.
- Detection (`detectOpencode`) runs `opencode --version` and reports `{ type: "opencode", version }` in the session's `availableClis`, with the advertised model catalog stored separately (see "Dynamic model catalog" below). Minimum supported version: `1.14.19`; older installs are not advertised.
- Transport: one shared `opencode serve --hostname=127.0.0.1 --port=<free>` process per running agent, started lazily on the first OpenCode run and killed (process group, SIGTERM → SIGKILL) on agent shutdown. Readiness is the stdout line `opencode server listening on <url>` within 15s.
- Server auth (CLI 0.118.0, OS-2018): every `opencode serve` start gets a fresh random password in `OPENCODE_SERVER_PASSWORD`, set in the server's env only, never argv; an inherited `OPENCODE_SERVER_USERNAME` is dropped. Projects on one machine share loopback, so the password is what keeps a sibling project off this server. The SDK client sends `Authorization: Basic opencode:<password>` on every request, including detection's inventory, the event stream, sessions, commands and permission replies. After readiness the manager sends one unauthenticated `GET /global/health`; anything but 401 kills the server and fails the run ("answered without its password", or "did not answer its health probe" when the request fails or times out). OpenCode 1.18.18 and 1.19.5 return 401 without the password on `/global/health`, `/config`, `/provider`, `/event`, `/session`, `/auth` and `/doc`.
- Sessions are driven via the OpenCode SDK (`createOpencodeClient`): `session.create({ title, permission })` on first run, `session.promptAsync({ sessionID, model?, parts })` per run, `event.subscribe()` for the event stream (filtered by `sessionID`), `session.abort()` on cancel.
- Environment: inherits the process env minus `CONVOY_API_KEY`. Without managed keys the user's own OpenCode config and auth are used as-is, so provider credentials come from the machine's `opencode auth`. An isolated project with managed keys replaces both for the server; see [cli-provider-keys.md](cli-provider-keys.md#managed-provider-keys-for-isolated-opencode-os-2018).
- Continuation: the OpenCode session id is the provider `continuationId`; follow-up runs prompt the same session. Every chunk carries it (`properties.sessionID`).
- The run ends when the session status goes `idle` (success) or on `session.error` / prompt failure (failure, continuation id preserved).

### Chunk contract (executor → backend)

- Raw SDK events pass through as chunks: `type` = SDK `event.type`, `data` = the whole event JSON (`{ type, properties: {...} }`).
- The executor synthesizes deduplicated streaming chunks `text.delta` / `reasoning.delta` (`data` = `{ sessionID, partID, text }`). OpenCode emits both cumulative part snapshots and incremental deltas; the executor reconciles them (common-prefix suffix emission) so deltas are exact suffixes and the completed part is the single source of truth.
- `permission.asked` / `question.asked` never become chunks — they route through the interaction bridge (below).
- Completed turns emit `convoy.context_usage` from the latest assistant usage
  and the actual model's provider-reported context limit. The same path handles
  follow-ups. See [context window meter](cli-thread-context-window-meter.md#opencode-rules)
  for validation, timeout, and persistence rules.

## Interactive Permissions & Questions

- `permission.asked` → interaction bridge (`docs/specs/cli-interactive-approvals.md`) → web approval UI. Replies map to `client.permission.reply`: `accept` → `once`, `acceptForSession` → `always`, `decline`/`cancel` → `reject`.
- `question.asked` → ask-user-question flow (`docs/specs/cli-ask-user-question-ui.md`) → `client.question.reply({ requestID, answers })`; `question.rejected` resolves empty.
- Resolution events (`permission.replied`, `question.replied`, `question.rejected`) arrive as chunks and normalize to silent metadata.

## Modes

Modes are OpenCode **permission rulesets** passed to `session.create({ permission })`. OpenCode has no OS sandbox; the ruleset is the safety knob.

| Thread mode | Ruleset | Meaning |
|---|---|---|
| `agent` (default, or unset) | `[{ permission: "*", pattern: "*", action: "allow" }]` | Full access; same trust level as Claude's/Codex's Act mode |
| `default` (labeled "Ask to approve") | `action: "ask"` for `*`, `bash`, `edit`, `webfetch`, `websearch`, `codesearch`, `external_directory`, `doom_loop`; `question` → `allow` | Every sensitive tool asks; approvals surface in the thread |
| `plan` | ask ruleset + `agent: "plan"` on the prompt | OpenCode's built-in read-only plan agent; no approve-plan gate (unlike Claude's ExitPlanMode) |
| any other stored mode | `default` ruleset | Safe fallback |

The mode value `default` is reused from Claude's mode vocabulary (same "asks you before running tools" semantics), so no new mode value enters `docs/specs/cli-thread-modes.md`.

## Models

- Stored values: `default` or a `providerID/modelID` slug (e.g. `anthropic/claude-sonnet-5`).
- `default` sends no model — OpenCode uses the machine's configured default.
- The selectable catalog is **dynamic**: at registration the CLI queries `client.provider.list()` (connected providers only, 20s fail-soft budget; the backend parser is also fail-soft — malformed advertised models are skipped, never failing the registration — inventory failure still registers with the catalog unknown; the query uses a short-lived serve process stopped right after detection, so machines that never run OpenCode threads keep no server running — the first OpenCode thread starts the shared singleton lazily) and sends `models` (slug, name, `variants` keys) in the registration payload.
- The catalog carries nothing derivable: a `providerID`/`modelID` sent by an older CLI is dropped at the parser, since every reader splits the slug (OS-1721).
- Two bounds, doing two different jobs:
  - `MAX_ADVERTISED_MODELS` (150, in the CLI) is the **budget**: what a grouped picker can present, and what a catalog read costs per composer mount and per opencode dispatch. It sits above the largest measured real inventory (137 models over three connected providers), so nothing is truncated in practice. It is handed out one model at a time across connected providers, so a provider with hundreds of models cannot consume the whole budget and hide the others; providers under their share release the rest. A flat slice of a measured 117/13/7 inventory advertised bedrock only.
  - `MAX_STORED_CATALOG_MODELS` (1000, in the backend parser) plus per-string and per-variant limits is the **ceiling**: a client constant cannot bind an old, custom or hostile CLI, so this is what keeps a stored catalog inside Convex's array/document limits. It degrades — truncate the list, skip an over-long model — rather than failing the registration.
- Storage: the catalog is written to `cliRuntimeCatalogs` (one row per profile + `cliType`), **not** to the session or profile row — those keep `{ type, version, provider? }` only, because they are read and rewritten on every heartbeat, profile list and path sync (OS-1721). The row survives disconnect, so an offline machine still offers models, and `cliProfiles.lastKnownClis` remains the offline source of *which runtimes* exist.
- A registration reports three distinct states per runtime, and the stored row follows all three:
  - `models: [...]` — known: upserted, and an unchanged catalog writes nothing.
  - `models: []` — inventory succeeded with nothing connected: the row is cleared, so a disconnected provider stops offering models.
  - `models` absent — the inventory query failed (20s timeout, or a serve process that would not start): **unknown**, so the stored row is left alone. Treating this as "none" would delete the catalog across a bad detection, which is the durability this table exists for.
  - A runtime absent from the registration entirely (uninstalled, below the minimum version) loses its row, and an empty detection — no runtimes at all, as in fixture/stream mode — touches nothing.
- The row denormalizes `projectId` and `userId` from the profile (immutable there), so `cli.profiles.listRuntimeCatalogs({ projectId })` answers from one index range (`by_project_and_user`) and reads **no profile document** — profile rows carry the unbounded `paths` array this task is trying to stop reading. It is also why the query is project-scoped rather than taking profile ids: those would have to be fetched first (a serial round trip on composer mount) and then authorized one document at a time.
- Reads happen only where models are offered: `useCliProfiles(projectId, { withModelCatalogs: true })` for composers, the thread view (same args, so Convex dedupes the subscription; skipped for a read-only viewer), the server-side effort guard on run dispatch (per profile + cliType, via `by_profile_and_cliType`), and MCP `list_cli_profiles`. Callers with no model picker — the thread list, group tabs — do not subscribe. Each re-attaches the catalog to its runtime entry (`hydrateAvailableClis`, scoped by profile) so every model/effort helper keeps its existing input shape.
- The run dispatch read is skipped for runtimes that cannot have a catalog (`cliTypeAdvertisesModelCatalog`), so a Claude or Codex run pays nothing.
- The query authorizes per project, not by profile ownership alone: a scoped API key is a narrower credential than its holder, and project access can be revoked. An unreachable profile is skipped rather than rejected.
- While that subscription is loading, the model reads as unadvertised: remembered selections survive (they only require the *runtime* to be advertised) and effort validation stays lenient, so nothing flickers to a default.

- Stale stored slugs (provider disconnected, list changed) still resolve to a labeled option and run as-is — OpenCode errors clearly if the model is truly gone.
- Values that are not `default` or a `provider/model` slug never leak into the run.

## Reasoning Effort / Variants

- OpenCode "efforts" are model **variants**: per-model, sourced from the advertised inventory, passed as `promptAsync({ variant })`.
- The Reasoning section appears in the selector only when the selected OpenCode model is advertised with variants; `default` (no variant sent) is always first.
- Resolution validates the stored value against the selected model's advertised variants (drops values the model does not offer); an un-advertised model passes the value through. See `docs/specs/cli-thread-effort-selection.md`.

## Event Normalization (apps/web backend)

`normalizeOpencodeChunk` maps chunks to `CliNormalizedEvent`:

| Chunk | Normalized event |
|---|---|
| `text.delta` | `text-delta` (ephemeral) |
| `reasoning.delta` | `reasoning-delta` (ephemeral) |
| `message.part.updated` × text part with `time.end` | `text` |
| `message.part.updated` × reasoning part with `time.end` | `reasoning` (silent when empty) |
| `message.part.updated` × in-flight text/reasoning snapshot | silent `metadata` (live streaming served by delta chunks) |
| `message.part.updated` × tool part `running` | `tool-input` (toolName = OpenCode tool name, input = `state.input`) |
| `message.part.updated` × tool part `completed` | `tool-output` `{output, title?}` |
| `message.part.updated` × tool part `error` | `tool-error` (`state.error`) |
| `message.part.updated` × tool part `pending` | silent `metadata` |
| `message.part.updated` × `step-start`/`step-finish` | silent `metadata` (`step-finish` keeps tokens/cost in `otherJson`) |
| `session.status` × `retry` | `warning` (`opencode-retry`) |
| `convoy.context_usage` | `context-window` for valid positive used/max counts; otherwise silent metadata |
| `session.status` × other | silent `metadata` with `sessionId` |
| `session.error` | `warning` (`opencode-session-error`, message from `error.data.message`) |
| `message.updated` / `message.removed` / `permission.replied` / `question.replied` / `question.rejected` | silent `metadata` |
| `session.compacted` | `context-compaction` ("Conversation compacted") — `/compact`, see `docs/specs/cli-runtime-commands.md` |
| anything else | `unknown` (raw JSON fallback rendering) |

- `toolCallId` is `part.callID` (falling back to `part.id`), pairing `tool-input` with `tool-output`/`tool-error`.
- `text.delta` / `reasoning.delta` chunks are ephemeral: deleted when the message completes, superseded by the final part events.
- Continuation extraction scans chunks for `properties.sessionID` (or top-level `sessionID` on delta chunks).
- Local resume command: `opencode --session <sessionID>` (opens the OpenCode TUI on that session).

## Devcontainer

- `opencode-ai` installed globally from `latest` by `postCreateCommand` (not baked into the image, so rebuilds cannot pin it to a stale version); the runtime requires ≥ 1.14.19.
- Host OpenCode auth/config bind-mounted so container OpenCode reuses host provider credentials.
- Strict-mode firewall allowlists OpenCode's endpoints (`opencode.ai`, `models.dev`) plus the already-allowlisted LLM provider endpoints.

## Known Limitations (v1)

- No OS sandbox — `ask` mode is the safe mode; `agent` mode is full access.
- No inline image attachments (SDK file parts are future work).
- Session resume across `opencode serve` restarts depends on OpenCode's local session storage; resuming on a different machine than the one that started the thread fails.

## Related Specs

- Runtime subsystem layout: `docs/specs/cli-runtime-architecture.md`
- Codex runtime (exec transport reference): `docs/specs/cli-codex-runtime.md`
- Interactive approvals: `docs/specs/cli-interactive-approvals.md`
- Ask-user-question flow: `docs/specs/cli-ask-user-question-ui.md`
- Model selection UI behavior: `docs/specs/cli-thread-model-selection.md`
- Thread modes: `docs/specs/cli-thread-modes.md`
- Chunk storage/ephemeral rules: `docs/specs/cli-message-chunks-storage.md`
