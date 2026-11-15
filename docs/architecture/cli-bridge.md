# CLI agent bridge

`apps/cli/` bridges the Convex backend and local/remote machines. It listens for
user requests from the web UI, spawns AI code agents (Claude Code, Codex, etc.)
in JSON streaming mode, and streams their output back to the server for
rendering.

Authoritative specs: [`cli-runtime-architecture.md`](../specs/cli-runtime-architecture.md),
[`cli-message-chunks-storage.md`](../specs/cli-message-chunks-storage.md), and the
other `docs/specs/cli-*.md` files. This page is orientation only — the specs win.

## How it works

```text
Web UI (Next.js)  ←──realtime──→  Convex Backend  ←──realtime+HTTP──→  CLI Agent (Node.js)
   user sends                     stores messages,                      subscribes to pending
   message, sees                  tracks sessions,                      chats, claims chat,
   streamed output                manages lifecycle                     streams output back
```

1. User sends a message → backend creates a user message and flags the chat
   pending (`hasPendingUserMessages`)
2. CLI subscribes to `cliThreads.listPendingThreads` via a realtime query
3. CLI claims the thread (`cliThreads.claimThread`) using a lease, then fetches
   all unprocessed user messages
4. CLI snapshots those messages for a run (`cliMessages.startRunResponse`), creating one
   assistant message for streaming
5. CLI spawns the agent (e.g. `claude --output-format stream-json`) in the
   project's working directory — or, for a Workflow bash step's message
   (`scriptRequest`, always a solo run), a script runner created for that
   run (`agent/app/script-runner.ts`) runs `bash -c` there instead and
   reports a `scriptResult` with `complete`; one runner per run keeps Stop
   and claim loss scoped to their own chat (docs/specs/workflows.md → Bash
   steps)
6. Each JSON line is sent back via `cliMessages.appendRunContent`
7. On completion/failure the assistant message is finalized (`complete`/`fail`)
   and the CLI loops for newly arrived messages; the claim releases when the
   queue drains

`startRunResponse` and `appendRunContent` are the only run lifecycle mutations.
The OS-1568 compatibility aliases were removed after the storage cleanup.

## Lifecycles

```text
Message:    pending → streaming → completed
                                └→ failed (retryable)

Processing: idle → claimed → streaming → claimed → ... → idle
```

- Queue signal: `cliThreads.hasPendingUserMessages`
- Lease fields: `claimedBySessionId`, `claimedAt`, `claimLeaseExpiresAt`
- Streaming target: `activeAssistantMessageId`

## Claiming invariants

These are strict — violating them corrupts thread state.

1. Message-level `claimed` status is **legacy only**; active claiming is
   thread-level (`cliThreads.claimThread` + lease).
2. `retry` on a failed assistant run must requeue the user messages in the run
   **and remove the failed assistant message**.
3. Any path that ends or abandons streaming must clear a stale
   `activeAssistantMessageId`.
4. For "has remaining unprocessed user messages", use the one shared helper with
   an indexed `.first()` — not repeated `.collect().length`.
5. Keep `cliMessageStatusValidator` backward-compatible with legacy stored
   statuses until an explicit migration removes them.
6. During a persisted field rename, widen the schema, backfill and verify data,
   then narrow it in a later deploy. Never remove the old field in the widening deploy.

## Session management

- **Registration** — `POST /api/agent/register` with API key auth
- **Heartbeat** — every 30s via `POST /api/agent/heartbeat`; a session expires
  after 60s of silence
- **Disconnect** — `POST /api/agent/disconnect` (handles SIGINT/SIGTERM)
- **Conflict resolution** — one active session per profile; `force=true`
  disconnects existing sessions

## Profile-based configuration

Stored in `~/.config/convoy/config.toml`. Each profile maps to a user+project
and may have multiple paths (monorepos, worktrees).

Resolution priority: `--profile` flag → `CONVOY_PROFILE` env → path match (cwd)
→ `default_profile`.

## Chunk storage & client rendering

Streamed chunks are stored as **`cliMessageChunks` rows**, not inline on the
message. `appendRunContent` rejects assistant messages that still carry legacy
inline `content` ("Legacy assistant inline content is not supported"); the
`content[]` array on `cliMessages` remains only for legacy rows and user
messages.

Each chunk row carries a `normalizedEvent` computed at insert time
(`convex/cli/lib/chunks/normalizedEvents.ts`), a `CliNormalizedEvent` union:
`text`, `reasoning`, `tool-input`, `tool-output`, `tool-error`, `metadata`,
`warning`, `unknown`.

The client pages older history via `cli.messageChunks.listWindowByThread` and
subscribes to new chunks via `cli.messageChunks.listLiveByThread` (delta cursor). The UI stream layer (`lib/cli-stream-ui/`) turns normalized events into
AI SDK `UIMessage` parts:

- `event-store.ts` — snapshot + delta merge with dedup
- `composer.ts` — maps `CliNormalizedEvent` → `TextUIPart` / `ReasoningUIPart` /
  `DynamicToolUIPart`
- `recovery.ts` — rebootstrap detection

`useCliMessages` subscribes to both message envelopes (pagination) and normalized
chunks (bootstrap/delta via `useReducer`), exposing
`assistantRenderById: Map<messageId, ComposerMessageState>`.
`AssistantCliMessage` renders `ComposerMessageState.parts` through the part
renderer registry.

## Adding a new CLI type

Each agent type has a `cliType` slug.

1. Add/update backend runtime behavior under
   `apps/web/convex/cli/lib/runtimes/` and register it in that folder's
   `registry.ts`
2. Add/update frontend runtime UI metadata under `apps/web/lib/cli-runtime-ui/`
3. Keep specialized behavior inside the runtime's own folder/file rather than
   scattering conditionals across top-level modules
4. If CLI execution support is needed, add an executor modeled on
   `claude-code.ts` in `apps/cli`
5. Update or create the spec in `docs/specs/` covering that type's behavior and
   user-visible rules
6. New CLI types must **not** require edits to top-level Convex modules like
   `convex/http.ts` — those delegate through the runtime subsystem

Remember to bump `apps/cli/package.json` for any `apps/cli` change.

## Key files

| File | Purpose |
|---|---|
| `src/agent/agent-runner.ts` | Orchestrates registration, heartbeat, message subscription, shutdown |
| `src/agent/claude-code.ts` | Spawns Claude Code subprocess, yields JSON stream chunks |
| `src/agent/message-handler.ts` | FIFO queue processing claimed chats sequentially in run loops |
| `src/commands/connect.ts` | `convoy connect` — starts the long-running agent |
| `src/commands/setup.ts` | Interactive setup wizard (URL → API key → project → profile) |
| `src/lib/config/` | Profile TOML config system (read/write/resolve) |

## Backend tables

| Table | Purpose |
|---|---|
| `cliSessions` | Active CLI connections (one per process, heartbeat-tracked) |
| `cliProfiles` | User+project identity with hostname, paths, git remote URLs |
| `cliThreads` | Chat threads with queue flags, claim lease state, processing status |
| `cliMessages` | User/assistant message envelopes and run processing markers |
| `cliMessageChunks` | Streamed chunk rows with `normalizedEvent` (the render source) |

## CLI commands

```bash
convoy              # Smart default: setup if new, connect if profile matches
convoy setup        # Interactive setup wizard
convoy connect      # Start long-running agent connection
convoy config list  # List all profiles
convoy config show  # Show resolved profile for current directory
convoy paths list   # List paths for resolved profile
convoy paths add    # Add path to profile
convoy status       # Show configuration and connection status
```
