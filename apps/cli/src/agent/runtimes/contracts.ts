import type { ClaudeAuth, CodexAuth, CursorAuth, AntigravityAuth, OpencodeAuth } from "../../lib/config/credentials/validators.js";
import type { CodexProviderKey } from "../../lib/config/types.js";
/**
 * Thread/message mode. `agent` is the legacy full-access value
 * (bypassPermissions); the rest map 1:1 to provider permission modes.
 */
export type CliMode =
  | "agent"
  | "plan"
  | "default"
  | "acceptEdits"
  | "auto"
  | "dontAsk";

export const CLI_MODES: readonly CliMode[] = [
  "agent",
  "plan",
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
];

export type ContentChunk = { type: string; data: string };

export type InteractionKind = "tool-approval" | "question" | "plan-approval";

export interface InteractionRequestInput {
  requestId: string;
  kind: InteractionKind;
  payloadJson: string;
}

/**
 * Provider-neutral bridge from a running provider callback to the web user, signaled
 * through Convex. `request` resolves with the user's raw response JSON and only ever
 * rejects via the abort signal; `cancel` marks a parked request dead.
 *
 * `abandoned` is a structural contract, not a display string (OS-1463): true means the
 * CLI is abandoning the run, so the server row must stay pending — it is the parked
 * signal the wind-down mutations turn into `waiting_input`, cancelling the rows
 * themselves. False means the provider withdrew one request while the run continues.
 */
export interface InteractionBridge {
  request(
    input: InteractionRequestInput,
    signal: AbortSignal
  ): Promise<string>;
  cancel(
    requestId: string,
    opts: { abandoned: boolean; reason?: string }
  ): void;
}

/**
 * How a runtime delivers a bound Project agent's prompt (OS-1138):
 * - `system-append`: the per-invocation append channel, re-supplied every run (appends
 *   do not survive resume).
 * - `first-message`: prepended to a fresh session's first message; the transcript then
 *   carries it across resumes.
 * - `unsupported`: the runtime cannot deliver one.
 */
export type AgentPromptDelivery =
  | "system-append"
  | "first-message"
  | "unsupported";

export interface RunnerExecutionOptions {
  cliType: string;
  /**
   * Convoy CLI thread this run belongs to (OS-1223). Delivered to the
   * spawned runtime as the CONVOY_THREAD_ID env var and as prompt context
   * so the agent can reference its own thread via MCP thread tools.
   */
  threadId: string;
  continuationId?: string;
  /** Codex: `continuationId` is another thread's session; fork it through this turn instead of resuming (OS-2073). */
  forkTurnId?: string;
  cliMode?: CliMode;
  /**
   * Bound Project agent prompt (the thread's creation-time snapshot, never a
   * live lookup). Runners deliver it per their `agentPromptDelivery` mode.
   */
  agentPrompt?: string;
  /** Display name of the bound Project agent (for the delimited block). */
  agentName?: string;
  /** Current checkout after automatic worktree recovery; delivered on resumed runs too. */
  workspaceNotice?: string;
  cliModel?: string;
  resolvedCliModel?: string;
  /** Server-resolved reasoning effort; absent means the machine default. */
  resolvedCliEffort?: string;
  requireContinuation?: boolean;
  inputFormat?: "prompt" | "stream-json";
  bootstrapInput?: unknown[];
  /** Present when the connection supports interactive approvals. */
  interactionBridge?: InteractionBridge;
  /**
   * Keep the run's input stream open so `steer()` can inject additional user
   * turns mid-run. Set when the runner implements `steer`.
   */
  steerEnabled?: boolean;
  /** Execute this parsed runtime command instead of prompting with text. */
  runtimeCommand?: RuntimeCommandInvocation;
  rawRuntimeCommand?: boolean;
  /**
   * A Workflow Bash step's script (OS-1886). Read by the script runner, which
   * the thread processor selects instead of the agent runtime for such runs.
   */
  scriptRequest?: ScriptRequest;
}

export interface ScriptRequest {
  script: string;
  timeoutMs: number;
}

/** How a script run ended; the CLI reports it with `complete` for the run engine. */
export interface ScriptResult {
  exitCode: number;
  timedOut: boolean;
  outputTail: string;
}

export interface RunnerExecutionResult {
  continuationId?: string;
  /** The Codex turn this reply is; a later branch forks through it (OS-2073). */
  turnId?: string;
  scriptResult?: ScriptResult;
}

export class RunnerExecutionError extends Error {
  continuationId?: string;
  turnId?: string;
  readonly launchFailed: boolean;

  constructor(message: string, options?: { continuationId?: string; turnId?: string; launchFailed?: boolean }) {
    super(message);
    this.name = "RunnerExecutionError";
    this.continuationId = options?.continuationId;
    this.turnId = options?.turnId;
    this.launchFailed = options?.launchFailed ?? false;
    Object.setPrototypeOf(this, RunnerExecutionError.prototype);
  }
}

/**
 * Runner for runtimes with no OS sandbox support when isolation is on:
 * every run fails fast with a clear message — a security opt-in must not
 * silently run unsandboxed.
 */
export function createSandboxUnsupportedRunner(cliType: string): CliRuntimeRunner {
  return {
    // eslint-disable-next-line require-yield
    async *execute(): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      throw new RunnerExecutionError(
        `${cliType} does not support OS sandboxing. Disable isolation (remove --isolated / profile "isolated") or use claude-code or codex for this thread.`
      );
    },
    abort(): void {},
    async shutdown(): Promise<void> {},
  };
}

export interface CliRuntimeRunner {
  execute(
    workingDirectory: string,
    prompt: string,
    options: RunnerExecutionOptions
  ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown>;
  /**
  * Inject a prepared user turn into the active steer-enabled run. False when no
  * steerable run is active or the runtime rejected it (the caller then queues for the
  * next run). May be sync (Claude pushes into an open input stream) or async (codex
  * round-trips `turn/steer`); runtimes without mid-run injection omit this.
  */
  /** `cliMode` is the steered messages' mode; runtimes that can switch a live session apply it. */
  steer?(injection: PreparedRuntimeExecution, cliMode?: CliMode): boolean | Promise<boolean>;
  abort(): void;
  /** What the last stopped run confirmed while stopping, for `acknowledgeStop` (Codex goal pause, OS-2277). */
  stopReport?(): { goalPaused: boolean } | undefined;
  shutdown(): Promise<void>;
}

/**
 * OS-level sandbox boundary generated from the profile's `paths[]`
 * (OS-1242). Provider-neutral: each runtime maps `writableRoots` onto its
 * own mechanism (Claude Code Seatbelt/bubblewrap settings, Codex sandbox
 * flags). The run's working directory is writable natively in both
 * runtimes and need not be listed.
 */
export interface RunnerSandboxOptions {
  writableRoots: string[];
}

export interface CliRuntimeRunnerFactoryOptions {
  streamFile?: string;
  streamDelayMs?: number;
  /** Emit partial (delta) events for live token streaming (connection-level opt-in). */
  partialStreaming?: boolean;
  /**
   * Run Codex through the experimental `codex app-server` JSON-RPC transport
   * (interactive approvals, plan mode, deltas) instead of `codex exec --json`
   * (connection-level; the default, opt out via `--codex-exec`).
   */
  codexAppServer?: boolean;
  /** Assigned Codex credential delivered by the project launcher. */
  codexAuth?: CodexAuth;
  /** AWS provider assigned to Codex on an ordinary profile; only Codex children see it (OS-2105). */
  codexProvider?: CodexProviderKey;
  /** Managed Claude Code credential; only the Claude child sees it (OS-2108). */
  claudeAuth?: ClaudeAuth;
  /** Managed Cursor key; only the cursor-agent child sees it (OS-2017). */
  cursorAuth?: CursorAuth;
  /** Managed Gemini key; only the agy child sees it (OS-2476). */
  antigravityAuth?: AntigravityAuth;
  /** Managed OpenCode keys; only the opencode server child sees them (OS-2018). */
  opencodeAuth?: OpencodeAuth;
  /**
   * Present when isolation is enabled (`--isolated` / profile `isolated`).
   * Connection-level like the profile it derives from. Runtimes without OS
   * sandbox support must fail runs fast instead of degrading silently.
   */
  sandbox?: RunnerSandboxOptions;
}

/**
 * Runtime-specific policy for the outgoing chunk flush buffer. Deferrable
 * chunks (deltas) may wait for a flush window and be coalesced; everything
 * else flushes immediately.
 */
export interface ChunkStreamPolicy {
  isDeferrable(chunk: ContentChunk): boolean;
  /** Merge `next` into `prev` when both extend the same content block; null = not mergeable. */
  coalesce(prev: ContentChunk, next: ContentChunk): ContentChunk | null;
  /** Streamed text of a deferrable chunk; null = not a text delta. */
  text(chunk: ContentChunk): string | null;
  /** The same delta carrying `text` instead. Only called when `text(chunk)` is non-null. */
  withText(chunk: ContentChunk, text: string): ContentChunk;
  /** Which agent emitted the chunk (main or one child); default: one stream. */
  stream?(chunk: ContentChunk): string;
}

export interface RuntimeResolvedAttachment {
  storageId: string;
  fileName: string;
  contentType: string;
  localPath: string;
  inlineImage: boolean;
}

export interface RuntimeUserMessageInput {
  contextOnly?: boolean;
  id: string;
  createdAt: number;
  cliMode?: string;
  taskRef?: string;
  /** The message's Attached pull request; the agent reads it with `gh`. */
  pullRequest?: { owner: string; name: string; number: number };
  contentText: string;
  /**
   * Message is a runtime slash command ("/compact", "/my-skill args"). The
   * thread processor runs it alone; runtimes that understand it deliver
   * the text raw (no run envelope) so the agent interprets it natively.
   */
  runtimeCommand?: boolean;
  attachments: RuntimeResolvedAttachment[];
}

export interface RuntimeExecutionInput {
  messages: RuntimeUserMessageInput[];
}

/**
 * Parsed solo runtime-command run ("/name args" → name + args). Set only
 * by runtimes whose agent does not interpret slash text natively and needs a
 * dedicated execution call instead (OpenCode's session.command); Claude Code
 * omits it and delivers the raw prompt.
 */
export interface RuntimeCommandInvocation {
  command: string;
  arguments?: string;
}

export interface PreparedRuntimeExecution {
  prompt: string;
  inputFormat: "prompt" | "stream-json";
  bootstrapInput?: unknown[];
  runtimeCommand?: RuntimeCommandInvocation;
  rawRuntimeCommand?: boolean;
}

export interface DetectedCliModel {
  /** Run value: OpenCode's `providerID/modelID` slug or an agy model id. */
  slug: string;
  name: string;
  /** Per-model effort values: OpenCode variants, agy thinking levels. */
  variants?: string[];
}

export interface DetectedCli {
  type: string;
  version: string;
  provider?: string;
  /** AWS Region of an assigned Codex provider (OS-2105). */
  region?: string;
  /** Dynamic model inventory (OpenCode, Antigravity). */
  models?: DetectedCliModel[];
  defaultModel?: string;
}

export interface CliRuntimeDetectOptions {
  codexProvider?: CodexProviderKey;
  claudeAuth?: ClaudeAuth;
  antigravityAuth?: AntigravityAuth;
  opencodeAuth?: OpencodeAuth;
}

export interface CliRuntimeDefinition {
  type: string;
  /** How this runtime delivers a bound Project agent's prompt. */
  agentPromptDelivery: AgentPromptDelivery;
  detectAvailableCli(options?: CliRuntimeDetectOptions): Promise<DetectedCli | null>;
  createRunner(options: CliRuntimeRunnerFactoryOptions): CliRuntimeRunner;
  normalizeCliModel(model: unknown): string | undefined;
  isInlineImageAttachment(contentType: string): boolean;
  prepareRunExecution(
    input: RuntimeExecutionInput
  ): Promise<PreparedRuntimeExecution>;
  getChunkStreamPolicy?(): ChunkStreamPolicy;
  /**
   * The chunk signals that repo state changed mid-run (commit created,
   * branch switched, PR published). The thread processor reacts by
   * refreshing the thread's branch/PR snapshot (OS-1386, OS-1387).
   */
  signalsVcsStateChange?(chunk: ContentChunk): boolean;
}
