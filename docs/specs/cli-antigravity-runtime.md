# Antigravity runtime specification

This spec covers how the `antigravity` runtime runs Antigravity CLI (`agy`) in Convoy. The transport is the Agent Client Protocol (ACP), JSON-RPC 2.0 over newline-delimited stdio. Each run spawns its own `agy acp` process.

Status: slice 1 of the epic OS-2464 (OS-2468). A thread runs in Act mode on the account's default model. It streams text, reasoning and tool calls, follows up in the same agy session and stops on Stop. Ask to approve, models, slash commands, the context meter, images, steering, `convoy init`, environments and keys come in later slices.

Every fact below is marked **verified** when it comes from traffic recorded on agy 1.5.13 (signed in, Linux container, 2026-11-20) or **t3code** when it only comes from t3code's source in `reference/t3code`.

## Scope

- Executor in `apps/cli/src/agent/runtimes/antigravity/`. It uses the protocol-only ACP client in `runtimes/acp/client.ts` and the shared JSON-RPC client in `runtimes/json-rpc.ts`.
- Backend normalization in `apps/web/convex/cli/lib/runtimes/antigravity/`, composed over the generic ACP mapping in `runtimes/acp/normalizeChunk.ts`.
- Selector, icon and modes in `apps/web/lib/cli-runtime-ui/antigravity.tsx`.

Code that names agy lives in the `antigravity` folders. The `acp` folders hold protocol code only, so a later ACP agent can reuse them.

## Detection

- Executable: `CONVOY_ANTIGRAVITY_EXECUTABLE`, then `agy`, then `antigravity` on `PATH`. The binary is `antigravity`, usually linked as `agy`.
- `agy --version` prints a bare `1.5.13` (verified). Versions below 1.5.12 are not advertised.
- The advertised row is the generic `{ type: "antigravity", version }`, as for Cursor.
- The composer disables Antigravity on a machine that doesn't advertise it. A CLI older than 0.151.0 doesn't know the runtime and would leave the thread pending ("Unsupported cliType" in its log).
- Detection does not check sign-in. The only check is `session/new`, which would leave an empty conversation in the user's agy history on every registration.

## Execution

One `agy acp --dangerously-skip-permissions` process per run, spawned detached in the run's working directory. Convoy passes neither `--gemini-dir` nor `--app-data-dir`, so runs use the user's own profile and sign-in under `~/.gemini/antigravity-cli`.

Child environment: the CLI's env minus `CONVOY_API_KEY` and a managed Claude provider's variables, plus `CONVOY_THREAD_ID` and `AGY_CLI_DISABLE_AUTO_UPDATE=1`.

Per run:

1. `initialize` with `protocolVersion: 1` and `clientCapabilities` `{ fs: { readTextFile: false, writeTextFile: false }, terminal: false }`. agy answers protocol version 1, `agentInfo.version` and `agentCapabilities._meta.antigravity.systemPrompt.append: true` (verified). It answers in about 0.1 seconds (verified).
2. `session/new` with `cwd` and `mcpServers: []`, or `session/resume` with the stored session id when the run has a `continuationId`. Both carry `_meta.antigravity.systemPrompt.append` with the bound Project agent prompt, the thread identity line and the workspace notice. agy accepts the append on resume (verified). When `initialize` lacks the capability, the runner prepends the same text to the prompt. `session/new` returns the session id, model list, modes and config options in about one second (verified).
3. `session/prompt` with one text block. The response carries `stopReason` and `usage` (verified).

Signed out, `session/new` fails at once with `-32000 Authentication required` (verified). The runner then calls `authenticate` with `oauth-personal` once and retries. In a headless container that call fails at once with -32603 "No browser is available here" (verified). Whatever fails, the run ends with "Antigravity is not signed in on this machine. Run `agy` in a terminal and sign in, then send the message again." On a desktop the call may open a browser, which nobody has checked yet. The same fallback applies to a signed-out `session/resume`.

**Cancel.** Stop sends the `session/cancel` notification and waits for the prompt response. agy marks the running tool `failed` with empty output and answers `stopReason: "cancelled"` within a few milliseconds (verified). The runner SIGKILLs the process group 5 seconds after Stop if agy is still alive, as Codex does, and kills it after every run.

**Idle watchdog.** No ACP traffic for 600 seconds kills the run, as for Codex.

**Permission requests.** In this slice any `session/request_permission` is answered without the user. A request whose `toolCallId` starts with `interaction_` (an agent question, t3code) gets `cancelled`. Every other request gets its `allow_once` option. In Act mode with `--dangerously-skip-permissions`, agy sent no permission request in any recorded scenario (verified). OS-2469 replaces this with the interaction bridge.

Other agent requests, such as `fs/*` or `terminal/*`, get a method-not-found error. The client advertises neither.

## Chunk contract

| Chunk type | Data |
|---|---|
| `convoy/acp_session` | `{ sessionId, agentVersion }`, sent after new or resume. The continuation id comes from here |
| `session/update` | the notification params as agy sent them, with tool updates compacted (below) |
| `convoy/acp_text`, `convoy/acp_reasoning` | `{ sessionId, text }`, the accumulated text of one segment. Sent when an update of another kind arrives or the prompt ends |
| `convoy/acp_prompt_result` | `{ sessionId, stopReason, usage }` |

- ACP sends text only as `agent_message_chunk` and `agent_thought_chunk` deltas, never as a whole message (verified). These are forwarded as `session/update` chunks only when partial streaming is on. The backend marks them ephemeral, and the flush buffer merges consecutive chunks of one kind.
- Not forwarded in this slice: `available_commands_update`, `usage_update`, `session_info_update`, `current_mode_update` and `config_option_update`. They do not close a text segment. Later slices use them for slash commands, the context meter and models.
- Tool updates are compacted before sending. agy repeats `rawInput` as `args` and a command's `rawOutput.output` as a text content block (verified), so the runner drops both copies. Every remaining string keeps its last 8,000 characters, as t3code does, behind an `[N characters omitted]` line so a clipped file or command never reads as whole.

## Modes

| Thread mode | agy |
|---|---|
| `agent`, labeled "Act" | `--dangerously-skip-permissions`, session mode left at agy's `default` |

agy 1.5.13 advertises the session modes `default`, `accept-edits`, `auto` and `plan` (verified). Convoy does not set one yet.

## Event normalization

The generic ACP part (`normalizeAcpChunk`):

| Chunk | Normalized event |
|---|---|
| `session/update` × `agent_message_chunk` | `text-delta` (ephemeral) |
| `session/update` × `agent_thought_chunk` | `reasoning-delta` (ephemeral) |
| `convoy/acp_text` | `text` |
| `convoy/acp_reasoning` | `reasoning` |
| `session/update` × `tool_call` | `tool-input` |
| `session/update` × `tool_call_update` × `completed` | `tool-output`, or `tool-error` when the adapter reports one |
| `session/update` × `tool_call_update` × `failed` | `tool-error` |
| `session/update` × `tool_call_update` × other status | silent `metadata` |
| `session/update` × `plan`, `user_message_chunk`, `usage_update`, `session_info_update`, `available_commands_update`, `current_mode_update`, `config_option_update` | silent `metadata` |
| `convoy/acp_prompt_result` × `refusal`, `max_tokens`, `max_turn_requests` | `warning` (`acp-<stopReason>`) |
| `convoy/acp_prompt_result` × other stop reason | silent `metadata` |
| `convoy/acp_session` | silent `metadata` with `sessionId` |
| anything else | `unknown` |

`toolCallId` pairs input with output. Without an adapter a tool is named by its `title`, its input is `rawInput` and its output is `rawOutput` or the content text.

The Antigravity part (`normalizeAntigravityChunk`) maps agy's tool `name` onto the names the renderers in `apps/web/lib/ai-tools/` know:

| agy tool | Renders as | Input |
|---|---|---|
| `run_command` (verified) | `Bash` terminal row | `command` from `rawInput.CommandLine` (verified), or the aliases `commandLine`, `command_line`, `command` (t3code), or a "Running X" / "Run `X`?" title (t3code); `description` from `toolSummary` |
| `write_file` (verified) | `Write` | `file_path` from `Path`, `content` from `Content` |
| `edit_file` (verified) | `Edit` | `file_path` from `Path`, `old_string` from `Target`, `new_string` from `Replacement`, falling back to the diff block's `oldText` and `newText` |
| `read_file` (verified), `view_file`, `client_view_file` (t3code) | `Read` | `file_path` from `Path` |
| `search_web` (verified) | `WebSearch`, generic tool row | `rawInput` as is (`query`, optional `domain`) |
| anything else | its agy name, generic tool row | `rawInput` |

- A command's output text is everything after agy's `Command output:` line, with CRLF turned into LF. agy puts creation and completion timestamps and the exit code above it (verified).
- A nonzero `rawOutput.exit_code` inside a `completed` update is a failed command (verified with `exit 3`). The error text names the exit code and carries the output.
- A `failed` command with no output, as after Stop, reads "Command did not finish."
- `read_file` and `search_web` updates carry no output in 1.5.13 (verified), so those rows show only their input.
- `refusal` reads as a quota warning. t3code reports that agy uses it when the quota is used up.
- t3code reports a duplicate `formatted_output` field. 1.5.13 sent none, so nothing handles it.

## Continuation

The ACP session id is the `continuationId`. A follow-up spawns a new process and calls `session/resume`, which does not replay history (verified). The resumed session remembered the earlier turn's file edit (verified).

## Known limitations

- Act mode only. No model picker, thinking level, slash commands, context meter, image attachments, steering or local resume command.
- Isolation (`--isolated`) fails fast, as for Cursor and OpenCode.
- A command agy moves to the background survives the run. agy ran `sleep 120` with a 500 ms `WaitMsBeforeAsync`, ended the prompt with `end_turn`, and the `sleep` kept running after its process group was killed (verified). OS-2472 owns commands that outlive the prompt.
- Upstream API errors that agy reports as a normal reply are not detected. t3code reads agy's session database for this.
- No cost rollups. The pricing catalog has no Gemini models and Antigravity bills by subscription.

## Related specs

- Runtime subsystem layout: [cli-runtime-architecture.md](cli-runtime-architecture.md)
- Codex app-server runner, the executor template: [cli-codex-runtime.md](cli-codex-runtime.md)
- Thread modes: [cli-thread-modes.md](cli-thread-modes.md)
- Agent prompt delivery: [cli-thread-agents.md](cli-thread-agents.md)
- Sandboxing: [cli-sandboxing.md](cli-sandboxing.md)
- Chunk storage and ephemeral rules: [cli-message-chunks-storage.md](cli-message-chunks-storage.md)
