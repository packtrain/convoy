# CLI Runtime Slash Commands Specification

Runtime slash commands (OS-1118): forwarding the agent's own slash commands —
built-ins like `/compact`, user/project custom commands, skills — from the web
thread composer to the running CLI runtime.

Not to be confused with org-owned prompt-expansion slash commands
(`docs/specs/slash-commands.md`), which expand to stored markdown *text* and
ride the normal message pipeline. Runtime commands are forwarded verbatim and
interpreted by the agent itself.

## User-visible behavior

- The thread composer's `/` autocomplete offers **agent commands** (from the
  runtime's advertised inventory) alongside org prompt-expansion commands.
  Selecting one inserts the literal text (`/compact `); no ref node, no
  expansion.
- A row shows the command's own **description** as its secondary text and its
  **argument hint** dimmed after the name (`/review [pr-number] — Review a
  PR`). A runtime that advertises names only keeps the generic
  `Agent command` label, and a command with no hint shows none.
- **Autosend (OS-1614):** selecting a *no-argument built-in* from the menu
  submits the message immediately instead of leaving it in the draft. The
  allowlist is `AUTO_SUBMIT_RUNTIME_COMMANDS` in
  `apps/web/lib/slash-commands/composer.ts` — currently `compact` and `usage`.
  Everything else (custom commands, skills, prompt templates) takes free-text
  arguments, so it must stay editable. The allowlist is matched
  case-insensitively against the advertised name.
  - Autosend reuses the stored-prompt autosubmit machinery, so all of its
    guards apply unchanged: menu selection only (click/Enter/Tab — a typed
    literal `/compact` never sends, since the inventory may be stale), the
    draft outside the command must be whitespace, the visible Submit button's
    disabled state is honored, composers with sending hidden never send, and
    one selection causes at most one submission. See
    `docs/specs/slash-commands.md`.
- A runtime-command message is the **whole message**: `/name` plus optional
  free-text args. Mixing prose and a command in one message sends prose.
- Commands are only recognized when the first token matches the advertised
  inventory; anything else is ordinary prose (typos included — the list may
  be stale, and the runtime is the authority on unknown names).
- Session commands execute against the thread's resumed session, so `/compact`
  compacts that thread's context. Output streams into a normal assistant
  message.
- Attachments disable command recognition for that message (sent as prose).
- Queued runtime commands cannot be steered into a running turn (no Steer
  button in the queued strip; `requestSteer` rejects). They wait for their
  own run.
- **Compact button (OS-2339):** the context-window popover has a "Compact context"
  menu row whenever the thread's inventory advertises `compact`. It sends
  `/compact` as a runtime command with `queueFirst`, so it runs before every
  message already queued, and it leaves the composer draft alone. It still
  waits for the in-progress run, and like any send it releases a held queue.
  A typed or menu-selected `/compact` keeps FIFO order.
- Cold start: Codex `/usage` is available immediately in every shared composer,
  including new threads. Convoy implements it locally, so both menu selection
  and typed `/usage` submissions carry `runtimeCommand: true` before discovery.
  The shared create-thread hook forwards this flag to both root-thread and
  group-tab creation mutations. Selecting `/usage` sends it immediately under
  the autosend guards above.
  Claude Code `/goal` is assumed the same way, but only while the inventory
  is empty, so a new thread can open on `/goal <condition>` (OS-2276). As
  prose it would ride the message envelope and Claude would just do the task.
  Once Claude reports its inventory, that list decides. Codex `/goal` is
  assumed the same way (OS-2277): Codex reports its inventory only after its
  first run, so without this a new Codex thread could not open on a goal. A
  CLI older than 0.130.0 cannot run it and sends it to the model as prose.
  Other runtime commands still require the runtime's advertised inventory.
  Switching away from Codex removes this local default. Attachments and mixed
  prose retain the normal command-boundary rules. On the exec transport,
  `/usage` fails explicitly instead of reaching a model as prose.

## Discovery: runtime facts channel

Generic CLI→server inventory mechanism; slash commands are the first key.

- Table `cliRuntimeFacts`: one row per `(profileId, cliType, key, pathId)`
  with a JSON `payload` and `reportedAt`. Upsert, last writer wins; unchanged
  payloads are no-ops.
- Capture is **server-side**: `cli.messages.appendRunContent` asks the
  runtime registry (`getSlashCommandsFromIncomingChunks`) to extract the
  inventory from incoming chunks. Claude Code implements
  `extractSlashCommandsFromChunks` (parses the `system`/`init` event's
  `slash_commands: string[]` and mid-session `system`/`commands_changed`
  events' `commands[]`; the last event in a run wins, and the synthetic
  chunk below wins over both); OpenCode parses
  the CLI runner's synthetic
  `convoy.commands` chunk (see below); Codex parses the same synthetic
  chunk. Runtimes without the hook capture
  nothing — implementing it is what opts a runtime in. No CLI-side reporting
  round-trip for discovery.
- OpenCode's server does not advertise commands in its event stream, so the
  CLI runner (≥ 0.10.0) calls the SDK's `command.list()` after connecting and
  emits the names as a synthetic chunk
  `{ type: "convoy.commands", data: '{"commands": [...]}' }` at the start
  of every run (fail-soft: discovery failure never fails the run). The chunk
  normalizes to silent metadata — nothing renders.
  `command.list()` covers template commands only and has no `compact` entry,
  so the runner (≥ 0.43.0) appends the built-ins it executes through
  dedicated endpoints (`withOpencodeBuiltinCommands`, currently `compact`).
  Those are advertised even when `command.list()` fails, because executing
  them does not depend on that call.
- Codex advertises nothing in its stream either, so the CLI's app-server
  runner (≥ 0.42.0) emits the same synthetic chunk listing the built-ins it
  can execute (`compact` and `usage`). The exec transport emits an empty list.
- Cursor likewise advertises nothing in its stream, so the CLI runner
  (≥ 0.14.0) scans `<cwd>/.cursor/commands/` and `~/.cursor/commands/` for
  `*.md` files at run start (basenames become command names; the project
  directory wins name collisions) and emits the same synthetic
  `convoy.commands` chunk. Both runtimes' extractors share
  `shared/syntheticCommands.ts`.
- Claude Code's own stream advertises **names only** — the descriptions and
  argument hints live in the Agent SDK's initialize control response, not in an
  event. So the CLI runner (≥ 0.54.0) calls `supportedCommands()` once per run
  at the first result, while the control channel is still open, and emits the
  same synthetic `convoy.commands` chunk with
  `{ name, description?, argumentHint? }` entries (OS-1806). Fail-soft like the
  context-usage snapshot next to it: an older CLI, a closed channel or an empty
  inventory just skips the chunk, and the init-event names still land. Empty
  description/hint strings — what the SDK sends for "absent" — are dropped at
  the boundary so nothing renders a blank label.
- Payload for key `slashCommands`:
  `{ "commands": (string | { name, description?, argumentHint? })[] }`. A bare
  string is a name with no metadata: that is what rows written before OS-1806
  hold, and what a names-only runtime still reports. Reads normalize both forms
  to objects.
- Read path: `cli.facts.getThreadRuntimeCommands({ threadId })` (web
  user-auth) resolves the thread's `(profileId, cliType, pathId)` and returns
  `RuntimeSlashCommand[]`; a path
  without its own fact falls back to any sibling path's fact for the same
  profile+cliType (fresh worktrees inherit the repo's inventory).
- Facts are profile-scoped and survive sessions/reconnects, so the composer
  works while the agent is offline.
- Boundary rule for future capabilities: small + stable + useful-offline
  inventory → facts push; large/dynamic/parameterized lookups (@-file
  mentions, command execution) → a separate web→CLI RPC channel (not this
  spec).

## Message contract

- `cliMessages.runtimeCommand?: boolean` — set by `cli.messages.send` when
  the client passes `runtimeCommand: true` **and** the trimmed content starts
  with `/` **and** there are no attachments. Org-command ref expansion
  (`processedContent`) is skipped for these messages.
- The flag is surfaced on message items/envelopes (`listByThread`,
  `listEnvelopesByThread`, `listUnprocessedUserMessages`).
- `requestSteer` rejects runtime-command messages (`STEER_NOT_AVAILABLE`).
- `cliMessages.queueFirst?: boolean` (OS-2339) — `send` stores it only on a
  runtime-command message. `listUnprocessedUserMessages` (the repo read behind
  the CLI queue and the cancel path) returns `queueFirst` messages first, FIFO
  among themselves, then the rest of the queue. Stranded-run recovery still
  leads. The CLI keeps the order it is handed, so this needs no CLI change.
  The queued strip sorts the same way. `startRunResponse` rejects a selection
  of queued prose while a `queueFirst` command heads the queue
  (`USER_MESSAGES_NOT_PENDING`, which the CLI retries with a fresh read), so a
  command that lands after the CLI read the queue still runs first. A
  selection of only stranded messages is accepted. `editLastResend` keeps the
  flag only while the message stays a runtime command.
- The composer detects command shape at submit (`isRuntimeCommandMessage`:
  first token ∈ advertised list) and passes the flag; the backend re-checks
  only the cheap invariants above, not the inventory.

A pending workspace recovery notice is deferred until the next ordinary run.
Cursor preserves `rawRuntimeCommand` through preparation and the runner so the
stdin payload stays verbatim even when recovery context is available.

## Agent callers (MCP)

MCP `send_thread_message` takes the same `runtimeCommand` flag, so an agent can
compact another thread's context (or its own, on a later run). Everything below
the flag — boundary slicing, per-runtime dispatch, the steer rejection — is
shared with the composer; only the caller differs. See
[mcp-server.md](mcp-server.md).

- **The MCP handler rejects the flag on content not starting with `/`.** `send`
  drops it silently, which would queue the text as prose and let the agent
  report a compaction that never happened — OS-1582, unwitnessed.
- `create_thread` takes the same flag, so a spawned thread's **first** message
  can be a command (`/security-review`) instead of a prompt. `api.cli.threads.core.create`
  and `addThreadToGroup` share one `runtimeCommand` argument, applied in
  `createThreadCore` under `send`'s invariants: no attachments, content starts
  with `/`, and org-command ref expansion is skipped. The handler carries the
  same visible rejection, for the same reason.
- **A first-message command is allowed only for runtimes whose bootstrap does
  not ride that message** (`supportsFirstMessageRuntimeCommand` on the web
  runtime definition, read through
  `cliTypeSupportsFirstMessageRuntimeCommand`): `claude-code` (system-prompt
  append every run) and `codex` (app-server re-passes `developerInstructions`;
  the exec transport rejects runtime commands anyway). `cursor` and `opencode`
  are `agentPromptDelivery: "first-message"`, and a command there either
  displaces the bootstrap (cursor prepends the identity line to the raw
  command, so cursor-agent no longer sees a bare command) or skips it forever
  (opencode's command branch never injects, yet still returns a
  `continuationId`, so no later run injects either). `createThreadCore` rejects
  those `cliType`s with `RUNTIME_COMMAND_FIRST_MESSAGE_UNSUPPORTED` rather than
  silently degrading — the caller asked for a command. Lifting the restriction
  means delivering the bootstrap off the prompt channel in those two runners.
- `/compact` as a thread's first message is legal but pointless — a new thread
  has no context to compact. The case this serves is opening on a custom command
  or skill, so in practice this is a `claude-code` feature.
- **Unrecognized names behave differently per runtime**, on both tools: codex
  falls back to the prose run envelope (`parseSoloCodexCommand` returns null
  for anything but `compact` or `usage`), so the model may answer as if it had run the
  command; opencode forwards any name to `commandAsync` and fails the run on an
  unknown one; claude-code and cursor hand it to the runtime itself. Agent-facing
  descriptions say so, since MCP has no way to list a thread's inventory.
- Convoy's own prompt-expansion commands are **not** reachable this way, on
  either tool: expansion needs the composer's `composerDocument` refs, which no
  agent surface sends. An agent inlines a prompt's `content` from `list_prompts`
  instead (see [slash-commands.md](slash-commands.md)).
- The one-shot CLI (`convoy threads create` / `threads send`) has no flag for
  this — an agent that can reach the CLI can reach MCP.
- **No inventory is checked, because an agent has none.**
  `cli.facts.getThreadRuntimeCommands` is web-user-auth and no tool exposes it,
  so an unknown command reaches the runtime and fails that run on the runtimes
  that parse commands. The tool description names `/compact` and its supported
  `cliType`s rather than the mechanism in general.

## CLI processing

- The thread processor slices each run at runtime-command boundaries
  (`sliceRunMessagesAtRuntimeCommandBoundary`): a command message always forms a
  **solo run**; prose messages share a run up to the next command. FIFO
  order (apart from `queueFirst` above) and all claim/lease/retry invariants
  are unchanged — a command is just a one-message run.
- `RuntimeUserMessageInput.runtimeCommand` marks the message for
  `prepareRunExecution`. Claude Code returns the trimmed content as the raw
  prompt (`inputFormat: "prompt"`, no `--- user-message-N ---` envelope, no
  run preamble) so the Agent SDK interprets the command natively against
  the resumed session.
- OpenCode does not interpret slash text in prompts, so its
  `prepareRunExecution` additionally parses the solo command into
  `PreparedRuntimeExecution.runtimeCommand: { command, arguments? }`; the
  runner then executes it via the SDK's `session.command()` instead of
  `promptAsync()`. `session.command` resolves only when the turn completes,
  so the runner fires it un-awaited and lets the normal event loop stream
  the turn and detect completion (idle signal); a rejection fails the run
  with the provider message.
  `/compact` is not a `command.list()` command, so the runner dispatches it to
  `session.summarize()` instead (`isOpencodeBuiltinCommand`). That endpoint
  **requires an explicit provider/model**, so a thread on the default model
  resolves one in order: the run's model → the session's own model → the
  machine's provider default; with none resolvable the run fails with an
  actionable message rather than silently skipping the compaction.
  Compaction streams as an ordinary turn and emits `session.compacted` before
  going idle, so the runner's normal completion detection applies; the runner
  forwards that event and the backend normalizes it to a
  `context-compaction` row ("Conversation compacted").
- Codex likewise does not interpret slash text (in the codex TUI these are
  client-side affordances), so its `prepareRunExecution` parses a solo
  command into `PreparedRuntimeExecution.runtimeCommand` and the app-server
  runner dispatches it to that command's RPC — `/compact` →
  `thread/compact/start`. Compaction still runs as an ordinary turn
  server-side (`turn/started` → `contextCompaction` item → `turn/completed`),
  so the runner's normal completion detection applies; the RPC itself returns
  an empty result, so the turn id is learned from `turn/started`.
  `/usage` reads account quota before opening or resuming any thread and
  returns a timestamped report without a model turn. See the
  [Codex account usage contract](cli-codex-runtime.md#account-usage-on-request-os-2001).
  A command passed to the runner with no RPC mapping fails the run.
- **Runtimes must only advertise commands they can execute.** Discovery feeds
  the autocomplete, and the autocomplete is what marks a message as a runtime
  command, so an advertised-but-unexecutable command is delivered as prose —
  and an agent may then *narrate* having run it. That was OS-1582: `/compact`
  reached Codex as prose and the model replied "Context compacted." while
  nothing was compacted, with no `contextCompaction` item and no drop in
  context usage. Silent false success is worse than a visible failure. This is
  why Codex's exec transport (no per-thread RPC channel) advertises nothing
  and fails these runs explicitly.
- Runtimes without raw delivery simply keep wrapping (harmless *only* when the
  agent itself rejects unknown slash text — see the rule above). CLI ≥ 0.9.0
  slices runs; older CLIs deliver the command inside a wrapped run —
  degraded, not lost.

## Runtime support matrix

| `cliType` | Discovery | Execution |
|---|---|---|
| `claude-code` | init event (`slash_commands`); local `/usage` before discovery | `/usage` uses the SDK usage control request, with no prompt; other commands use raw prompts. `/goal` replies and Stop hook checks drive the composer goal button ([cli-thread-goal.md](cli-thread-goal.md)) |
| `opencode` | synthetic `convoy.commands` chunk from `command.list()` plus the built-ins executed through dedicated endpoints (`compact`, CLI ≥ 0.43.0) | `session.command()` RPC (OS-1120); `/compact` → `session.summarize()` (OS-1614) |
| `codex` | synthetic `convoy.commands` chunk listing the built-ins backed by an app-server RPC (`compact`, `usage`, `goal` with description and argument hint, CLI ≥ 0.130.0); exec transport advertises nothing (CLI ≥ 0.42.0). Custom prompts (`~/.codex/prompts`) are still OS-1119 | dedicated app-server RPC per command (`/compact` → `thread/compact/start`, `/usage` → `account/rateLimits/read`, `/goal` → `thread/goal/get`/`set`/`clear`, see [cli-thread-goal.md](cli-thread-goal.md#codex)); exec transport fails the run (OS-1582) |
| `cursor` | synthetic `convoy.commands` chunk from a CLI-side scan of `<cwd>/.cursor/commands/` + `~/.cursor/commands/` (`*.md` basenames, project wins dedup, CLI ≥ 0.14.0) | raw prompt (cursor-agent interprets slash text; unknown commands degrade to prose) |

`/compact` is therefore offered on `claude-code`, `codex` (app-server
transport) and `opencode`. **Cursor deliberately has none:** `cursor-agent
--print` resolves only custom commands and skills — compaction is a TUI-side
affordance with no print-mode equivalent — so advertising it would deliver
`/compact` as prose and let the model narrate a compaction that never
happened (the OS-1582 failure mode). It stays absent until cursor-agent
exposes a real handle.
| others | none | none |

Because discovery is what feeds the autocomplete, unsupported runtimes never
offer agent commands — no separate capability flag is needed.

## Adding a runtime

1. Implement `extractSlashCommandsFromChunks` on the backend runtime
   definition (`convex/cli/lib/runtimes/<type>/runtime.ts`).
2. Make the runtime's CLI `prepareRunExecution` deliver a solo
   `runtimeCommand` message raw (or via the runtime's native command RPC).
3. Update the matrix above.

## Out of scope (deliberate)

- Steering commands into a running turn.
- Client-side emulation of built-ins (`/clear`, `/model`); everything is
  forwarded verbatim, and headless-nonsensical commands fail visibly in the
  stream.
- Argument-schema UI; args are free text after the command name.
- Send-time validation against the inventory (stale lists would reject valid
  commands).
