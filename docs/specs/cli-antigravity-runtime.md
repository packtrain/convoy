# Antigravity runtime specification

This spec covers how the `antigravity` runtime runs Antigravity CLI (`agy`) in Convoy. The transport is the Agent Client Protocol (ACP), JSON-RPC 2.0 over newline-delimited stdio. Each run spawns its own `agy acp` process.

Status: slices 1 to 10, 12 and 13 of the epic OS-2464 (OS-2468 to OS-2477, OS-2479, OS-2481). A thread runs in Act or Ask to approve mode on the model and thinking level picked in the composer. It streams text, reasoning and tool calls, shows approval and question cards, follows up in the same agy session and stops on Stop. It offers agy's slash commands, fills the context meter, sends images as images and offers a local resume command. A message sent mid-run steers the run, and a run waits for the commands agy moves to the background. `convoy init` sets up agy's MCP server and skill, shared projects, managed environments and isolated projects detect, install and sign in agy, a project can bind a managed Gemini API key, and the devcontainer templates install agy. The public docs, the landing page and the READMEs name Antigravity. A run shows an estimated API-equivalent cost. Still open: the desktop app's onboarding (OS-2478).

Every fact below is marked **verified** when it comes from traffic recorded on agy 1.5.13 or 1.5.14 (signed in, Linux container, 2026-11-20 and later) or **t3code** when it only comes from t3code's source in `reference/t3code`.

## Scope

- Executor in `apps/cli/src/agent/runtimes/antigravity/`. It uses the protocol-only ACP client in `runtimes/acp/client.ts` and the shared JSON-RPC client in `runtimes/json-rpc.ts`.
- Backend normalization in `apps/web/convex/cli/lib/runtimes/antigravity/`, composed over the generic ACP mapping in `runtimes/acp/normalizeChunk.ts`.
- Selector, icon and modes in `apps/web/lib/cli-runtime-ui/antigravity.tsx`.

Code that names agy lives in the `antigravity` folders. The `acp` folders hold protocol code only, so a later ACP agent can reuse them.

## Detection

- Executable: `CONVOY_ANTIGRAVITY_EXECUTABLE`, then `agy`, then `antigravity` on `PATH`. The binary is `antigravity`, usually linked as `agy`.
- `agy --version` prints a bare `1.5.13` (verified). Versions below 1.5.12 are not advertised.
- The advertised row is `{ type: "antigravity", version, models? }`. `models` comes from the inventory session in [Models and thinking level](#models-and-thinking-level).
- The composer disables Antigravity on a machine that doesn't advertise it. Registration drops the Antigravity row from a CLI older than 0.154.0 (`minAppVersion`, see [cli-minimum-version.md](cli-minimum-version.md#per-runtime-minimum)). 0.151.0 runs every thread with `--dangerously-skip-permissions`, so it would run Ask to approve threads without asking. 0.152.x never sets the model or thinking level, so a remembered selection would run on agy's default while the thread shows the selection. 0.153.x wraps slash commands in the run envelope, so a command offered before discovery would reach agy as prose. Older CLIs don't know the runtime.
- Detection does not report sign-in. A signed-out agy fails the inventory, so it registers without `models`, and its first run fails with the sign-in message.

## Execution

One `agy acp` process per run, with `--dangerously-skip-permissions` in Act mode only (see [Modes](#modes)), spawned detached in the run's working directory. Convoy passes neither `--gemini-dir` nor `--app-data-dir`, so runs use the user's own profile and sign-in under `~/.gemini/antigravity-cli`.

Child environment: the CLI's env minus `CONVOY_API_KEY` and a managed Claude provider's variables, plus `CONVOY_THREAD_ID` and `AGY_CLI_DISABLE_AUTO_UPDATE=1`.

Per run:

1. `initialize` with `protocolVersion: 1` and `clientCapabilities` `{ fs: { readTextFile: false, writeTextFile: false }, terminal: false }`. agy answers protocol version 1, `agentInfo.version` and `agentCapabilities._meta.antigravity.systemPrompt.append: true` (verified). It answers in about 0.1 seconds (verified).
2. `session/new` with `cwd` and `mcpServers: []`, or `session/resume` with the stored session id when the run has a `continuationId`. Both carry `_meta.antigravity.systemPrompt.append` with the bound Project agent prompt, the thread identity line and the workspace notice. agy accepts the append on resume (verified). When `initialize` lacks the capability, the runner prepends the same text to the prompt. `session/new` returns the session id, model list, modes and config options in about one second (verified).
3. When the thread has a model, `session/set_config_option` for it, then for the thinking level. See [Models and thinking level](#models-and-thinking-level).
4. `session/prompt` with the image blocks from [Attachments](#attachments), then one text block. The response carries `stopReason` and `usage` (verified).

Signed out, `session/new` fails at once with `-32000 Authentication required` (verified). The runner then calls `authenticate` with `oauth-personal` once and retries. In a headless container that call fails at once with -32603 "No browser is available here" (verified). Whatever fails, the run ends with "Antigravity is not signed in on this machine. Run `agy` in a terminal and sign in, then send the message again." On a desktop the call may open a browser, which nobody has checked yet. The same fallback applies to a signed-out `session/resume`.

**Managed Gemini key (OS-2476).** With a key bound to the project, the runner calls `authenticate` with `gemini-api-key` right after `initialize` and before `session/new` or `session/resume`, and skips the `oauth-personal` fallback. A failed `authenticate`, or a `-32000` after it, ends the run with "Antigravity refused the assigned Gemini API key". A disabled binding fails the run before agy starts. Delivery and what the live check found: [cli-provider-keys.md](cli-provider-keys.md#managed-gemini-keys-for-antigravity-os-2476).

**Cancel.** Stop sends the `session/cancel` notification and waits for the prompt response. agy marks the running tool `failed` with empty output and answers `stopReason: "cancelled"` within a few milliseconds (verified). With no prompt open, during the wait in [Run lifecycle](#run-lifecycle), agy marks each backgrounded command `failed` and kills it (verified on 1.5.14), and the run ends once none is left. The runner SIGKILLs the process group 5 seconds after Stop if agy is still alive, as Codex does, and kills it after every run. A stopped run ends at once but leaves agy those 5 seconds. agy starts each command in its own session, so the group kill does not reach it, and agy reports a cancelled command `failed` before it has killed it (verified: a `sleep` outlived an immediate kill). Only agy itself reaps it.

**Idle watchdog.** No ACP traffic for 600 seconds stops the run the same way, `session/cancel` then the kill, and fails it with "Antigravity produced no output for 10 minutes and was terminated." The message names the commands still running, if any.

## Run lifecycle

**Steering.** `steer()` sends another `session/prompt` on the run's session. agy answers the open prompt with `end_turn` at once and carries on under the new one (verified on 1.5.14). `steer()` returns false when no prompt is open, and the message waits for the next run. See [cli-steering.md](cli-steering.md#antigravity-runner).

**Commands that outlive the prompt.** A `run_command` with `WaitMsBeforeAsync` lets agy answer the prompt with `end_turn` while the command is still `in_progress`. When the command finishes, agy sends `tool_call_update` with `completed`, then message chunks, then `usage_update`, with no prompt open (verified on 1.5.14). The runner tracks every `execute` tool call that is not `completed` or `failed`, except daemons (`rawInput.IsDaemon === true`), which may never finish. A call seen once as a daemon stays excluded, since later partial updates may omit `rawInput`. A run waiting on a dev server would sit until the idle watchdog.

```
on prompt response:  openPrompts -= 1; when 0, send one convoy/acp_prompt_result, then finish if no tracked command
on tool update completed/failed:  untrack it
on usage_update:  if no other update or permission request follows within 500 ms, finish if openPrompts == 0,
                  no tracked command and no open permission request
on Stop:  session/cancel; finish when the prompts have answered and agy has failed every tracked command
on idle timeout:  as Stop, and report the commands still running
```

agy sends a `usage_update` before every `tool_call` of a reply, in the same millisecond (verified), so the 500 ms lets a late reply that starts another command track it before the run ends. Updates in the wait are forwarded as usual. A permission request in the wait goes to the bridge, see [Permissions and questions](#permissions-and-questions).

**Permission requests.** See [Permissions and questions](#permissions-and-questions).

Other agent requests, such as `fs/*` or `terminal/*`, get a method-not-found error. The client advertises neither.

## Chunk contract

| Chunk type | Data |
|---|---|
| `convoy/acp_session` | `{ sessionId, agentVersion }`, sent after new or resume. The continuation id comes from here |
| `session/update` | the notification params as agy sent them, with tool updates compacted (below) |
| `convoy/acp_text`, `convoy/acp_reasoning` | `{ sessionId, text }`, the accumulated text of one segment. Sent when an update of another kind arrives or the prompt ends |
| `convoy/acp_prompt_result` | `{ sessionId, stopReason, usage, model }`, once per run when the last open prompt answers. `usage` sums the numeric fields of every prompt response in the run. `model` is the effective model, see [Usage](#usage) |
| `convoy/antigravity_compaction` | `{ sessionId, phase }` on a `/compact` run: `started` before the prompt, then `completed` on `end_turn` or `failed` otherwise. See [Slash commands](#slash-commands) |

- ACP sends text only as `agent_message_chunk` and `agent_thought_chunk` deltas, never as a whole message (verified). These are forwarded as `session/update` chunks only when partial streaming is on. The backend marks them ephemeral, and the flush buffer merges consecutive chunks of one kind.
- `available_commands_update` and `usage_update` are forwarded as they arrive and do not close a text segment.
- Not forwarded: `session_info_update`, `current_mode_update` and `config_option_update`. They do not close a text segment either.
- Tool updates are compacted before sending. agy repeats `rawInput` as `args` and a command's `rawOutput.output` as a text content block (verified), so the runner drops both copies. Every remaining string keeps its last 8,000 characters, as t3code does, behind an `[N characters omitted]` line so a clipped file or command never reads as whole.

## Modes

| Thread mode | agy |
|---|---|
| `agent`, labeled "Act" | `--dangerously-skip-permissions`, session mode left at agy's `default` |
| `default`, labeled "Ask to approve" | no flag, session mode left at agy's `default` |

agy 1.5.13 advertises the session modes `default`, `accept-edits`, `auto` and `plan` (verified). Convoy sets none. t3code reports that agy rejects `yolo` and `auto_edit`, so Act stays the spawn flag. Any thread mode other than `default` runs as Act.

## Permissions and questions

Ask to approve needs CLI 0.152.0, and the runtime as a whole needs 0.154.0. Older CLIs are not offered Antigravity at all (see [Detection](#detection)).

**What agy asks.** In `default` mode agy 1.5.13 asked before `ls -la` and not before writing `notes.txt` inside the workspace (verified). The request is the tool call itself: `toolCall` carries the whole `tool_call` update (`toolCallId`, `name`, `kind`, `status: "pending"`, `title`, `rawInput`), and a `tool_call_update` with `status: "pending"` comes just before it (verified). For `ls -la` the options were `{ optionId: "allow", name: "Allow", kind: "allow_once" }` and `{ optionId: "deny", name: "Deny", kind: "reject_once" }`, with no `allow_always` (verified). A declined command ends `failed` with empty output, and agy carries on with the turn (verified).

**Validation.** The ACP client answers `cancelled` to a request with no `toolCallId`, or with an empty or repeated option id, and never shows it.

**Tool approval.** Every request whose `toolCallId` does not start with `interaction_` becomes a `tool-approval` bridge request:

| Payload field | Value |
|---|---|
| `toolName` | the agy tool name, e.g. `run_command`, or `mcp__<server>__<tool>` for `call_mcp_tool` |
| `title` | "Antigravity wants to use <tool> from <server>" for `call_mcp_tool`, which agy marks `execute` (verified), "Antigravity wants to run a command" (`kind: "execute"`), "Antigravity wants to edit a file" (`kind: "edit"`), else "Antigravity wants to use <name>" |
| `inputJson` | `rawInput`, plus `command` from `CommandLine` and `file_path` from `Path` for the card preview; for `call_mcp_tool` only `rawInput.Arguments` |
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

- Requests reach the bridge from the first `session/prompt` until the run ends, including in the wait for a backgrounded command. One that arrives before the first prompt is answered `cancelled`.
- When the last open prompt answers with requests still open, agy has withdrawn them. The runner cancels each with `abandoned: false` and answers `cancelled`. A prompt answered because a steered one replaced it withdraws nothing.
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
| `session/update` × `usage_update` with positive `used` and `size` | `context-window` (`usedTokens` = `used`, `maxTokens` = `size`) |
| `session/update` × `plan`, `user_message_chunk`, other `usage_update`, `session_info_update`, `available_commands_update`, `current_mode_update`, `config_option_update` | silent `metadata` |
| `convoy/acp_prompt_result` × `refusal`, `max_tokens`, `max_turn_requests` | `warning` (`acp-<stopReason>`) |
| `convoy/acp_prompt_result` × other stop reason | silent `metadata` |
| `convoy/acp_session` | silent `metadata` with `sessionId` |
| anything else | `unknown` |

The Antigravity part maps `convoy/antigravity_compaction` to a `context-compaction` row: `started` is the in-progress "Compacting…" row, `completed` replaces it with "Conversation compacted", and any other phase with "Compaction did not finish."

`toolCallId` pairs input with output. Without an adapter a tool is named by its `title`, its input is `rawInput` and its output is `rawOutput` or the content text.

The Antigravity part (`normalizeAntigravityChunk`) maps agy's tool `name` onto the names the renderers in `apps/web/lib/ai-tools/` know:

| agy tool | Renders as | Input |
|---|---|---|
| `run_command` (verified) | `Bash` terminal row | `command` from `rawInput.CommandLine` (verified), or the aliases `commandLine`, `command_line`, `command` (t3code), or a "Running X" / "Run `X`?" title (t3code); `description` from `toolSummary` |
| `write_file` (verified) | `Write` | `file_path` from `Path`, `content` from `Content` |
| `edit_file` (verified) | `Edit` | `file_path` from `Path`, `old_string` from `Target`, `new_string` from `Replacement`, falling back to the diff block's `oldText` and `newText` |
| `read_file` (verified), `view_file`, `client_view_file` (t3code) | `Read` | `file_path` from `Path` |
| `search_web` (verified) | `WebSearch`, generic tool row | `rawInput` as is (`query`, optional `domain`) |
| `call_mcp_tool` (verified) | `mcp__<server>__<tool>` MCP row, from `ServerName` and `ToolName` | `rawInput.Arguments`; output is `rawOutput`, the server's JSON text |
| `ask_question` (verified) | `AskUserQuestion` inline questionnaire | `questions[]` with `question`, `multiSelect` from `is_multi_select`, `options` as `{ label }` |
| anything else | its agy name, generic tool row | `rawInput` |

- A command's output text is everything after agy's `Command output:` line, with CRLF turned into LF. agy puts creation and completion timestamps and the exit code above it (verified).
- A nonzero `rawOutput.exit_code` inside a `completed` update is a failed command (verified with `exit 3`). The error text names the exit code and carries the output.
- A `failed` command with no output, as after Stop, reads "Command did not finish."
- `read_file` and `search_web` updates carry no output in 1.5.13 (verified), so those rows show only their input.
- `refusal` reads as a quota warning. t3code reports that agy uses it when the quota is used up.
- t3code reports a duplicate `formatted_output` field. 1.5.13 sent none, so nothing handles it.

## MCP

`convoy init --cli antigravity` sets agy up, like every other runtime. The runner sends `mcpServers: []` in `session/new`, and agy loads its servers from its own config. Spec: [cli-init-command.md](cli-init-command.md#antigravity).

- agy 1.5.14 reads MCP servers only from `~/.gemini/config/mcp_config.json` and from enabled plugins. A `mcp_config.json` in the workspace, in `.agents/` or in `.gemini/config/` is ignored (verified with `agy mcp list`).
- `agy mcp add --header "Authorization: Bearer <key>" convoy <url>` writes `{ "mcpServers": { "convoy": { "disabled": false, "headers": { "Authorization": "Bearer <key>" }, "serverUrl": "<url>" } } }` (verified in a scratch home).
- agy loads skills from `<workspace>/.agents/skills/<name>/` and `~/.gemini/config/skills/<name>/`. A copy of the Convoy skill in either one appeared as `convoy` in `available_commands_update`, and was absent without it (verified).
- A call is a `tool_call` named `call_mcp_tool`, `kind: "execute"`, titled "MCP Tool <tool>", with `rawInput` `{ ServerName, ToolName, Arguments }`. The completed update carries the server's text as `rawOutput` (verified). Before calling, agy may `read_file` the tool's schema under `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json`, which renders as an ordinary Read row.
- In `default` mode agy asks before every MCP call, with `allow_once` and `reject_once` only (verified).

## Models and thinking level

**What agy reports (verified).** `session/new` and `session/resume` return `configOptions`. The model option is `{ id: "model", category: "model", type: "select", currentValue, options: [{ value, name }] }`, flat on 1.5.13, with 9 models on a Google AI Pro account (`gemini-4-neon`, `gemini-3.8-flash`, `claude-sonnet-5-5`, `gpt-oss-120b-medium` and others). The thinking option has `id` and `category` `thought_level` and is advertised only for the selected model: `low`, `medium`, `high` and on some models `xhigh` (agy labels it "Extra"). Models without thinking, such as `gpt-oss-120b-medium` and the orchestrators, have no `thought_level` option. `session/set_config_option` with `sessionId`, `configId` and `value` answers the updated `configOptions` in about 2 ms. An unknown model fails with -32602 `Unknown model ID: <id>`, and a level the model lacks with -32602 `Thinking level "<level>" is not offered for model "<name>"`. `session/resume` comes back on the account default model whatever the session used before. `agy models` prints ids with the level folded in (`gemini-4-neon-high`) and no way to tell levels apart from models, so Convoy does not use it.

**Inventory.** After the version check, detection spawns `agy acp` in a new temp directory, opens one session, reads the model option and selects each model once to read its `thought_level` choices. It then kills the process and deletes the temp directory and the session's files: `~/.gemini/antigravity-cli/conversations/<id>.db` with its `-wal` and `-shm`, and `brain/<id>/`. agy 1.5.13 has no `session/delete` (it answers method not found). The whole inventory took 1.4 seconds on 1.5.13. It runs once per CLI start, with the same env as a run, so `AGY_CLI_DISABLE_AUTO_UPDATE=1` holds. With a managed Gemini key it sets the key and calls `authenticate` with `gemini-api-key` before `session/new`, so the catalog lists what the key offers. A disabled binding skips the inventory. Native, when agy's `cache/acp-auth-state.json` still names `gemini-api-key` from an earlier key, it calls `authenticate` with `oauth-personal` first, so the stored Google token restores the account's catalog (verified on 1.5.14).

- Each model is reported as `{ slug, name, variants? }`, the shape OpenCode sends: `slug` is the option `value`, `name` its label, `variants` the thinking levels in agy's order. Grouped choices (`{ group, options }`) are flattened.
- The list is capped at `MAX_ADVERTISED_MODELS` (150), as for OpenCode. The backend parser applies the stored-catalog ceiling and skips malformed models.
- Budget 20 seconds, fail soft. When agy is signed out, has no model option or runs past the budget, the runtime registers with `models` absent, so the stored catalog is left alone. See the three states in [cli-opencode-runtime.md](cli-opencode-runtime.md#models).
- Left behind: a row for the session in agy's `conversation_summaries.db`. `session/list` does not show it once the files are gone (verified). A session whose id never arrived before the 20-second timeout keeps its files.

**Storage and options.** The catalog goes to `cliRuntimeCatalogs` like OpenCode's (see [cli-thread-model-selection.md](cli-thread-model-selection.md)). Stored model values are `default` or an agy model id (a word character, then up to 199 of `\w . : / -`). A stored id that is no longer advertised still resolves to a labeled option and runs as-is. The thinking level is per model from the advertised variants, with `default` first, and the Default model slot shows no Reasoning section. `xhigh` is labeled "Extra high". The validation rules are OpenCode's: see [cli-thread-effort-selection.md](cli-thread-effort-selection.md#dynamic-catalogs-opencode-variants-antigravity-thinking-levels-cursor-tiers).

**Run.** After `session/new` or `session/resume`, and after the `convoy/acp_session` chunk, a resolved model other than `default` is set with `session/set_config_option` on the option of category `model`. Then, if a thinking level is resolved and the returned options offer it under `thought_level`, it is set too, unless it is already current. A level the model does not offer is skipped. `default` sends nothing, so agy uses the account default. A model or level agy refuses fails the run with agy's message, and the session id is kept for the next message. The model is set again on every run because resume resets it (verified: a resumed Claude Sonnet 5.5 session answered as Sonnet only after the set).

## Continuation

The ACP session id is the `continuationId`. A follow-up spawns a new process and calls `session/resume`, which does not replay history (verified). The resumed session remembered the earlier turn's file edit (verified).

## Slash commands

**What agy sends (verified).** Right after `session/new` and after `session/resume`, agy sends `available_commands_update` with `availableCommands` of `{ name, description }`. t3code adds an optional `input.hint`. agy 1.5.13 listed `goal`, `compact`, `schedule`, `browser`, `plan`, `grill-me`, `teamwork`, `learn`, `boost`, `agy-customizations`, `antigravity-guide`, `run-workflow` and `swarm`. Its skills appear in the same list. A command runs when sent as the whole prompt text.

**Discovery.** The runner forwards the update as a `session/update` chunk. At chunk append the backend reads the last such update in the batch into the `cliRuntimeFacts` row, with `input.hint` as the argument hint (`antigravity/slashCommands.ts`). No synthetic `convoy.commands` chunk is needed. `logout` is never offered. t3code lists it, and running it from a thread would sign agy out on that machine.

**Before discovery.** With no stored list, as in a new thread's composer or on a machine agy has not reported from, the composer offers agy 1.5.x's built-ins with agy's own descriptions: `goal`, `plan`, `schedule`, `browser`, `grill-me`, `teamwork`, `learn` and `boost` (`getComposerRuntimeCommands`). `compact` and the skills wait for discovery: a new thread has nothing to compact, and skills differ per machine. Once agy reports, its list replaces this one. A thread may open on a command (`supportsFirstMessageRuntimeCommand`), because the agent prompt and thread identity ride in `session/new` `_meta`, not in the first message.

**Execution.** A solo runtime command message is sent raw, as the whole prompt text, with no run envelope (`rawRuntimeCommand`). The runner then never prepends the instructions to it, even when agy cannot append a system prompt.

**`/compact` (verified).** agy compacts and ends the turn with `end_turn`, no text and no event that marks the compaction. Its `usage_update` for that turn counts the old context plus the summary, so it went up from 13,512 to 15,368 tokens on a test conversation. The next reply's update showed the drop, to 9,526. So on a `/compact` run the runner does not forward `usage_update`. It sends `convoy/antigravity_compaction` with `started` before the prompt, which shows "Compacting…" while agy works, and `completed` after `end_turn`. A run that ends any other way, including when agy dies, sends `failed`, so the pending row never hangs. The meter keeps its old value until the next reply.

## Context meter

agy sends `usage_update` with `used` (tokens in context) and `size` (window size) right after a session opens and at the end of every reply (verified: `used: 0` first, then `used: 8950, size: 1048576` on Gemini). Positive values normalize to `context-window`, anything else to silent metadata. The shared fold stores the last snapshot on the thread (see [cli-thread-context-window-meter.md](cli-thread-context-window-meter.md#antigravity-rules)).

## Usage

The `session/prompt` response carries `usage` with `inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`, `thoughtTokens` and `totalTokens`. On agy 1.5.14, `totalTokens` equaled `inputTokens + outputTokens + cachedReadTokens` on every response recorded on Gemini 3.8 Flash, Claude Sonnet 5.5 and an orchestrator (verified, 2026-11-21). So `inputTokens` excludes cache reads and `outputTokens` already includes `thoughtTokens` (22 of 23 output tokens on a one-word reply). `cachedWriteTokens` was 0 on every response, Claude Sonnet included, and Convoy prices it as reported.

**Effective model.** The runner reads the model option's `currentValue` after it applies the thread's model, or from the `session/new` or `session/resume` options when the thread is on Default, and puts it in `convoy/acp_prompt_result` as `model` (CLI 0.161.0). `convoy/acp_session` cannot carry it, because the runner sends that chunk before it sets the model.

**Cost.** The backend extractor (`convex/cli/lib/runtimes/antigravity/costUsage.ts`) records the prompt result's summed `usage` under that model with no reported cost, and the cost recorder estimates it from the pricing catalog. See [cost-tracking.md](cost-tracking.md#recording-pipeline). Gemini ids resolve to LiteLLM's direct Gemini API rows, and agy's Claude ids are catalog rows already. The amount is a standard API-equivalent estimate, not the Google subscription charge. The thinking level changes the token count, not the rate. A run is unpriced, with its tokens kept, when:

- the model is an orchestrator (`gemini-pro-orchestrator-*`), whose `usage` is one total for several models,
- the model has no catalog row, such as `gpt-oss-120b-medium`,
- the chunk has no `model`, which is the case for a CLI older than 0.161.0. `minAppVersion` does not move for this.

**Gap.** A reply agy sends after a backgrounded command has no prompt response. Its only usage signal is `usage_update`, which reports context size and no token counts (verified on 1.5.14: the reply after `sleep 12; echo finished` sent `tool_call_update`, message chunks and `usage_update` with `used` 9877, nothing else). Its tokens are not counted.

## Attachments

agy advertises `promptCapabilities.image` (verified). `image/bmp`, `image/jpeg`, `image/png` and `image/webp` attachments are sent as `{ type: "image", data: <base64>, mimeType }` blocks ahead of the prompt text, each after a text block naming its message and file: `user-message-1 attachment: "red.png" (image/png)`. A PNG sent this way was described correctly (verified). An image stays out of the prompt's path list once inlined.

An image over 10 MiB, or one that would take the run's images over 50 MiB in total, stays a path reference. These are t3code's limits. Every other attachment is a path reference in the prompt text, which agy reads with its own tools.

## Local resume

The assistant message menu offers `agy --conversation <ACP session id>`. agy stores ACP sessions under the same `antigravity-cli` directory as the interactive CLI, so the session id is a conversation id: `agy --conversation <id> -p` answered from an ACP session's history (verified on 1.5.13).

## Project environments

Antigravity joins the login runtimes of shared projects and managed Docker environments (CLI 0.158.0, OS-2474), and of isolated projects (CLI 0.159.0, OS-2475, [below](#isolated-projects)).

- `loginRuntimeSchema` is `keyRuntimeSchema` again, so `project login --runtime antigravity` and `keys use --runtime antigravity` both parse (OS-2476).
- The check and the sign-in resolve agy as the worker does: `CONVOY_ANTIGRAVITY_EXECUTABLE`, then `agy`, then `antigravity` on `PATH`. So a check never passes an agy the worker would not run, and never fails one it would.
- Sign-in is `agy acp --login`, agy's only sign-in outside its TUI, spawned directly with the resolved executable. It prints a Google URL, reads the pasted code and exits. Cancelled, it prints `login cancelled` and exits 1 (verified on 1.5.14). Specs: [cli-shared-environments.md](cli-shared-environments.md#runtimes-and-logins).
- agy has no status command, so its login is always `unknown`. `project check` runs `agy --version` only. A version below `MIN_ANTIGRAVITY_VERSION`, a nonzero exit, a timeout or output without a version marks agy unusable, with the fix `agy update` or the install script, since the worker would not advertise it.
- The user install is the official script, `curl -fsSL https://antigravity.google/cli/install.sh | bash`. It installs `~/.local/bin/antigravity` with an `agy` link.
- A managed Docker environment's Agent runtimes panel offers the pinned build `ANTIGRAVITY_BUILD` (1.5.14) and installs only that. The root install downloads the versioned tarball, checks the manifest's sha512 for the machine and extracts the binary into `/usr/local/bin`. Spec: [cli-tui.md](cli-tui.md#agent-runtimes-cli-01240-os-2236).
- agy's state follows `HOME`, never `GEMINI_HOME`, so the service passes no extra variable. Spec: [cli-shared-environments.md](cli-shared-environments.md#execution).
- The TUI's project Actions offer [y] Log in to Antigravity, the same handoff as the Codex and Claude Code logins. Spec: [cli-tui.md](cli-tui.md#runtime-login-cli-01100). There is no Runtime access entry, as for Cursor and OpenCode, because agy reports no account.

### Isolated projects

`launcher.py` lists `antigravity` among the runtimes tested inside the boundary: binary `agy`, login `agy acp --login`, config folder `~/.gemini/antigravity-cli`, login file `antigravity-oauth-token` in it. The folder is the file's direct parent, because `runtime_files` skips a link only on the last path part. The image and a VM install agy 1.5.14 root-owned, the build a managed install pins. Spec: [cli-project-isolation.md](cli-project-isolation.md#runtime-detection-and-login-cli-01100-os-2166-os-2160).

Where the sign-in lives. agy 1.5.14 logs `Using file-based token storage because no D-Bus session bus detected` and writes `~/.gemini/antigravity-cli/antigravity-oauth-token`, mode 0600. The sandbox's `--clearenv` leaves no D-Bus address and the boundary has no session bus, so the file is what agy uses. `SSH_CONNECTION` is not needed. agy refreshes the token in place, so the project HOME must stay writable, which it is. The sign-in is a file in the private HOME, so it survives a service restart, and another project cannot read it.

The sandbox sets `AGY_CLI_DISABLE_AUTO_UPDATE=1` for every command, the login included, which runs outside the runner. The root-owned binary cannot be replaced by the project UID anyway.

How it was verified (2026-11-21, dev container, arm64, no bubblewrap there): agy ran under exactly the sandbox environment (`env -i` with the launcher's variables, a fresh HOME holding only the token file, an empty `TMPDIR`, a read-only binary). `session/new` listed the account's models, a prompt completed, the binary's SHA-256 was unchanged and `TMPDIR` stayed empty. `agy acp --login` in a fresh HOME printed the Google link, chose file storage and asked for the code. Pending, and required before CLI 0.159.0 is published: the VM acceptance in OS-2475, inside bubblewrap. It covers a completed login, a thread and the model inventory, a follow-up after a service restart, background-process cleanup, the untrusted-binary refusal, cross-project HOME denial, the older-launcher upgrade path and the x86-64 build.

Inside the boundary a daemon agy moved to the background stays in the worker's PID namespace and ends with it (`--unshare-pid`, `--die-with-parent`). The model inventory runs as on a shared machine, in a new folder under the sandbox's tmpfs `/tmp`. A managed Gemini key reaches agy through the launch frame's `antigravityAuth`, which needs the launcher capability `credentials-antigravity-v1` (OS-2476).

The image's strict firewall (`init-firewall.sh`, shared with `templates/devcontainer`) allows agy's Google hosts, `generativelanguage.googleapis.com` for a managed Gemini key included ([below](#devcontainer)). A VM has no such firewall.

## Devcontainer

OS-2477. Spec: [devcontainer-template.md](devcontainer-template.md#template-requirements-generic--convoy-opt-in).

- `postCreateCommand` runs the official install script, unpinned, after the other agent installs, in `templates/devcontainer`, the repo's `.devcontainer` and the local `sandbox/`. `~/.local/bin` is already on the image `PATH`.
- The sign-in lives in a named volume at `/home/node/.gemini`, the Claude Code pattern. The user runs `agy acp --login` once inside the container. There is no host mount, because the host's sign-in sits in the macOS keychain.
- The volume also holds `~/.gemini/config/mcp_config.json`, so `convoy init --cli antigravity` runs inside the container.
- The strict firewall allows `antigravity.google`, the auto-updater manifest host, `storage.googleapis.com`, `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.googleapis.com` and `generativelanguage.googleapis.com`. The list comes from t3code and happier source. agy's logs in the repo's dev container (open mode) show only `daily-cloudcode-pa.googleapis.com` and `jetski-webchannel.googleapis.com`, its RemoteControl proxy, which Convoy does not use and the firewall does not allow. A strict-mode drop-log check is pending.

## Known limitations

- Before the first run on a machine, the composer offers agy's built-ins only. Skills appear after it.
- `/compact` leaves the meter at its old value until the next reply.
- Isolation (`--isolated`) fails fast, as for Cursor and OpenCode.
- agy 1.5.13 offered no `allow_always` for `ls -la`, so Always allow appears only when agy offers it.
- A daemon command agy moves to the background survives the run. The run ends without it and kills agy's process group, which does not reach the command (verified). Work agy starts after the run has closed is lost with the process.
- A late reply that pauses more than 500 ms between a step's `usage_update` and its next `tool_call` is cut there. agy sent the two together in every recorded step.
- A message sent while the run waits for a backgrounded command does not steer. It waits for the next run, which starts after the wait.
- Upstream API errors that agy reports as a normal reply are not detected. t3code reads agy's session database for this.
- Cost estimates miss the tokens of a reply after a backgrounded command, and orchestrator runs stay unpriced. See [Usage](#usage).

## Related specs

- Runtime subsystem layout: [cli-runtime-architecture.md](cli-runtime-architecture.md)
- Codex app-server runner, the executor template: [cli-codex-runtime.md](cli-codex-runtime.md)
- Thread modes: [cli-thread-modes.md](cli-thread-modes.md)
- Agent prompt delivery: [cli-thread-agents.md](cli-thread-agents.md)
- Sandboxing: [cli-sandboxing.md](cli-sandboxing.md)
- Chunk storage and ephemeral rules: [cli-message-chunks-storage.md](cli-message-chunks-storage.md)
