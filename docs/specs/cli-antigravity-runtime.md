# Antigravity runtime specification

This spec covers how the `antigravity` runtime runs Antigravity CLI (`agy`) in Convoy. The transport is the Agent Client Protocol (ACP), JSON-RPC 2.0 over newline-delimited stdio. Each run spawns its own `agy acp` process.

Status: slices 1 to 3 of the epic OS-2464 (OS-2468, OS-2469, OS-2470). A thread runs in Act or Ask to approve mode on the model and thinking level picked in the composer. It streams text, reasoning and tool calls, shows approval and question cards, follows up in the same agy session and stops on Stop. Slash commands, the context meter, images, steering, `convoy init`, environments and keys come in later slices.

Every fact below is marked **verified** when it comes from traffic recorded on agy 1.5.13 (signed in, Linux container, 2026-11-20) or **t3code** when it only comes from t3code's source in `reference/t3code`.

## Scope

- Executor in `apps/cli/src/agent/runtimes/antigravity/`. It uses the protocol-only ACP client in `runtimes/acp/client.ts` and the shared JSON-RPC client in `runtimes/json-rpc.ts`.
- Backend normalization in `apps/web/convex/cli/lib/runtimes/antigravity/`, composed over the generic ACP mapping in `runtimes/acp/normalizeChunk.ts`.
- Selector, icon and modes in `apps/web/lib/cli-runtime-ui/antigravity.tsx`.

Code that names agy lives in the `antigravity` folders. The `acp` folders hold protocol code only, so a later ACP agent can reuse them.

## Detection

- Executable: `CONVOY_ANTIGRAVITY_EXECUTABLE`, then `agy`, then `antigravity` on `PATH`. The binary is `antigravity`, usually linked as `agy`.
- `agy --version` prints a bare `1.5.13` (verified). Versions below 1.5.12 are not advertised.
- The advertised row is `{ type: "antigravity", version, models? }`. `models` comes from the inventory session in [Models and thinking level](#models-and-thinking-level).
- The composer disables Antigravity on a machine that doesn't advertise it. Registration drops the Antigravity row from a CLI older than 0.153.0 (`minAppVersion`, see [cli-minimum-version.md](cli-minimum-version.md#per-runtime-minimum)). 0.151.0 runs every thread with `--dangerously-skip-permissions`, so it would run Ask to approve threads without asking. 0.152.x never sets the model or thinking level, so a remembered selection would run on agy's default while the thread shows the selection. Older CLIs don't know the runtime.
- Detection does not report sign-in. A signed-out agy fails the inventory, so it registers without `models`, and its first run fails with the sign-in message.

## Execution

One `agy acp` process per run, with `--dangerously-skip-permissions` in Act mode only (see [Modes](#modes)), spawned detached in the run's working directory. Convoy passes neither `--gemini-dir` nor `--app-data-dir`, so runs use the user's own profile and sign-in under `~/.gemini/antigravity-cli`.

Child environment: the CLI's env minus `CONVOY_API_KEY` and a managed Claude provider's variables, plus `CONVOY_THREAD_ID` and `AGY_CLI_DISABLE_AUTO_UPDATE=1`.

Per run:

1. `initialize` with `protocolVersion: 1` and `clientCapabilities` `{ fs: { readTextFile: false, writeTextFile: false }, terminal: false }`. agy answers protocol version 1, `agentInfo.version` and `agentCapabilities._meta.antigravity.systemPrompt.append: true` (verified). It answers in about 0.1 seconds (verified).
2. `session/new` with `cwd` and `mcpServers: []`, or `session/resume` with the stored session id when the run has a `continuationId`. Both carry `_meta.antigravity.systemPrompt.append` with the bound Project agent prompt, the thread identity line and the workspace notice. agy accepts the append on resume (verified). When `initialize` lacks the capability, the runner prepends the same text to the prompt. `session/new` returns the session id, model list, modes and config options in about one second (verified).
3. When the thread has a model, `session/set_config_option` for it, then for the thinking level. See [Models and thinking level](#models-and-thinking-level).
4. `session/prompt` with one text block. The response carries `stopReason` and `usage` (verified).

Signed out, `session/new` fails at once with `-32000 Authentication required` (verified). The runner then calls `authenticate` with `oauth-personal` once and retries. In a headless container that call fails at once with -32603 "No browser is available here" (verified). Whatever fails, the run ends with "Antigravity is not signed in on this machine. Run `agy` in a terminal and sign in, then send the message again." On a desktop the call may open a browser, which nobody has checked yet. The same fallback applies to a signed-out `session/resume`.

**Cancel.** Stop sends the `session/cancel` notification and waits for the prompt response. agy marks the running tool `failed` with empty output and answers `stopReason: "cancelled"` within a few milliseconds (verified). The runner SIGKILLs the process group 5 seconds after Stop if agy is still alive, as Codex does, and kills it after every run.

**Idle watchdog.** No ACP traffic for 600 seconds kills the run, as for Codex.

**Permission requests.** See [Permissions and questions](#permissions-and-questions).

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
| `default`, labeled "Ask to approve" | no flag, session mode left at agy's `default` |

agy 1.5.13 advertises the session modes `default`, `accept-edits`, `auto` and `plan` (verified). Convoy sets none. t3code reports that agy rejects `yolo` and `auto_edit`, so Act stays the spawn flag. Any thread mode other than `default` runs as Act.

## Permissions and questions

Ask to approve needs CLI 0.152.0, and the runtime as a whole needs 0.153.0. Older CLIs are not offered Antigravity at all (see [Detection](#detection)).

**What agy asks.** In `default` mode agy 1.5.13 asked before `ls -la` and not before writing `notes.txt` inside the workspace (verified). The request is the tool call itself: `toolCall` carries the whole `tool_call` update (`toolCallId`, `name`, `kind`, `status: "pending"`, `title`, `rawInput`), and a `tool_call_update` with `status: "pending"` comes just before it (verified). For `ls -la` the options were `{ optionId: "allow", name: "Allow", kind: "allow_once" }` and `{ optionId: "deny", name: "Deny", kind: "reject_once" }`, with no `allow_always` (verified). A declined command ends `failed` with empty output, and agy carries on with the turn (verified).

**Validation.** The ACP client answers `cancelled` to a request with no `toolCallId`, or with an empty or repeated option id, and never shows it.

**Tool approval.** Every request whose `toolCallId` does not start with `interaction_` becomes a `tool-approval` bridge request:

| Payload field | Value |
|---|---|
| `toolName` | the agy tool name, e.g. `run_command` |
| `title` | "Antigravity wants to run a command" (`kind: "execute"`), "Antigravity wants to edit a file" (`kind: "edit"`), else "Antigravity wants to use <name>" |
| `inputJson` | `rawInput`, plus `command` from `CommandLine` and `file_path` from `Path` for the card preview |
| `description` | the `allow_always` option's `_meta["agy.security.warning"]` message, or its title (t3code) |
| `hasSuggestions` | true when agy offers `allow_always`, so the card shows Always allow |

The web decision picks an option by kind, never by id, because ids are opaque:

| Web decision | Option kinds, nearest first |
|---|---|
| `allow` | `allow_once`, `allow_always` |
| `allow-always` | `allow_always`, `allow_once` |
| `deny` | `reject_once`, `reject_always` |
| anything else | `cancelled` outcome |

When no listed kind is offered the reply is `cancelled`.

**Questions.** agy 1.5.13 asks with its `ask_question` tool and no permission request (verified). The `tool_call` carries `rawInput.questions[]` of `{ question, options: string[], is_multi_select }`. agy prints the question as text, leaves the call `pending` and ends the turn with `end_turn`. It reads the next prompt as the answer, including after `session/resume` in a new process, and sends no late update for the old call (verified). The backend maps the call to an `AskUserQuestion` tool row and the `pending` update to a `tool-error`, which makes the row the inline questionnaire from [cli-ask-user-question-ui.md](cli-ask-user-question-ui.md). Its submitted answer is an ordinary user message and starts the next run. This works in both modes.

t3code also reports questions as a permission request whose `toolCallId` starts with `interaction_`, with the question in `toolCall.title` and each option a choice whatever its kind. Such a request becomes a `question` bridge request with one question, `multiSelect: false`, `isOther: false` and the option names as labels. The answer maps back to the option id by label, so a `reject_once` choice is an ordinary answer. An unknown or ambiguous label is `cancelled`. agy 1.5.13 sent none in any recorded scenario.

**Lifecycle.**

- Requests reach the bridge only while a `session/prompt` is open. One that arrives after the prompt response is answered `cancelled`. OS-2472 owns requests from commands that outlive the prompt.
- When the prompt response arrives with requests still open, agy has withdrawn them. The runner cancels each with `abandoned: false` and answers `cancelled`.
- When the run is stopped or fails, open requests are cancelled with `abandoned: true` before `session/cancel` goes out, and agy gets `cancelled`.
- While a request is open, the idle watchdog re-arms instead of killing the run.
- Without an interaction bridge on the connection, tool requests get `allow_once` and `interaction_` questions get `cancelled`.

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
| `session/update` × `tool_call_update` × other status | `tool-error` when the adapter reports one, else silent `metadata` |
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
| `ask_question` (verified) | `AskUserQuestion` inline questionnaire | `questions[]` with `question`, `multiSelect` from `is_multi_select`, `options` as `{ label }` |
| anything else | its agy name, generic tool row | `rawInput` |

- A command's output text is everything after agy's `Command output:` line, with CRLF turned into LF. agy puts creation and completion timestamps and the exit code above it (verified).
- A nonzero `rawOutput.exit_code` inside a `completed` update is a failed command (verified with `exit 3`). The error text names the exit code and carries the output.
- A `failed` command with no output, as after Stop, reads "Command did not finish."
- `read_file` and `search_web` updates carry no output in 1.5.13 (verified), so those rows show only their input.
- `refusal` reads as a quota warning. t3code reports that agy uses it when the quota is used up.
- t3code reports a duplicate `formatted_output` field. 1.5.13 sent none, so nothing handles it.

## Models and thinking level

**What agy reports (verified).** `session/new` and `session/resume` return `configOptions`. The model option is `{ id: "model", category: "model", type: "select", currentValue, options: [{ value, name }] }`, flat on 1.5.13, with 9 models on a Google AI Pro account (`gemini-4-neon`, `gemini-3.8-flash`, `claude-sonnet-5-5`, `gpt-oss-120b-medium` and others). The thinking option has `id` and `category` `thought_level` and is advertised only for the selected model: `low`, `medium`, `high` and on some models `xhigh` (agy labels it "Extra"). Models without thinking, such as `gpt-oss-120b-medium` and the orchestrators, have no `thought_level` option. `session/set_config_option` with `sessionId`, `configId` and `value` answers the updated `configOptions` in about 2 ms. An unknown model fails with -32602 `Unknown model ID: <id>`, and a level the model lacks with -32602 `Thinking level "<level>" is not offered for model "<name>"`. `session/resume` comes back on the account default model whatever the session used before. `agy models` prints ids with the level folded in (`gemini-4-neon-high`) and no way to tell levels apart from models, so Convoy does not use it.

**Inventory.** After the version check, detection spawns `agy acp` in a new temp directory, opens one session, reads the model option and selects each model once to read its `thought_level` choices. It then kills the process and deletes the temp directory and the session's files: `~/.gemini/antigravity-cli/conversations/<id>.db` with its `-wal` and `-shm`, and `brain/<id>/`. agy 1.5.13 has no `session/delete` (it answers method not found). The whole inventory took 1.4 seconds on 1.5.13. It runs once per CLI start, with the same env as a run, so `AGY_CLI_DISABLE_AUTO_UPDATE=1` holds.

- Each model is reported as `{ slug, name, variants? }`, the shape OpenCode sends: `slug` is the option `value`, `name` its label, `variants` the thinking levels in agy's order. Grouped choices (`{ group, options }`) are flattened.
- The list is capped at `MAX_ADVERTISED_MODELS` (150), as for OpenCode. The backend parser applies the stored-catalog ceiling and skips malformed models.
- Budget 20 seconds, fail soft. When agy is signed out, has no model option or runs past the budget, the runtime registers with `models` absent, so the stored catalog is left alone. See the three states in [cli-opencode-runtime.md](cli-opencode-runtime.md#models).
- Left behind: a row for the session in agy's `conversation_summaries.db`. `session/list` does not show it once the files are gone (verified). A session whose id never arrived before the 20-second timeout keeps its files.

**Storage and options.** The catalog goes to `cliRuntimeCatalogs` like OpenCode's (see [cli-thread-model-selection.md](cli-thread-model-selection.md)). Stored model values are `default` or an agy model id (a word character, then up to 199 of `\w . : / -`). A stored id that is no longer advertised still resolves to a labeled option and runs as-is. The thinking level is per model from the advertised variants, with `default` first, and the Default model slot shows no Reasoning section. `xhigh` is labeled "Extra high". The validation rules are OpenCode's: see [cli-thread-effort-selection.md](cli-thread-effort-selection.md#dynamic-catalogs-opencode-variants-antigravity-thinking-levels-cursor-tiers).

**Run.** After `session/new` or `session/resume`, and after the `convoy/acp_session` chunk, a resolved model other than `default` is set with `session/set_config_option` on the option of category `model`. Then, if a thinking level is resolved and the returned options offer it under `thought_level`, it is set too, unless it is already current. A level the model does not offer is skipped. `default` sends nothing, so agy uses the account default. A model or level agy refuses fails the run with agy's message, and the session id is kept for the next message. The model is set again on every run because resume resets it (verified: a resumed Claude Sonnet 5.5 session answered as Sonnet only after the set).

## Continuation

The ACP session id is the `continuationId`. A follow-up spawns a new process and calls `session/resume`, which does not replay history (verified). The resumed session remembered the earlier turn's file edit (verified).

## Known limitations

- No slash commands, context meter, image attachments, steering or local resume command.
- Isolation (`--isolated`) fails fast, as for Cursor and OpenCode.
- agy 1.5.13 offered no `allow_always` for `ls -la`, so Always allow appears only when agy offers it.
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
