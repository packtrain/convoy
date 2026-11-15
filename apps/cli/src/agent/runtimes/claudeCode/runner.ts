import { boundBackgroundTasks } from "../validators.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { createInterface } from "node:readline";
import * as os from "node:os";
import * as path from "node:path";
import {
  query,
  type CanUseTool,
  type HookCallback,
  type HookCallbackMatcher,
  type Options as ClaudeAgentOptions,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import { resolveExecutable } from "../../sdk/adapters/executable-resolution.js";
import {
  CLAUDE_PROVIDER_ENV_VAR,
  buildProviderSettingsJson,
  claudeAuthEnv,
} from "../../../lib/config/provider-keys.js";
import type { ClaudeAuth } from "../../../lib/config/credentials/validators.js";
import { extractClaudeCodeContinuationId } from "./continuation.js";
import { createClaudeCanUseTool, createClaudeOnElicitation, toClaudePermissionMode } from "./interactions.js";
import { PLAN_MODE_SYSTEM_PROMPT } from "./prompts.js";
import { isSilentThinkingFrame } from "./streaming.js";
import type {
  CliMode,
  CliRuntimeRunner,
  ContentChunk,
  PreparedRuntimeExecution,
  RunnerExecutionOptions,
  RunnerExecutionResult,
  RunnerSandboxOptions,
} from "../contracts.js";
import { RunnerExecutionError } from "../contracts.js";
import { getDebugLevel } from "../debug.js";
import { threadIdentityInstruction } from "../agent-instructions.js";
import { ENV_THREAD_ID } from "../../../lib/constants.js";
import { readClaudeUsage } from "./usage/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay between sending each JSON line (ms) */
const STREAM_DELAY_MS = 1500;

/** No SDK message observed before this deadline fails the run. */
const STARTUP_TIMEOUT_MS = 120_000;

/** No SDK message observed for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;

/**
 * Ceiling on holding a finished turn open for live background agents. A held turn occupies
 * one of the worker slots, so this trades a thread's slot against losing the agent's work.
 * Spec: docs/specs/cli-sdk-integration.md (OS-1661).
 *
 * ponytail: one wall-clock ceiling for all live agents; per-agent deadlines if one
 * slow agent starts holding up threads.
 */
const BACKGROUND_AGENT_WAIT_MS = readPositiveIntEnv(
  "CONVOY_BACKGROUND_AGENT_WAIT_MS",
  3_600_000
);

const BACKGROUND_SHELL_WAIT_MS = readPositiveIntEnv("CONVOY_BACKGROUND_SHELL_WAIT_MS", 1_800_000);

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Remote jobs outlive this process; local jobs hold under the limits in the SDK spec. */
const NON_BLOCKING_BACKGROUND_TASK_TYPES = new Set(["remote_agent"]);

/** Synthetic chunk reporting that the background-agent wait hit its ceiling. */
const BACKGROUND_WAIT_TIMEOUT_CHUNK_TYPE = "convoy.background_wait_timeout";

/**
 * Candidate in-process background tasks from a `background_tasks_changed` snapshot.
 *
 * `null` means "no usable snapshot" — the caller keeps its prior state. An empty set is a
 * real "nothing live". The two must stay distinct: treating a malformed payload as empty
 * would silently clear the gate and restore the original bug.
 *
 * Ids are kept unfiltered here and intersected with the spawned set at read time, because
 * the snapshot can arrive *before* the `task_started` that announces the same id (observed
 * live) — filtering on arrival would drop the agent and end the turn.
 */
function readLiveBackgroundTaskIds(message: SDKMessage): Set<string> | null {
  const record = message as unknown as Record<string, unknown>;
  if (record.type !== "system" || record.subtype !== "background_tasks_changed") {
    return null;
  }

  if (!Array.isArray(record.tasks)) {
    debugLog("background_tasks_malformed", JSON.stringify(record));
    return null;
  }

  const live = new Set<string>();
  for (const task of record.tasks) {
    if (!isRecord(task)) continue;
    const taskId = task.task_id;
    const taskType = task.task_type;
    if (typeof taskId !== "string") continue;
    if (typeof taskType === "string" && NON_BLOCKING_BACKGROUND_TASK_TYPES.has(taskType)) {
      continue;
    }
    live.add(taskId);
  }
  return live;
}

/** What the CLI stamps on an assistant message it synthesized itself. */
const SYNTHETIC_ASSISTANT_MODEL = "<synthetic>";

/**
 * Text of a **synthetic** assistant message — how the CLI surfaces an API error
 * (`model: "<synthetic>"`, zeroed usage). Such a run ends `subtype=success` with
 * `is_error` and no `errors[]`, so this is the only readable cause (OS-1807).
 */
function readSyntheticAssistantText(message: SDKMessage): string | undefined {
  if (message.type !== "assistant") {
    return undefined;
  }

  const record = message as unknown as Record<string, unknown>;
  const inner = isRecord(record.message) ? record.message : undefined;
  if (inner?.model !== SYNTHETIC_ASSISTANT_MODEL || !Array.isArray(inner.content)) {
    return undefined;
  }

  const text = inner.content
    .filter((block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

/**
 * Background task ids this turn spawned via a tool call, from the typed `task_started`
 * edge event. Only tool-spawned tasks carry a `tool_use_id`.
 */
function readSpawnedBackgroundTaskId(message: SDKMessage): string | null {
  const record = message as unknown as Record<string, unknown>;
  if (record.type !== "system" || record.subtype !== "task_started") {
    return null;
  }
  const taskId = record.task_id;
  const taskType = record.task_type;
  if (typeof taskId !== "string" || typeof record.tool_use_id !== "string") {
    return null;
  }
  if (typeof taskType === "string" && NON_BLOCKING_BACKGROUND_TASK_TYPES.has(taskType)) {
    return null;
  }
  return taskId;
}

/** Notice emitted when background agents outlive the wait ceiling. */
function backgroundWaitTimeoutChunk(count: number, shell = false): ContentChunk {
  return {
    type: BACKGROUND_WAIT_TIMEOUT_CHUNK_TYPE,
    data: JSON.stringify({
      type: BACKGROUND_WAIT_TIMEOUT_CHUNK_TYPE,
      waitedMs: shell ? BACKGROUND_SHELL_WAIT_MS : BACKGROUND_AGENT_WAIT_MS,
      ...(shell ? { taskKind: "shell" } : {}),
      taskCount: count,
    }),
  };
}

/** Env var override for the Claude Code executable path. */
const CLAUDE_EXECUTABLE_ENV = "CONVOY_CLAUDE_EXECUTABLE";

/** Synthetic chunk carrying the current context-window snapshot. */
const CONTEXT_USAGE_CHUNK_TYPE = "convoy.context_usage";

/**
 * Parse the `type` field from a JSON line, with fallback regex for
 * lines that may contain binary data (e.g., thinking signatures).
 */
function parseChunkType(line: string): string {
  try {
    const parsed = JSON.parse(line) as { type: string };
    return parsed.type;
  } catch {
    const typeMatch = line.match(/"type"\s*:\s*"([^"]+)"/);
    return typeMatch?.[1] ?? "unknown";
  }
}

function normalizeLogLine(value: string, maxLength = 240): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (maxLength <= 0 || oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLength)}...`;
}

function getDebugMaxChars(): number {
  // Level 2 means "no truncation" regardless of CONVOY_CLI_DEBUG_MAX_CHARS.
  if (getDebugLevel() >= 2) {
    return 0;
  }

  const raw = process.env.CONVOY_CLI_DEBUG_MAX_CHARS;
  if (!raw) {
    return 400;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 400;
  }

  // 0 (or negative) means "no truncation".
  if (parsed <= 0) {
    return 0;
  }

  return parsed;
}

function appendStderrTail(
  stderrTail: string[],
  line: string,
  maxLines = 12
): void {
  const normalized = normalizeLogLine(line);
  if (!normalized) {
    return;
  }
  stderrTail.push(normalized);
  if (stderrTail.length > maxLines) {
    stderrTail.shift();
  }
}

function debugLog(kind: string, payload: string): void {
  if (getDebugLevel() < 1) {
    return;
  }

  console.log(`[SDK:${kind}] ${normalizeLogLine(payload, getDebugMaxChars())}`);
}

function debugQueryStart(details: {
  executable: string;
  executableSource: string;
  cwd: string;
  permissionMode: string;
  model?: string;
  resumeSessionId?: string;
  inputFormat: string;
}): void {
  if (getDebugLevel() < 1) {
    return;
  }

  // Keep full payload for startup diagnostics; truncation hides critical flags.
  console.log(`[SDK:query_started] ${JSON.stringify(details)}`);
}

function formatRunFailure(params: {
  reason: string;
  detail?: string;
  stderrTail: string[];
}): string {
  const parts = [`Claude run failed: reason=${params.reason}`];
  if (params.detail) {
    parts.push(`detail=${normalizeLogLine(params.detail, 400)}`);
  }

  if (params.stderrTail.length > 0) {
    const tail = params.stderrTail.slice(-3).join(" | ");
    parts.push(`stderrTail=${tail}`);
  }

  if (params.reason === "timeout_startup") {
    parts.push(
      "hint=no output before startup timeout; verify Claude auth/config in HOME/XDG paths"
    );
  }

  return parts.join(" ");
}

function buildClaudeSubprocessEnv(threadId: string): Record<string, string | undefined> {
  let homedirFallback: string | undefined;
  try {
    homedirFallback = os.homedir();
  } catch {
    homedirFallback = undefined;
  }

  const home =
    process.env.HOME ??
    process.env.USERPROFILE ??
    (process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : undefined) ??
    homedirFallback;

  // The SDK documents env as merged on top of process.env, but merge
  // explicitly so the subprocess environment does not depend on that
  // behavior staying stable across SDK versions.
  const env: Record<string, string | undefined> = {
    ...process.env,
    // The API key must never leak into the agent subprocess environment.
    CONVOY_API_KEY: undefined,
    CLAUDE_AGENT_SDK_CLIENT_APP: "convoy-cli",
    // Thread identity (OS-1223).
    [ENV_THREAD_ID]: threadId,
  };

  if (!home) {
    return env;
  }

  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"),
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state"),
  };
}

async function resolveClaudeExecutablePath(): Promise<{
  command: string;
  source: string;
}> {
  const configured = process.env[CLAUDE_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("claude", {
    ...(configured ? { executablePath: configured } : {}),
  });
}

type SdkMessageParam = SDKUserMessage["message"];

function toMessageParam(value: unknown): SdkMessageParam | null {
  if (!isRecord(value) || value.role !== "user") {
    return null;
  }

  const content = value.content;
  if (typeof content === "string") {
    return { role: "user", content };
  }

  if (Array.isArray(content)) {
    return {
      role: "user",
      content: content as Extract<SdkMessageParam["content"], unknown[]>,
    };
  }

  return null;
}

function toSdkUserMessages(frames: unknown[]): SDKUserMessage[] {
  const messages: SDKUserMessage[] = [];
  for (const frame of frames) {
    if (!isRecord(frame) || frame.type !== "user") {
      continue;
    }

    const message = toMessageParam(frame.message);
    if (!message) {
      continue;
    }

    messages.push({
      type: "user",
      message,
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
  }
  return messages;
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * A streaming-input prompt that stays open after the initial messages so the
 * SDK control channel (canUseTool, interrupt, setPermissionMode) keeps
 * working for the whole run. `push()` injects additional user turns mid-run
 * (steering); `end()` releases the stream once the run finishes.
 */
function createOpenEndedInput(messages: SDKUserMessage[]): {
  iterable: AsyncGenerator<SDKUserMessage>;
  push: (next: SDKUserMessage[]) => void;
  end: () => void;
} {
  let ended = false;
  let release: (() => void) | null = null;
  const pending: SDKUserMessage[] = [...messages];

  const iterable = (async function* () {
    while (true) {
      const next = pending.shift();
      if (next) {
        yield next;
        continue;
      }
      if (ended) {
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  })();

  return {
    iterable,
    push(next: SDKUserMessage[]) {
      pending.push(...next);
      release?.();
      release = null;
    },
    end() {
      ended = true;
      release?.();
      release = null;
    },
  };
}

function promptToSdkUserMessage(prompt: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    uuid: randomUUID(),
  };
}

const CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

function isClaudeEffortLevel(
  value: string | undefined
): value is "low" | "medium" | "high" | "xhigh" | "max" {
  return value !== undefined && CLAUDE_EFFORT_LEVELS.has(value);
}

/**
 * Isolation (OS-1242): the SDK's OS sandbox wraps bash commands only — the file tools
 * write in-process, and under bypassPermissions nothing else constrains them. Hooks still
 * run in bypass mode, so this PreToolUse hook denies file-tool writes resolving outside
 * the writable roots (+ cwd, so worktrees keep working).
 *
 * ponytail: prefix check on the resolved path — a symlink inside a root can still point
 * outside; the OS sandbox contains bash regardless.
 */
const SANDBOX_GUARDED_FILE_TOOLS = new Map<string, string>([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["MultiEdit", "file_path"],
  ["NotebookEdit", "notebook_path"],
]);

function isInsidePath(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createSandboxFileGuard(
  writableRoots: string[],
  workingDirectory: string
): HookCallbackMatcher {
  const roots = [workingDirectory, ...writableRoots];
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const pathKey = SANDBOX_GUARDED_FILE_TOOLS.get(input.tool_name);
    if (!pathKey || !isRecord(input.tool_input)) return {};
    const rawPath = input.tool_input[pathKey];
    if (typeof rawPath !== "string") return {};
    const target = path.resolve(workingDirectory, rawPath);
    if (roots.some((root) => isInsidePath(target, root))) return {};
    return {
      decision: "block",
      reason: `Blocked by isolation: ${rawPath} is outside the sandbox writable paths`,
    };
  };
  return { matcher: [...SANDBOX_GUARDED_FILE_TOOLS.keys()].join("|"), hooks: [guard] };
}

function buildQueryOptions(params: {
  workingDirectory: string;
  executablePath: string;
  options: RunnerExecutionOptions;
  abortController: AbortController;
  stderrTail: string[];
  includePartialMessages: boolean;
  canUseTool: CanUseTool | null;
  onElicitation: ClaudeAgentOptions["onElicitation"];
  sandbox?: RunnerSandboxOptions;
  /** Managed credential env (OS-2108); replaces the connect marker. */
  providerEnv?: Record<string, string>;
}): ClaudeAgentOptions {
  const { options } = params;
  const permissionMode = toClaudePermissionMode(options.cliMode);
  const isPlanMode = permissionMode === "plan";
  const isBypass = permissionMode === "bypassPermissions";

  // Profile provider key (Bedrock/Mantle): the env inherited from connect is
  // not enough — settingSources loads ~/.claude/settings.json, whose `env`
  // overrides process env inside Claude Code. `--settings` outranks user
  // settings, so the provider env is re-sent through that layer too.
  const providerSettingsJson = params.providerEnv
    ? JSON.stringify({ env: params.providerEnv })
    : buildProviderSettingsJson(process.env[CLAUDE_PROVIDER_ENV_VAR]);
  // Ultracode is a session setting, not an SDK effort level; it runs at xhigh.
  const isUltracode = options.resolvedCliEffort === "ultracode";
  const settingsJson = isUltracode
    ? JSON.stringify({
        ...(providerSettingsJson ? JSON.parse(providerSettingsJson) : {}),
        ultracode: true,
      })
    : providerSettingsJson;

  // Agent prompt delivery (system-append, OS-1138): the bound agent's prompt
  // snapshot is appended to the claude_code preset on EVERY run — appends do
  // not survive --resume. The agent prompt comes first; plan-mode
  // instructions follow so run-mode rules take precedence over the persona.
  const systemPromptAppend = [
    options.agentPrompt,
    isPlanMode ? PLAN_MODE_SYSTEM_PROMPT : undefined,
    // Thread identity (OS-1223): appended every run so resumes keep it too.
    threadIdentityInstruction(options.threadId),
    options.workspaceNotice,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");

  return {
    ...(params.includePartialMessages ? { includePartialMessages: true } : {}),
    cwd: params.workingDirectory,
    pathToClaudeCodeExecutable: params.executablePath,
    abortController: params.abortController,
    // Parity with invoking the user's `claude` CLI directly: load the user's
    // settings/CLAUDE.md and the default Claude Code prompt and tool set.
    // The Agent SDK defaults to isolation mode (no filesystem settings).
    settingSources: ["user", "project", "local"],
    systemPrompt:
      systemPromptAppend.length > 0
        ? { type: "preset", preset: "claude_code", append: systemPromptAppend }
        : { type: "preset", preset: "claude_code" },
    tools: { type: "preset", preset: "claude_code" },
    permissionMode,
    // Plan approval or a steered message may switch to Act mid-run.
    ...(isBypass || isPlanMode || options.steerEnabled ? { allowDangerouslySkipPermissions: true } : {}),
    ...(params.canUseTool ? { canUseTool: params.canUseTool } : {}),
    ...(params.onElicitation ? { onElicitation: params.onElicitation } : {}),
    ...(options.resolvedCliModel ? { model: options.resolvedCliModel } : {}),
    ...(isUltracode
      ? { effort: "xhigh" as const }
      : isClaudeEffortLevel(options.resolvedCliEffort)
        ? { effort: options.resolvedCliEffort }
        : {}),
    ...(options.continuationId
      ? { resume: options.continuationId, forkSession: true }
      : {}),
    // Isolation (OS-1242): OS-level sandbox (Seatbelt/bubblewrap) with the profile paths as the
    // write boundary; the cwd is writable natively. failIfUnavailable stays at the SDK default —
    // the user opted in, so a machine that cannot sandbox fails loudly instead of running open.
    // additionalDirectories lets file tools cross between profile paths.
    ...(params.sandbox
      ? {
          sandbox: {
            enabled: true,
            // The model can otherwise set `dangerouslyDisableSandbox` on a Bash call to escape
            // (verified: in agent/bypass mode it runs with no prompt). false makes the SDK ignore
            // that flag — the load-bearing part of isolation, without which a hostile prompt just
            // opts out.
            allowUnsandboxedCommands: false,
            filesystem: { allowWrite: params.sandbox.writableRoots },
          },
          additionalDirectories: params.sandbox.writableRoots,
          hooks: {
            PreToolUse: [
              createSandboxFileGuard(params.sandbox.writableRoots, params.workingDirectory),
            ],
          },
        }
      : {}),
    ...(settingsJson ? { extraArgs: { settings: settingsJson } } : {}),
    env: { ...buildClaudeSubprocessEnv(options.threadId), ...params.providerEnv },
    stderr: (data: string) => {
      appendStderrTail(params.stderrTail, data);
      debugLog("stderr", data);
    },
  };
}

/** Result semantics match the CLI/web counterpart; see cli-sdk-integration.md. */
function claudeResultOutcome(record: Record<string, unknown>): {
  status: "completed" | "failed" | "interrupted";
  errorText?: string;
} {
  const reason = record.terminal_reason;
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((value): value is string => typeof value === "string")
    : [];
  if (reason === "aborted_tools" || reason === "aborted_streaming" || errors.some(
    (error) => error.includes("[ede_diagnostic]") && error.includes("stop_reason=tool_use")
  )) return { status: "interrupted" };
  const terminalErrors: Record<string, string> = {
    blocking_limit: "Claude stopped: a usage limit blocked the request.",
    rapid_refill_breaker: "Claude stopped: the context refilled too quickly after compaction.",
    prompt_too_long: "Claude stopped: the prompt exceeds the model's context window.",
    image_error: "Claude stopped: an image could not be processed.",
    model_error: "Claude stopped: the model returned an error.",
    api_error: "Claude gave up after repeated API errors.",
    malformed_tool_use_exhausted: "Claude gave up after repeated malformed tool calls.",
    budget_exhausted: "Claude stopped: the turn's token budget was exhausted.",
    structured_output_retry_exhausted: "Claude could not produce the requested structured output.",
    tool_deferred_unavailable: "Claude could not resume a deferred tool call: the tool is no longer available.",
    turn_setup_failed: "Claude could not start the turn.",
  };
  const structuredError = record.api_error_status === 529
    ? "Claude API is overloaded (529). Try again shortly."
    : typeof reason === "string" && Object.hasOwn(terminalErrors, reason) ? terminalErrors[reason] : undefined;
  const failed = !!structuredError || record.is_error === true ||
    (typeof record.subtype === "string" && record.subtype !== "success");
  const resultText = typeof record.result === "string" && record.result.trim() ? record.result : undefined;
  return {
    status: failed ? "failed" : "completed",
    errorText: structuredError ?? (errors.length ? errors.join("; ") : resultText),
  };
}

type SdkResultSummary = {
  subtype: string;
  isError: boolean;
  errorText?: string;
};

function summarizeResultMessage(message: SDKMessage): SdkResultSummary | null {
  if (message.type !== "result") {
    return null;
  }

  const record = message as unknown as Record<string, unknown>;
  const subtype = typeof record.subtype === "string" ? record.subtype : "unknown";
  const outcome = claudeResultOutcome(record);
  return { subtype, isError: outcome.status === "failed", errorText: outcome.errorText };
}

/**
 * Snapshot the context-window usage after a completed turn. The result message's `usage`
 * is cumulative API usage for the whole run, so live context size must come from the SDK
 * `get_context_usage` control request. Any failure (closed control channel, older Claude,
 * invalid values) skips the snapshot without failing the run; the meter keeps its last
 * valid value.
 */
async function fetchContextUsageChunk(run: Query): Promise<ContentChunk | null> {
  try {
    const usage = await run.getContextUsage();

    const usedTokens = usage.totalTokens;
    const maxTokens = usage.maxTokens;
    if (
      !Number.isFinite(usedTokens) ||
      usedTokens <= 0 ||
      !Number.isFinite(maxTokens) ||
      maxTokens <= 0
    ) {
      return null;
    }

    return {
      type: CONTEXT_USAGE_CHUNK_TYPE,
      data: JSON.stringify({
        type: CONTEXT_USAGE_CHUNK_TYPE,
        usedTokens,
        maxTokens,
      }),
    };
  } catch (error) {
    debugLog(
      "context_usage_error",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/**
 * The run's slash-command inventory, reported as the synthetic
 * `convoy.commands` chunk the other runtimes already use (OS-1806,
 * docs/specs/cli-runtime-commands.md). The init event advertises names only,
 * so the descriptions and argument hints the composer menu shows come from
 * this control request. Any failure (closed channel, older Claude) skips the
 * chunk; the composer keeps the last reported inventory.
 */
async function fetchSlashCommandsChunk(run: Query): Promise<ContentChunk | null> {
  try {
    const advertised = await run.supportedCommands();
    const commands = advertised
      .filter((command) => typeof command?.name === "string" && command.name.length > 0)
      .map((command) => ({
        name: command.name,
        // The SDK sends "" for an absent description or hint; dropped so the
        // menu falls back to its generic label instead of a blank one.
        ...(command.description ? { description: command.description } : {}),
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
      }));
    if (commands.length === 0) {
      return null;
    }

    return {
      type: "convoy.commands",
      data: JSON.stringify({ commands }),
    };
  } catch (error) {
    debugLog(
      "slash_commands_error",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

const TIMED_OUT = Symbol("timed-out");

/** A silent wait for background agents outlived its ceiling (OS-1661). */
const BACKGROUND_WAIT_EXPIRED = Symbol("background-wait-expired");

/**
 * Why a silent stream should keep waiting rather than fail:
 * `wait` re-arms the deadline, `background_expired` ends the turn with a notice,
 * `fail` is real idleness.
 */
type SilenceVerdict = "wait" | "background_expired" | "fail";

/**
 * Pull the next SDK message, failing the run when the stream stays silent past the
 * startup/idle deadline — the Agent SDK has no built-in inactivity guard.
 *
 * A run blocked in `canUseTool` awaiting a web approval, or holding a finished turn open
 * for a live background agent, emits nothing while it waits — which is not idleness
 * (OS-1458, OS-1661): the deadline re-arms for as long as `onSilence()` says to wait.
 */
async function nextMessageWithTimeout(
  iterator: AsyncIterator<SDKMessage>,
  timeoutMs: number,
  reason: "timeout_startup" | "timeout_idle",
  stderrTail: string[],
  onSilence?: () => SilenceVerdict,
  deadline?: () => number | null
): Promise<IteratorResult<SDKMessage> | typeof BACKGROUND_WAIT_EXPIRED> {
  const next = iterator.next();

  while (true) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      const end = deadline?.();
      const waitMs = end == null ? timeoutMs : Math.min(timeoutMs, Math.max(1, end - Date.now()));
      timer = setTimeout(() => resolve(TIMED_OUT), waitMs);
      timer.unref?.();
    });

    try {
      const settled = await Promise.race([next, timeout]);
      if (settled !== TIMED_OUT) {
        return settled;
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    const verdict = onSilence?.() ?? "fail";
    if (verdict === "background_expired") {
      return BACKGROUND_WAIT_EXPIRED;
    }
    if (verdict === "fail") {
      throw new RunnerExecutionError(formatRunFailure({ reason, stderrTail }));
    }
  }
}

export interface FileStreamOptions {
  /** Delay between lines in ms. Defaults to STREAM_DELAY_MS (1500). */
  delayMs?: number;
}

/**
 * Create a runner that streams lines from a JSONL file.
 * Each non-empty line is yielded as a ContentChunk with a delay.
 */
export function createFileStreamRunner(
  filePath: string,
  options?: FileStreamOptions
): CliRuntimeRunner {
  const delayMs = options?.delayMs ?? STREAM_DELAY_MS;
  let aborted = false;

  return {
    async *execute(
      _workingDirectory: string,
      _prompt: string,
      options: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      aborted = false;
      let continuationId: string | undefined;

      // Validate file exists before starting.
      await access(filePath, constants.R_OK);

      const rl = createInterface({
        input: createReadStream(filePath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (aborted) {
          rl.close();
          return {};
        }

        const trimmed = line.trim();
        if (trimmed === "") continue;

        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const nextContinuation = extractClaudeCodeContinuationId(parsed);
          if (nextContinuation) {
            continuationId = nextContinuation;
          }
        } catch {
          // ignore malformed JSON in fixture lines; chunk still streams through.
        }

        yield { type: parseChunkType(trimmed), data: trimmed };
        if (delayMs > 0) await sleep(delayMs);
      }

      if (!continuationId && options.requireContinuation) {
        throw new RunnerExecutionError(
          "Claude run completed without session_id/sessionId in stream-json output"
        );
      }

      return continuationId ? { continuationId } : {};
    },

    abort(): void {
      aborted = true;
    },

    async shutdown(): Promise<void> {
      aborted = true;
    },
  };
}

export type CreateClaudeQuery = typeof query;

export interface ClaudeCodeRunnerOptions {
  /** Test seam: replaces the Agent SDK `query` entry point. */
  createQuery?: CreateClaudeQuery;
  /** Emit `stream_event` partial messages for live token streaming. */
  includePartialMessages?: boolean;
  /** Isolation (OS-1242): OS sandbox with these writable roots. */
  sandbox?: RunnerSandboxOptions;
  /** Managed credential from the project launcher (OS-2108). */
  claudeAuth?: ClaudeAuth;
}

const SETTINGS_DIR_PATTERN = /^convoy-claude-settings-(\d+)-/;

/** Removes settings folders whose CLI process died mid-run; they hold provider keys (OS-2016). */
function sweepStaleSettingsDirs(): void {
  try {
    for (const name of readdirSync(os.tmpdir())) {
      const pid = Number(SETTINGS_DIR_PATTERN.exec(name)?.[1]);
      if (!pid) continue;
      const dir = path.join(os.tmpdir(), name);
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.uid !== process.getuid?.()) continue;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(dir, { recursive: true, force: true });
      }
    }
  } catch {
    // Best effort: a sweep failure must not block runs.
  }
}

/**
 * Create a Claude Code runner backed by `@anthropic-ai/claude-agent-sdk`.
 *
 * The SDK spawns the user's installed `claude` binary (never a bundled CLI) and yields
 * `SDKMessage` objects byte-equivalent to the CLI's stream-json output, so each is
 * re-serialized into the existing `ContentChunk` pipeline unchanged.
 */
export function createClaudeCodeRunner(
  runnerOptions?: ClaudeCodeRunnerOptions
): CliRuntimeRunner {
  const createQuery = runnerOptions?.createQuery ?? query;
  sweepStaleSettingsDirs();
  let runtimeExited: Promise<void> = Promise.resolve();
  let activeQuery: Query | null = null;
  let activeAbortController: AbortController | null = null;
  let activeRunInteractive = false;
  /**
  * Steering state for the active open-input run. Claude Code absorbs messages pushed
  * mid-turn into the current turn (no extra `result`), but one pushed after the turn
  * finalized queues a new turn. So instead of counting results, a steered run seeing a
  * `result` closes the input (EOF) and drains, letting the CLI finish any queued turn.
  */
  let activeSteer: { push: (frames: SDKUserMessage[]) => void; pushedFrames: boolean } | null = null;
  let hardAbortTimer: NodeJS.Timeout | null = null;
  let closed = false;
  /**
   * Set when abort was requested for the active run. A graceful interrupt of
   * a turn parked on an unresolved tool call (plan approval, question) makes
   * the CLI end the turn with an `error_during_execution` result
   * (`[ede_diagnostic] … stop_reason=tool_use`) — self-inflicted, not a run
   * failure (OS-1463).
   */
  let abortRequested = false;

  function clearHardAbortTimer(): void {
    if (hardAbortTimer) {
      clearTimeout(hardAbortTimer);
      hardAbortTimer = null;
    }
  }

  function hardAbort(): void {
    activeAbortController?.abort();
    try {
      activeQuery?.close();
    } catch {
      // best-effort close; the abort signal is the primary cancellation path.
    }
  }

  function abortActiveRun(): void {
    abortRequested = true;
    const run = activeQuery;
    if (run && activeRunInteractive) {
      // Graceful interrupt first (control protocol); the run yields a final
      // result and ends cleanly, preserving the continuation id. Fall back to
      // a hard abort if the stream does not end promptly.
      void run.interrupt().catch(() => {
        hardAbort();
      });
      if (!hardAbortTimer) {
        hardAbortTimer = setTimeout(() => {
          hardAbortTimer = null;
          hardAbort();
        }, 5_000);
        hardAbortTimer.unref?.();
      }
      return;
    }

    hardAbort();
  }

  return {
    async *execute(
      workingDirectory: string,
      prompt: string,
      options: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      if (closed) {
        throw new Error("Claude runner is shut down");
      }

      if (options.cliType !== "claude-code") {
        throw new Error(
          `Unsupported cliType "${options.cliType}" for SDK runner. Only "claude-code" is supported.`
        );
      }

      if (runnerOptions?.claudeAuth?.mode === "disabled") {
        throw new RunnerExecutionError("Claude Code is disabled for this project. Assign a key or explicitly restore native login.", { continuationId: options.continuationId });
      }
      const usageCommand = options.runtimeCommand?.command === "usage";
      if (usageCommand && options.runtimeCommand?.arguments?.trim()) {
        throw new RunnerExecutionError("/usage does not accept arguments.", { continuationId: options.continuationId });
      }

      const abortController = new AbortController();
      activeAbortController = abortController;
      abortRequested = false;
      const stderrTail: string[] = [];
      let continuationId: string | undefined = usageCommand ? options.continuationId : undefined;
      let resultSummary: SdkResultSummary | null = null;
      let launchFailed = false;

      let openInput: { end: () => void } | null = null;
      let inputEnded = false;
      let settingsDir: string | undefined;

      try {
        const executable = await resolveClaudeExecutablePath();

        const bootstrapMessages =
          options.inputFormat === "stream-json"
            ? toSdkUserMessages(options.bootstrapInput ?? [])
            : [];
        if (options.inputFormat === "stream-json" && bootstrapMessages.length === 0) {
          throw new Error("Claude stream-json input requires bootstrapInput frames");
        }

        // Interactive approvals need the SDK control channel, which only works in streaming
        // input mode with the input kept open. Bypass/`agent` mode installs it too: the SDK
        // short-circuits bypass for ordinary tools, but `requiresUserInteraction` ones
        // (AskUserQuestion, ExitPlanMode) still route through canUseTool, and without it they
        // resolve unanswered — the agent asks a question and walks straight past it.
        const interactive = options.interactionBridge !== undefined;
        // Steering also needs the input held open; any open-input run gets the
        // graceful interrupt() abort path.
        const openEnded = usageCommand || interactive || options.steerEnabled === true;
        activeRunInteractive = openEnded;
        // Counts requests parked on the user so the idle deadline can tell
        // "the user is deciding" from "the agent went silent" (OS-1458).
        let pendingInteractions = 0;
        const bridge = options.interactionBridge;
        const trackedBridge = bridge ? {
          ...bridge,
          request: async (...args: Parameters<typeof bridge.request>) => {
            pendingInteractions += 1;
            try {
              return await bridge.request(...args);
            } finally {
              pendingInteractions -= 1;
            }
          },
        } : undefined;
        const canUseTool = trackedBridge
          ? createClaudeCanUseTool({ bridge: trackedBridge, getActiveQuery: () => activeQuery })
          : null;
        const onElicitation = trackedBridge
          ? createClaudeOnElicitation({ bridge: trackedBridge })
          : undefined;

        const queryOptions = buildQueryOptions({
          workingDirectory,
          executablePath: executable.command,
          options,
          abortController,
          stderrTail,
          includePartialMessages: runnerOptions?.includePartialMessages ?? false,
          canUseTool,
          onElicitation,
          sandbox: runnerOptions?.sandbox,
          providerEnv: claudeAuthEnv(runnerOptions?.claudeAuth),
        });
        // Provider settings carry keys, so they go in a private file, never in argv.
        const settings = queryOptions.extraArgs?.settings;
        if (settings) {
          settingsDir = mkdtempSync(path.join(os.tmpdir(), `convoy-claude-settings-${process.pid}-`));
          const settingsFile = path.join(settingsDir, "settings.json");
          writeFileSync(settingsFile, settings, { mode: 0o600 });
          queryOptions.extraArgs = { ...queryOptions.extraArgs, settings: settingsFile };
        }
        if (usageCommand) {
          delete queryOptions.resume;
          delete queryOptions.forkSession;
          queryOptions.persistSession = false;
        }

        queryOptions.spawnClaudeCodeProcess = ({ command, args, ...spawnOptions }) => {
          const child = spawn(command, args, { ...spawnOptions, stdio: "pipe", windowsHide: true });
          runtimeExited = new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            child.once("error", () => { if (child.pid === undefined) resolve(); });
          });
          let started = false;
          child.once("spawn", () => { started = true; });
          child.once("error", () => { launchFailed = !started; });
          child.stderr.on("data", (chunk: Buffer) => queryOptions.stderr?.(chunk.toString()));
          return child;
        };

        debugQueryStart({
          executable: executable.command,
          executableSource: executable.source,
          cwd: workingDirectory,
          permissionMode: queryOptions.permissionMode ?? "default",
          model: queryOptions.model,
          resumeSessionId: options.continuationId,
          inputFormat:
            openEnded || options.inputFormat === "stream-json"
              ? "stream-json"
              : "prompt",
        });

        // A resume replays an orphaned background job's notification as its own turn ahead
        // of the prompt; its `result` must not end the run (OS-2094).
        const ownPromptUuids = new Set<string>();
        const startedTaskIds = new Set<string>();
        let orphanNotices = 0;

        let promptInput: string | AsyncIterable<SDKUserMessage>;
        if (openEnded) {
          const frames = usageCommand ? [] :
            options.inputFormat === "stream-json"
              ? bootstrapMessages
              : [promptToSdkUserMessage(prompt)];
          for (const frame of frames) if (frame.uuid) ownPromptUuids.add(frame.uuid);
          const open = createOpenEndedInput(frames);
          openInput = open;
          promptInput = open.iterable;
          if (options.steerEnabled === true && !usageCommand) {
            activeSteer = { push: open.push, pushedFrames: false };
          }
        } else if (options.inputFormat === "stream-json") {
          promptInput = toAsyncIterable(bootstrapMessages);
        } else {
          promptInput = prompt;
        }
        // A managed Anthropic run holds its prompt until Claude Code confirms it will use the key (OS-2016).
        let releasePrompt: (() => void) | undefined;
        if (runnerOptions?.claudeAuth?.mode === "anthropic" && !usageCommand) {
          const source = typeof promptInput === "string" ? [promptToSdkUserMessage(promptInput)] : promptInput;
          const ready = new Promise<void>((resolve) => { releasePrompt = resolve; });
          promptInput = (async function* () { await ready; yield* source; })();
        }

        const run = createQuery({
          prompt: promptInput,
          options: queryOptions,
        });
        activeQuery = run;

        if (releasePrompt) {
          let timer: NodeJS.Timeout | undefined;
          const account = await Promise.race([
            run.accountInfo(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Claude Code did not report its authentication.")), STARTUP_TIMEOUT_MS); }),
          ]).finally(() => clearTimeout(timer));
          if (account.apiProvider !== "firstParty" || account.apiKeySource !== "ANTHROPIC_API_KEY") {
            throw new RunnerExecutionError(
              `Claude Code would not use the assigned Anthropic key: it reports ${account.apiProvider ?? "unknown"} auth from ${account.apiKeySource ?? "an unknown source"}. A Claude apps gateway sign-in or administrator policy outranks the key. Sign out of the gateway in the project shell, or unassign the key.`,
              { continuationId: options.continuationId }
            );
          }
          releasePrompt();
        }

        if (usageCommand) {
          const report = await readClaudeUsage(run, abortController.signal);
          yield { type: "convoy.account_usage", data: JSON.stringify(report) };
          return continuationId ? { continuationId } : {};
        }

        const iterator: AsyncIterator<SDKMessage> = run[Symbol.asyncIterator]();
        let sawFirstMessage = false;
        let reportedSlashCommands = false;
        // The CLI's own error text for a run that never reached the API.
        let syntheticAssistantText: string | undefined;
        // Background agents run in-process, so ending the turn kills them (OS-1661).
        const spawnedBackgroundTaskIds = new Set<string>();
        const spawnedShellIds = new Set<string>();
        let liveBackgroundTaskIds = new Set<string>();
        let backgroundWaitDeadline: number | null = null;
        let shellWaitDeadline: number | null = null;
        // Only tasks this turn spawned via a tool call count. Intersected on read, not on
        // arrival: the snapshot can precede the `task_started` for the same id.
        const liveSpawnedCount = (shell?: boolean): number => {
          let count = 0;
          for (const taskId of liveBackgroundTaskIds) {
            if (spawnedBackgroundTaskIds.has(taskId) && (shell === undefined || spawnedShellIds.has(taskId) === shell)) count += 1;
          }
          return count;
        };
        const waitDeadline = (): number | null =>
          liveSpawnedCount(false) > 0 ? backgroundWaitDeadline : shellWaitDeadline;
        const backgroundWaitExpired = (): boolean => {
          const deadline = waitDeadline();
          return deadline !== null && Date.now() >= deadline;
        };
        const timeoutChunk = () => backgroundWaitTimeoutChunk(liveSpawnedCount(), liveSpawnedCount(false) === 0);
        // An abort ends the turn at the next result: waiting on background agents would
        // strand the graceful interrupt that preserves the continuation id (OS-1463).
        const holdingForBackgroundAgents = (): boolean =>
          liveSpawnedCount() > 0 && !abortRequested && !backgroundWaitExpired();

        while (true) {
          const next = await nextMessageWithTimeout(
            iterator,
            sawFirstMessage ? IDLE_TIMEOUT_MS : STARTUP_TIMEOUT_MS,
            sawFirstMessage ? "timeout_idle" : "timeout_startup",
            stderrTail,
            // A background agent can work far longer than the idle timeout without
            // emitting anything the parent sees, so it re-arms the deadline the same
            // way a request parked on the user does (OS-1458, OS-1661).
            () => {
              if (pendingInteractions > 0) return "wait";
              if (liveSpawnedCount() === 0 || abortRequested) return "fail";
              return backgroundWaitExpired() ? "background_expired" : "wait";
            },
            waitDeadline
          );
          // A silent hold that outlived the ceiling ends the turn with a notice rather
          // than the generic `timeout_idle` this would otherwise surface as.
          if (next === BACKGROUND_WAIT_EXPIRED) {
            yield timeoutChunk();
            break;
          }
          if (next.done) {
            break;
          }

          sawFirstMessage = true;
          const message = next.value;
          const record = message as unknown as Record<string, unknown>;
          const bounded = record.type === "system" && record.subtype === "background_tasks_changed" ? boundBackgroundTasks(record) : undefined;
          const data = JSON.stringify(bounded ?? message);
          debugLog(message.type, data);

          if (record.type === "system" && typeof record.task_id === "string") {
            if (record.subtype === "task_started") startedTaskIds.add(record.task_id);
            else if (record.subtype === "task_notification" && !startedTaskIds.has(record.task_id)) orphanNotices += 1;
          }
          // Prompt uuids are stamped by newer CLIs; older ones fall back to the notice count.
          const answeredUuids = Array.isArray(record.user_message_uuids) ? record.user_message_uuids : [];
          const orphanResult = message.type === "result" && orphanNotices > 0 &&
            !answeredUuids.some((uuid) => typeof uuid === "string" && ownPromptUuids.has(uuid));
          if (orphanResult) orphanNotices -= 1;

          const spawnedTaskId = readSpawnedBackgroundTaskId(message);
          if (spawnedTaskId) {
            spawnedBackgroundTaskIds.add(spawnedTaskId);
            if ((message as unknown as Record<string, unknown>).task_type === "local_bash") spawnedShellIds.add(spawnedTaskId);
          }

          const liveSnapshot = readLiveBackgroundTaskIds(message);
          if (liveSnapshot) {
            liveBackgroundTaskIds = liveSnapshot;
          }
          // Armed on first sight rather than at the result: the ceiling has to bound the
          // idle re-arm above too, or a turn that goes silent mid-agent waits forever.
          const liveCount = liveSpawnedCount();
          backgroundWaitDeadline =
            liveSpawnedCount(false) === 0
              ? null
              : (backgroundWaitDeadline ?? Date.now() + BACKGROUND_AGENT_WAIT_MS);
          if (liveSpawnedCount(true) === 0) shellWaitDeadline = null;
          else if (message.type === "result" && shellWaitDeadline === null) {
            shellWaitDeadline = Date.now() + BACKGROUND_SHELL_WAIT_MS;
          }

          // Checked every iteration, not only at a `result`: an agent emitting
          // `task_progress` keeps the loop busy, so a result-only check never fires.
          if (liveCount > 0 && backgroundWaitExpired()) {
            yield timeoutChunk();
            activeSteer = null;
            break;
          }

          const nextContinuation = extractClaudeCodeContinuationId(message);
          if (nextContinuation) {
            continuationId = nextContinuation;
          }

          resultSummary = summarizeResultMessage(message) ?? resultSummary;
          syntheticAssistantText =
            readSyntheticAssistantText(message) ?? syntheticAssistantText;

          if (!isSilentThinkingFrame(record)) {
            yield {
              type: typeof message.type === "string" ? message.type : "unknown",
              data,
            };
          }

          // Each completed turn gets a current-context snapshot, queried
          // while the SDK control channel is still alive (before the
          // open-input end/break below tears the run down).
          if (message.type === "result") {
            const contextUsageChunk = await fetchContextUsageChunk(run);
            if (contextUsageChunk) {
              debugLog(contextUsageChunk.type, contextUsageChunk.data);
              yield contextUsageChunk;
            }

            // Once per run, on the same live control channel: the inventory is
            // profile-scoped and outlives the run, so one report is enough.
            if (!reportedSlashCommands) {
              reportedSlashCommands = true;
              const slashCommandsChunk = await fetchSlashCommandsChunk(run);
              if (slashCommandsChunk) {
                debugLog(slashCommandsChunk.type, slashCommandsChunk.data);
                yield slashCommandsChunk;
              }
            }
          }

          // With an open-ended input stream the session would idle waiting for more user
          // messages after the turn, so an unsteered run ends at its first result. A steered run
          // cannot map results to pushed frames (mid-turn pushes are absorbed into the running
          // turn), so it closes the input and drains to natural completion — letting the CLI
          // finish any turn still queued from a late push.
          if (message.type === "result" && openInput && !inputEnded) {
            // A live background agent means the session is not idle — it has in-process work
            // that ending the turn would kill, losing its output and making the next resume
            // synthesize a "was running when the previous process exited" failure.
            // Spec: docs/specs/cli-sdk-integration.md (OS-1661).
            if (holdingForBackgroundAgents() || orphanResult) {
              continue;
            }

            const steered = activeSteer?.pushedFrames === true;
            activeSteer = null;
            if (!steered) {
              break;
            }
            inputEnded = true;
            openInput.end();
          }
        }

        // An error result on a run we interrupted ourselves is self-inflicted: gracefully
        // interrupting a turn parked on an unresolved tool call makes the CLI end with
        // `error_during_execution` / `stop_reason=tool_use`. The run wound down as intended, and
        // surfacing it flashed a red "run failed" on a thread that is merely waiting (OS-1463).
        if (resultSummary?.isError && !abortRequested) {
          throw new RunnerExecutionError(
            formatRunFailure({
              reason: `result_${resultSummary.subtype}`,
              detail: resultSummary.errorText ?? syntheticAssistantText,
              stderrTail,
            }),
            { continuationId }
          );
        }

        if (!continuationId && options.requireContinuation) {
          throw new RunnerExecutionError(
            "Claude run completed without session_id/sessionId in stream-json output"
          );
        }

        return continuationId ? { continuationId } : {};
      } catch (error) {
        if (error instanceof RunnerExecutionError) {
          if (error.continuationId === undefined && continuationId) {
            error.continuationId = continuationId;
          }
          throw error;
        }

        const reason = abortController.signal.aborted
          ? "cancelled_by_user"
          : "sdk_error";
        throw new RunnerExecutionError(
          formatRunFailure({
            reason,
            detail: error instanceof Error ? error.message : String(error),
            stderrTail,
          }),
          { continuationId, launchFailed }
        );
      } finally {
        activeSteer = null;
        openInput?.end();
        clearHardAbortTimer();
        try {
          activeQuery?.close();
        } catch {
          // stream already closed.
        }
        activeQuery = null;
        activeAbortController = null;
        activeRunInteractive = false;
        if (settingsDir) rmSync(settingsDir, { recursive: true, force: true });
      }
    },

    steer(injection: PreparedRuntimeExecution, cliMode?: CliMode): boolean | Promise<boolean> {
      const steerState = activeSteer;
      if (!steerState) {
        return false;
      }

      const frames =
        injection.inputFormat === "stream-json"
          ? toSdkUserMessages(injection.bootstrapInput ?? [])
          : injection.prompt.length > 0
            ? [promptToSdkUserMessage(injection.prompt)]
            : [];
      if (frames.length === 0) {
        return false;
      }

      // Mark before push: once the run loop observes a result it nulls activeSteer synchronously,
      // so a successful steer() here is guaranteed to happen-before that decision and gets its
      // frames processed — absorbed into the running turn, or queued and drained after input EOF.
      const push = (): boolean => {
        if (activeSteer !== steerState) return false;
        steerState.pushedFrames = true;
        steerState.push(frames);
        return true;
      };
      const run = activeQuery;
      if (cliMode === undefined || !run) return push();
      // The message runs under its own mode; a failed switch leaves it queued for the next run.
      return run.setPermissionMode(toClaudePermissionMode(cliMode)).then(push, () => false);
    },

    abort(): void {
      abortActiveRun();
    },

    async shutdown(): Promise<void> {
      closed = true;
      abortActiveRun();
      await runtimeExited;
    },
  };
}