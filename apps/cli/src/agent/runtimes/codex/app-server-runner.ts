import { spawn, type ChildProcess } from "node:child_process";
import { emitConnectEvent } from "../../../lib/connect-events.js";
import type { CodexAuth } from "../../../lib/config/credentials/validators.js";
import type { CodexProviderKey } from "../../../lib/config/types.js";
import {
  CODEX_AWS_PROVIDER_IDS, assertCodexProvider, checkNativeCodexAuth, authenticateCodex, codexProviderArgs,
  codexProviderEnv, codexProviderLabel, codexSecret, managedAuthArgs, managedAuthEnv, redactAuthParams,
} from "./auth.js";
import { isCodexProviderModel } from "./models.js";
import { collectCodexDiagnostics, formatCodexFailure, sanitizeCodexDiagnostic } from "./errors.js";
import { getCliVersion } from "../../../lib/version.js";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import {
  RunnerExecutionError,
  type CliMode,
  type CliRuntimeRunner,
  type ContentChunk,
  type InteractionBridge,
  type PreparedRuntimeExecution,
  type RunnerExecutionOptions,
  type RunnerExecutionResult,
  type RunnerSandboxOptions,
} from "../contracts.js";
import { getDebugLevel } from "../debug.js";
import { threadIdentityInstruction } from "../agent-instructions.js";
import { createAppServerRpc, type AppServerRpc } from "./app-server-rpc.js";
import { createCodexInteractions } from "./interactions.js";
import { createCodexChildDrain, createCodexChildRouter, createCodexJobTracker } from "./lifecycle.js";
import { createCodexUsage } from "./usage/index.js";
import { createCodexGoals } from "./goals/index.js";
import { parseGoalCommand } from "./goals/parsers.js";
import { discoverCodexCommands, isCodexAppServerCommand } from "./commands.js";
import { detectCodex } from "./detect.js";
import { satisfiesVersionRange } from "../../sdk/versioning/provider-version.js";
import {
  buildCodexSubprocessEnv,
  codexWritableRootsConfigArgs,
  killCodexProcess,
  resolveCodexExecutablePath,
} from "./runner.js";

/**
 * Codex runner over the experimental `codex app-server` JSON-RPC transport
 * (OS-1109; the default transport, opt out via `convoy connect
 * --codex-exec`). Unlike the `codex exec --json` runner, this transport
 * supports interactive approvals (through the interaction bridge), plan mode,
 * live text/reasoning deltas, and context-window token usage.
 */

/** No app-server notifications for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const ABORT_FORCE_KILL_MS = 5_000;
/** Codex starts the next goal turn ~14 ms after the last one (trace C2). */
const GOAL_CONTINUATION_MS = 30_000;
/** Stop waits this long for Codex to confirm the goal pause before killing it. */
const STOP_GOAL_PAUSE_MS = 2_000;

/** Branching needs `thread/fork` with `lastTurnId`, verified on this codex-cli (OS-2073). */
export const MIN_CODEX_FORK_VERSION = "0.156.1";

async function assertCodexCanFork(): Promise<void> {
  const codex = await detectCodex();
  if (!codex || !satisfiesVersionRange(codex.version, `>=${MIN_CODEX_FORK_VERSION}`)) {
    throw new RunnerExecutionError(
      `Branching a Codex thread needs codex-cli ${MIN_CODEX_FORK_VERSION} or newer (found ${codex?.version ?? "none"}).`
    );
  }
}

export interface CodexThreadPermissions {
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}

/**
 * Thread mode → app-server approval policy + sandbox. `agent` (and unset) matches
 * Claude's bypassPermissions; `auto`/`dontAsk` keep the exec transport's "sandboxed,
 * never asks"; `default` asks for every untrusted action; `plan` is read-only with
 * on-request escalation. Isolation (OS-1242) removes `danger-full-access`.
 */
export function threadPermissionsForMode(
  mode: CliMode | undefined,
  isolated = false
): CodexThreadPermissions {
  switch (mode) {
    case undefined:
    case "agent":
      return isolated
        ? { approvalPolicy: "never", sandbox: "workspace-write" }
        : { approvalPolicy: "never", sandbox: "danger-full-access" };
    case "plan":
      return { approvalPolicy: "on-request", sandbox: "read-only" };
    case "default":
      return { approvalPolicy: "untrusted", sandbox: "workspace-write" };
    case "acceptEdits":
      return { approvalPolicy: "on-request", sandbox: "workspace-write" };
    case "auto":
    case "dontAsk":
      return { approvalPolicy: "never", sandbox: "workspace-write" };
  }
}

/** Built-in mode instructions compose with thread instructions on Codex 0.142+. */
export function collaborationModeForRun(options: {
  cliMode?: CliMode;
  model?: string;
  runEffort?: string;
}): Record<string, unknown> {
  const model = options.model;
  if (!model) {
    throw new Error("Codex did not resolve a model for the collaboration mode.");
  }
  return {
    mode: options.cliMode === "plan" ? "plan" : "default",
    settings: {
      model,
      reasoning_effort: options.runEffort ?? null,
      developer_instructions: null,
    },
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export {
  parseCodexUserInputQuestions,
  toCodexUserInputAnswers,
  toCodexApprovalDecision,
} from "./interactions.js";

/** Chunk-forwarded notification methods (beyond deltas, which gate on streaming). */
const FORWARDED_NOTIFICATIONS = new Set([
  "turn/started",
  "turn/completed",
  // Full plan snapshot on every `update_plan`; forwarded unconditionally
  // because it is state, not partial text (so it does not gate on streaming).
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "thread/tokenUsage/updated",
  "model/rerouted",
  "error",
]);

const DELTA_NOTIFICATIONS = new Set([
  "item/plan/delta",
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
]);

function debugLog(kind: string, payload: string): void {
  if (getDebugLevel() < 1) {
    return;
  }
  console.log(`[CodexAppServer:${kind}] ${payload.slice(0, 400)}`);
}

/** Single-consumer queue bridging notification callbacks into the generator. */
function createChunkQueue(): {
  push(chunk: ContentChunk): void;
  end(): void;
  next(): Promise<ContentChunk | null>;
} {
  const items: ContentChunk[] = [];
  let ended = false;
  let wake: (() => void) | null = null;

  return {
    push(chunk) {
      if (ended) {
        return;
      }
      items.push(chunk);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    async next() {
      for (;;) {
        const item = items.shift();
        if (item) {
          return item;
        }
        if (ended) {
          return null;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
  };
}

interface OpenedThread {
  threadId: string;
  threadModel?: string;
}

async function openThread(
  rpc: AppServerRpc,
  options: {
    workingDirectory: string;
    permissions: CodexThreadPermissions;
    runModel?: string;
    /** Provider the opened thread must confirm; `mismatch` is the failure message. */
    modelProvider?: { id: string; mismatch: string };
    continuationId?: string;
    forkTurnId?: string;
    developerInstructions?: string;
  }
): Promise<OpenedThread> {
  // Agent prompt delivery (system-append, OS-1138): `developerInstructions` appends the bound
  // agent's prompt snapshot per-thread through the RPC, on both thread/start and thread/resume.
  // Never `baseInstructions` (the replacement path) and never a spawn-level `-c` override — one
  // app-server can serve parallel threads, so process-wide config can't carry a persona.
  const params: Record<string, unknown> = {
    cwd: options.workingDirectory,
    approvalPolicy: options.permissions.approvalPolicy,
    sandbox: options.permissions.sandbox,
    ...(options.runModel ? { model: options.runModel } : {}),
    ...(options.modelProvider ? { modelProvider: options.modelProvider.id } : {}),
    ...(options.developerInstructions
      ? { developerInstructions: options.developerInstructions }
      : {}),
  };
  // A branched thread's session belongs to its parent: fork it through the copied turn (OS-2073).
  const opened = options.forkTurnId
    ? await rpc.request("thread/fork", { threadId: options.continuationId, lastTurnId: options.forkTurnId, ...params })
    : options.continuationId
      ? await rpc.request("thread/resume", { threadId: options.continuationId, ...params })
      : await rpc.request("thread/start", params);

  if (options.modelProvider && (!isRecord(opened) || opened.modelProvider !== options.modelProvider.id)) throw new Error(options.modelProvider.mismatch);
  const thread = isRecord(opened) && isRecord(opened.thread) ? opened.thread : null;
  const threadId = getString(thread?.id);
  if (!threadId) {
    throw new Error("codex app-server did not return a thread id");
  }
  return {
    threadId,
    threadModel: isRecord(opened) ? getString(opened.model) : undefined,
  };
}

/**
 * Dispatch a runtime command to its dedicated app-server RPC (OS-1582).
 * `thread/compact/start` takes only `threadId` and returns an empty result;
 * the compaction itself proceeds as a normal turn. `/compact` takes no
 * arguments, so any are ignored rather than rejected — the runtime is the
 * authority on its own command surface.
 */
async function startCodexRuntimeCommand(
  rpc: AppServerRpc,
  threadId: string,
  runtimeCommand: { command: string; arguments?: string }
): Promise<void> {
  // Guarded against the advertised inventory (commands.ts) so discovery and
  // execution cannot drift: anything the composer can offer must map here.
  // Fail loudly on a miss rather than running it as prose — the OS-1582
  // failure mode, where the model answered as though it had run the command.
  if (!isCodexAppServerCommand(runtimeCommand.command)) {
    throw new RunnerExecutionError(
      `Codex cannot execute the "/${runtimeCommand.command}" command.`,
      { continuationId: threadId }
    );
  }

  switch (runtimeCommand.command) {
    case "compact":
      await rpc.request("thread/compact/start", { threadId });
      return;
  }
}

/** AWS runs need an explicit model ID of that provider, never a native or default one. */
function assertCodexProviderRun(provider: CodexProviderKey, options: RunnerExecutionOptions): void {
  const label = codexProviderLabel(provider);
  if (options.runtimeCommand?.command === "usage") {
    throw new RunnerExecutionError(
      `Account usage is not available for Codex on ${label}. Check usage and quotas in the AWS console.`,
      { continuationId: options.continuationId }
    );
  }
  const model = options.resolvedCliModel;
  if (!options.runtimeCommand && (!model || !isCodexProviderModel(provider.provider, model))) {
    throw new RunnerExecutionError(
      `Select a GPT-6 or GPT-5.6 model to run Codex on ${label}${model ? ` ("${model}" is not a ${label} model)` : ""}.`,
      { continuationId: options.continuationId }
    );
  }
}

export function createCodexAppServerRunner(factoryOptions?: {
  codexAuth?: CodexAuth;
  codexProvider?: CodexProviderKey;
  partialStreaming?: boolean;
  sandbox?: RunnerSandboxOptions;
  /** Test override for the goal continuation watchdog. */
  goalContinuationMs?: number;
}): CliRuntimeRunner {
  const codexAuth = factoryOptions?.codexAuth;
  const codexProvider = factoryOptions?.codexProvider;
  const secret = codexSecret(codexAuth, codexProvider);
  const partialStreaming = factoryOptions?.partialStreaming ?? false;
  const sandbox = factoryOptions?.sandbox;
  const goalContinuationMs = factoryOptions?.goalContinuationMs ?? GOAL_CONTINUATION_MS;

  let aborted = false;
  let forceKillTimer: NodeJS.Timeout | null = null;
  let activeChild: ChildProcess | null = null;
  let runtimeExited: Promise<void> = Promise.resolve();
  let requestInterrupt: (() => void) | null = null;
  // Mid-run steering (OS-1111): injects a user turn into the active turn via
  // the `turn/steer` RPC. Set per execute, null between runs.
  let activeSteer: ((injection: PreparedRuntimeExecution) => Promise<boolean>) | null = null;
  // The processor may abandon the generator mid-yield after an unrelated
  // error, so abort() must also run the per-run cleanup that the generator's
  // own finally would otherwise handle.
  let cleanupActiveRun: (() => void) | null = null;
  let stopReport: { goalPaused: boolean } | undefined;

  const abort = (): void => {
    aborted = true;
    requestInterrupt?.();
    cleanupActiveRun?.();
    const child = activeChild;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    forceKillTimer = setTimeout(() => {
      killCodexProcess(child, "SIGKILL");
    }, ABORT_FORCE_KILL_MS);
    forceKillTimer.unref?.();
  };

  return {
    async *execute(
      workingDirectory: string,
      prompt: string,
      options: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      if (codexAuth?.mode === "disabled") throw new RunnerExecutionError("Codex is disabled for this project. Assign a key or explicitly restore native login.");
      aborted = false;
      stopReport = undefined;
      if (codexProvider) assertCodexProviderRun(codexProvider, options);
      if (options.forkTurnId) await assertCodexCanFork();
      const executable = await resolveCodexExecutablePath();
      debugLog("spawn", `${executable.command} app-server`);

      // Writable roots are profile-scoped (isolation, OS-1242), so a
      // process-level `-c` override is correct even with parallel threads —
      // unlike per-thread personas, which must go through the RPC.
      const child = spawn(
        executable.command,
        [
          ...(sandbox ? codexWritableRootsConfigArgs(sandbox) : []),
          ...managedAuthArgs(codexAuth),
          ...codexProviderArgs(codexProvider),
          "app-server",
        ],
        {
          cwd: workingDirectory,
          env: codexProviderEnv(managedAuthEnv(buildCodexSubprocessEnv(options.threadId), codexAuth), codexProvider),
          stdio: ["pipe", "pipe", "pipe"],
          // Own process group so aborts can kill the wrapper and the native
          // binary together (see killCodexProcess).
          detached: process.platform !== "win32",
        }
      );
      activeChild = child;
      runtimeExited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.once("error", () => { if (child.pid === undefined) resolve(); });
      });

      const stderrTail = child.stderr
        ? collectCodexDiagnostics(child.stderr, secret, (line) => debugLog("stderr", line))
        : () => "";

      let spawnError: Error | null = null;
      let exited = false;
      const queue = createChunkQueue();
      const bridgeAbort = new AbortController();
      const bridge: InteractionBridge | undefined = options.interactionBridge;
      const pendingInteractionIds = new Set<string>();

      // Until the fork RPC answers, the only known thread is the parent's; never report it as ours.
      let threadId: string | undefined = options.forkTurnId ? undefined : options.continuationId;
      let turnId: string | undefined;
      let turnCompleted = false;
      // Root turn ended with the goal still active: Codex starts the next one itself (C2).
      let continuationTimer: NodeJS.Timeout | null = null;
      let stopPause: Promise<boolean> | null = null;
      let failureMessage: string | null = null;
      let lastActivityAt = Date.now();
      let idleTimedOut = false;
      // fileChange approval params carry no diff; enrich from item/started.
      const fileChangesByItemId = new Map<string, unknown>();

      const idleWatchdog = setInterval(() => {
        // A run parked on a web approval/question emits nothing while the
        // user thinks; that is not idleness (OS-1463, matching OS-1458 for
        // Claude). Re-arm instead of killing the very run the user is
        // deciding about.
        if (pendingInteractionIds.size > 0) {
          lastActivityAt = Date.now();
          return;
        }
        if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
          idleTimedOut = true;
          killCodexProcess(child, "SIGKILL");
        }
      }, IDLE_CHECK_INTERVAL_MS);
      idleWatchdog.unref?.();

      const interactions = createCodexInteractions({
        bridge,
        signal: bridgeAbort.signal,
        pendingBlockingIds: pendingInteractionIds,
        sendMessage: (targetThreadId, targetTurnId, text) =>
          rpc.request("turn/steer", {
            threadId: targetThreadId,
            expectedTurnId: targetTurnId,
            input: [{ type: "text", text }],
          }),
      });

      const updateJobs = createCodexJobTracker(() => threadId, (chunk) => queue.push(chunk));
      const drain = createCodexChildDrain();
      let rootCompletion: Record<string, unknown> | undefined;
      const finishWhenDrained = () => {
        if (!rootCompletion || drain.hasActive()) return;
        updateJobs("turn/completed", rootCompletion);
        queue.push({ type: "turn/completed", data: JSON.stringify({ ...rootCompletion, convoyRootThreadId: threadId }) });
        rootCompletion = undefined;
        queue.end();
      };
      const routeChild = createCodexChildRouter(() => threadId, (chunk) => queue.push(chunk), (method, params, source) => {
        updateJobs(method, params, source);
        drain.observe(method, params, source);
      });

      const usage = createCodexUsage();
      const pendingNotifications: Array<{ method: string; params: Record<string, unknown> }> = [];
      const onNotification = (method: string, params: Record<string, unknown>) => {
        usage.onNotification(method, params);
        if (method === "account/updated" || method === "account/rateLimits/updated") return;
        params = redactAuthParams(params, secret);
        if (method === "error" && isRecord(params.error) && typeof params.error.message === "string") {
          params = { ...params, error: { ...params.error, message: sanitizeCodexDiagnostic(params.error.message, secret) } };
        }
        if (method === "turn/completed" && isRecord(params.turn) && isRecord(params.turn.error) && typeof params.turn.error.message === "string") {
          params = { ...params, turn: { ...params.turn, error: { ...params.turn.error, message: sanitizeCodexDiagnostic(params.turn.error.message, secret) } } };
        }
        lastActivityAt = Date.now();
        debugLog(method, JSON.stringify(params));

        if (method === "serverRequest/resolved") {
          interactions.onNotification(method, params);
          return;
        }
        if (method === "thread/goal/updated" || method === "thread/goal/cleared") {
          // Child goals never drive the parent run (assumption, docs/specs/cli-thread-goal.md).
          if (!threadId || params.threadId !== threadId) return;
          if (goals.observe(method, params)) {
            queue.push({ type: method, data: JSON.stringify({ ...params, convoyRootThreadId: threadId }) });
          }
          if (continuationTimer && !goals.isActive()) finishGoalRun();
          return;
        }
        if (turnCompleted && !rootCompletion) return;
        if (method === "item/started" && isRecord(params.item)) {
          const item = params.item;
          if (item.type === "fileChange" && typeof item.id === "string") {
            fileChangesByItemId.set(
              JSON.stringify([getString(params.threadId) ?? threadId, item.id]),
              item.changes
            );
          }
        }
        if (!threadId) {
          pendingNotifications.push({ method, params });
          return;
        }
        const eventTurnId =
          getString(params.turnId) ??
          (isRecord(params.turn) ? getString(params.turn.id) : undefined);
        const eventThreadId = getString(params.threadId) ?? (isRecord(params.thread) ? getString(params.thread.id) : undefined);
        const isRoot = eventThreadId === undefined || eventThreadId === threadId;
        if (isRoot && turnCompleted) return;
        const adoptsTurn = continuationTimer !== null && method === "turn/started";
        if (isRoot && turnId && eventTurnId && eventTurnId !== turnId && !adoptsTurn) return;
        if (isRoot && (method === "turn/started" || method === "turn/completed") && !eventTurnId)
          return;
        if (
          !FORWARDED_NOTIFICATIONS.has(method) &&
          !DELTA_NOTIFICATIONS.has(method) &&
          method !== "thread/started"
        )
          return;
        if (DELTA_NOTIFICATIONS.has(method) && !partialStreaming) return;
        interactions.onNotification(method, { ...params, threadId: params.threadId ?? threadId });
        if (routeChild(method, params)) {
          finishWhenDrained();
          return;
        }
        if (method !== "turn/completed") updateJobs(method, params);

        if (DELTA_NOTIFICATIONS.has(method)) {
          queue.push({
            type: method,
            data: JSON.stringify({ ...params, convoyRootThreadId: threadId }),
          });
          return;
        }
        if (
          method === "model/rerouted" &&
          (turnId === undefined || params.turnId !== turnId || params.threadId !== threadId)
        ) {
          return;
        }

        if (method === "turn/started" && isRecord(params.turn)) {
          turnId = getString(params.turn.id) ?? turnId;
          if (isRoot) clearContinuation();
        }
        if (method === "error" && isRecord(params.error)) {
          if (params.willRetry !== true) {
            failureMessage = getString(params.error.message) ?? "Codex reported an error.";
          }
        }

        // Resume replays historical usage before turn/started. Seed the cost cursor only.
        const forwardedParams =
          method === "thread/tokenUsage/updated" && turnId === undefined
            ? { ...params, convoyUsageBaseline: true }
            : params;
        if (method !== "turn/completed") {
          queue.push({
            type: method,
            data: JSON.stringify({ ...forwardedParams, convoyRootThreadId: threadId }),
          });
        }

        if (method === "turn/completed") {
          if (isRecord(params.turn) && params.turn.status === "failed") {
            const error = isRecord(params.turn.error) ? params.turn.error : null;
            failureMessage = getString(error?.message) ?? "Codex could not complete the turn.";
          }
          turnCompleted = true;
          rootCompletion = params;
          if (failureMessage !== null || (isRecord(params.turn) && params.turn.status === "interrupted")) {
            updateJobs(method, params);
            queue.push({ type: method, data: JSON.stringify({ ...params, convoyRootThreadId: threadId }) });
            rootCompletion = undefined;
            queue.end();
          } else if (goals.isActive()) {
            awaitGoalContinuation(params);
          } else {
            finishWhenDrained();
          }
        } else if (method === "error" && failureMessage !== null) {
          // Fatal (non-retried) error: a turn/completed may never follow.
          queue.end();
        }
      };

      const rpc = createAppServerRpc(
        { stdin: child.stdin!, stdout: child.stdout! },
        {
          onNotification,
          onRequest: async (method, params, requestId) => {
            params = redactAuthParams(params, secret);
            lastActivityAt = Date.now();
            const itemId = getString(params.itemId);
            const cacheKey = JSON.stringify([getString(params.threadId) ?? threadId, itemId]);
            return interactions.onRequest(
              method, params, requestId,
              itemId ? fileChangesByItemId.get(cacheKey) : undefined
            );
          },
        }
      );

      const goals = createCodexGoals(rpc, (chunk) => queue.push(chunk));
      const clearContinuation = () => {
        if (continuationTimer) clearTimeout(continuationTimer);
        continuationTimer = null;
      };
      const finishGoalRun = () => {
        clearContinuation();
        turnCompleted = true;
        queue.end();
      };
      // Keep the run open for the next goal turn; steer, interrupt and usage follow it.
      const awaitGoalContinuation = (completion: Record<string, unknown>) => {
        updateJobs("turn/completed", completion);
        queue.push({ type: "turn/completed", data: JSON.stringify({ ...completion, convoyRootThreadId: threadId }) });
        turnCompleted = false;
        rootCompletion = undefined;
        continuationTimer = setTimeout(() => {
          const goalThreadId = threadId!;
          void goals.refresh(goalThreadId).catch(() => true).then((active) => {
            if (!continuationTimer) return;
            if (active) failureMessage = "Codex did not start the next goal turn. The goal is still active; your next message pauses it.";
            finishGoalRun();
          });
        }, goalContinuationMs);
        continuationTimer.unref?.();
      };

      const exitPromise = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("error", (error) => {
          spawnError = error;
          exited = true;
          rpc.close("codex app-server failed to start");
          queue.end();
          resolve({ code: null, signal: null });
        });
        child.once("close", (code, signal) => {
          exited = true;
          rpc.close("codex app-server exited");
          queue.end();
          resolve({ code, signal });
        });
      });
      // EPIPE guard: codex may exit while a message is being written.
      child.stdin?.on("error", () => {});

      requestInterrupt = (): void => {
        bridgeAbort.abort();
        if (threadId && turnId && !exited) {
          rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
        }
        // Interrupt leaves the goal active (C3); pause it so nothing resumes unattended.
        if (threadId && !exited && !stopPause && goals.isActive()) {
          stopPause = goals.pause(threadId, "user");
        }
      };

      // `expectedTurnId` makes codex reject the steer when the turn already
      // ended, so a false return here reliably means "left queued for the
      // next run" — the push-first/consume-after contract holds.
      const steerThisRun = async (
        injection: PreparedRuntimeExecution
      ): Promise<boolean> => {
        if (aborted || exited || turnCompleted || continuationTimer || !threadId || !turnId) {
          return false;
        }
        try {
          await rpc.request("turn/steer", {
            threadId,
            input: [{ type: "text", text: injection.prompt }],
            expectedTurnId: turnId,
          });
          return true;
        } catch {
          return false;
        }
      };
      activeSteer = steerThisRun;

      const cleanupRun = (): void => {
        clearInterval(idleWatchdog);
        clearContinuation();
        bridgeAbort.abort();
        queue.end();
        if (cleanupActiveRun === cleanupRun) {
          cleanupActiveRun = null;
        }
      };
      cleanupActiveRun = cleanupRun;

      const exitMessage = async (): Promise<string> => {
        const exit = await exitPromise;
        const detail = exit.code !== null ? `exit code ${exit.code}` : `signal ${exit.signal ?? "unknown"}`;
        const diagnostic = stderrTail();
        return `Codex app-server ended before the turn completed (${detail}).${diagnostic ? ` Stderr: ${diagnostic}` : " No diagnostic was reported."}`;
      };
      let authConfigured = false;
      try {
        await rpc.request("initialize", {
          clientInfo: {
            name: "convoy-cli",
            title: "Convoy",
            version: getCliVersion(),
          },
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized");
        if (codexProvider) await assertCodexProvider(rpc, codexProvider);
        else await authenticateCodex(rpc, codexAuth);
        if (codexAuth?.mode !== "managed" && !codexProvider && options.runtimeCommand?.command !== "usage") await checkNativeCodexAuth(rpc);
        authConfigured = true;
        if (codexAuth?.mode === "managed") emitConnectEvent({event:"auth",runtime:"codex",result:"configured"});

        if (options.runtimeCommand?.command === "usage") {
          if (options.runtimeCommand.arguments) throw new Error("/usage does not accept arguments.");
          const report = await usage.read(rpc);
          yield { type: "convoy.commands", data: JSON.stringify({ commands: discoverCodexCommands({ appServer: true }) }) };
          yield { type: "convoy.account_usage", data: JSON.stringify(report) };
          return { continuationId: options.continuationId };
        }

        const goalCommand = options.runtimeCommand?.command === "goal"
          ? parseGoalCommand(options.runtimeCommand.arguments) : undefined;
        // Only reopening a thread can meet a goal; a new thread or branch has none (F1–F3).
        const reopens = options.continuationId !== undefined && !options.forkTurnId;
        const goalDone = reopens
          ? await goals.prepareOpen(options.continuationId!, goalCommand) === "done"
          : goalCommand !== undefined && goals.answerWithoutGoal(goalCommand);
        if (goalDone) {
          yield { type: "convoy.commands", data: JSON.stringify({ commands: discoverCodexCommands({ appServer: true }) }) };
          queue.end();
          for (let chunk = await queue.next(); chunk; chunk = await queue.next()) yield chunk;
          return { continuationId: options.continuationId };
        }

        const permissions = threadPermissionsForMode(options.cliMode, sandbox !== undefined);
        // Thread identity (OS-1223) rides developerInstructions alongside the
        // agent prompt — re-passed on every thread/start and thread/resume.
        const developerInstructions = [
          options.agentPrompt,
          threadIdentityInstruction(options.threadId),
          options.workspaceNotice,
        ]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join("\n\n");
        const opened = await openThread(rpc, {
          workingDirectory,
          permissions,
          runModel: options.resolvedCliModel,
          modelProvider: codexAuth?.mode === "managed"
            ? { id: "openai", mismatch: "Managed Codex thread did not confirm the OpenAI provider." }
            : codexProvider
              ? {
                  id: CODEX_AWS_PROVIDER_IDS[codexProvider.provider],
                  mismatch: options.continuationId
                    ? `This Codex thread cannot continue on ${codexProviderLabel(codexProvider)}. Start a new thread to use it.`
                    : `Codex did not confirm ${codexProviderLabel(codexProvider)} for this thread.`,
                }
              : undefined,
          continuationId: options.continuationId,
          forkTurnId: options.forkTurnId,
          developerInstructions,
        });
        threadId = opened.threadId;
        for (const notification of pendingNotifications.splice(0)) {
          onNotification(notification.method, notification.params);
        }
        const runtimeCommand = options.runtimeCommand;
        let model = options.resolvedCliModel ?? opened.threadModel;
        // A goal set or resume starts a model turn, so it needs the mode model too.
        if ((!runtimeCommand || goalCommand) && !model) {
          if (options.continuationId) {
            throw new Error("Codex did not report the resumed thread's model. Select a model explicitly to continue.");
          }
          let catalog: unknown;
          try {
            catalog = await rpc.request("model/list", {});
          } catch (error) {
            throw new Error(`Could not resolve the Codex model: ${error instanceof Error ? error.message : String(error)}`);
          }
          const models = isRecord(catalog) && Array.isArray(catalog.data) ? catalog.data : [];
          const defaultModel = models.find((entry) => isRecord(entry) && entry.isDefault === true);
          model = isRecord(defaultModel) ? getString(defaultModel.model) : undefined;
          if (!model) {
            throw new Error("Codex did not resolve a model for the collaboration mode.");
          }
        }
        // Synthetic thread marker: continuation extraction reads this chunk
        // (the live `thread/started` notification is not forwarded).
        yield {
          type: "thread/started",
          data: JSON.stringify({
            thread: { id: threadId },
            model,
          }),
        };

        // Advertise the commands this transport can execute so the web
        // composer can autocomplete them (OS-1582). Captured server-side
        // into cliRuntimeFacts, same path as Claude's system/init.
        yield {
          type: "convoy.commands",
          data: JSON.stringify({
            commands: discoverCodexCommands({ appServer: true }),
          }),
        };

        // Runtime commands (OS-1582) run through their own RPC; codex does not interpret slash
        // text in prompts. Compaction still runs as an ordinary turn server-side, so the event
        // loop needs no special casing — but the RPC returns an empty result, so `turnId` is
        // only learned from `turn/started`.
        if (goalCommand) {
          // Codex starts the goal turn itself; a turn/start would double the work (C1, C4).
          // So mode and effort go on the thread first, for the turns the goal starts.
          await rpc.request("thread/settings/update", {
            threadId,
            ...(options.resolvedCliEffort ? { effort: options.resolvedCliEffort } : {}),
            collaborationMode: collaborationModeForRun({ cliMode: options.cliMode, model, runEffort: options.resolvedCliEffort }),
          });
          await goals.afterOpen(threadId, goalCommand);
        } else if (runtimeCommand) {
          await startCodexRuntimeCommand(rpc, threadId, runtimeCommand);
        } else {
          const turn = await rpc.request("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt }],
            ...(options.resolvedCliModel ? { model: options.resolvedCliModel } : {}),
            ...(options.resolvedCliEffort ? { effort: options.resolvedCliEffort } : {}),
            collaborationMode: collaborationModeForRun({
              cliMode: options.cliMode,
              model,
              runEffort: options.resolvedCliEffort,
            }),
          });
          if (isRecord(turn) && isRecord(turn.turn)) {
            turnId = getString(turn.turn.id) ?? turnId;
          }
        }

        for (;;) {
          const chunk = await queue.next();
          if (chunk === null) {
            break;
          }
          yield chunk;
        }

        if (aborted) {
          throw new RunnerExecutionError("Codex run aborted", { continuationId: threadId, turnId });
        }
        if (idleTimedOut) {
          throw new RunnerExecutionError(
            `Codex produced no output for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes and was terminated.`,
            { continuationId: threadId, turnId }
          );
        }
        if (failureMessage !== null) {
          throw new RunnerExecutionError(failureMessage, { continuationId: threadId, turnId });
        }
        if (!turnCompleted || rootCompletion) {
          throw new RunnerExecutionError(await exitMessage(), { continuationId: threadId, turnId });
        }

        if (codexAuth?.mode === "managed" && !options.runtimeCommand) emitConnectEvent({event:"auth",runtime:"codex",result:"request-succeeded"});
        return { continuationId: threadId, turnId };
      } catch (error) {
        if (aborted) throw new RunnerExecutionError("Codex run aborted", { continuationId: threadId, turnId });
        if (idleTimedOut) throw new RunnerExecutionError(
          `Codex produced no output for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes and was terminated.`,
          { continuationId: threadId, turnId }
        );
        const message = spawnError
          ? (spawnError as Error).message
          : exited && !(error instanceof RunnerExecutionError) && !failureMessage
            ? await exitMessage()
            : error instanceof Error ? error.message : String(error);
        const safeMessage = formatCodexFailure(message, codexAuth, codexProvider);
        if (codexAuth?.mode === "managed") {
          const message = safeMessage;
          const result = !authConfigured ? "setup-failed" : /\b(?:401|403)\b|unauthorized|invalid.api.key/i.test(message) ? "authentication-failed"
            : /\b429\b|quota|rate.limit/i.test(message) ? "quota-or-rate-limit" : /ENOTFOUND|ECONN|network|fetch failed/i.test(message) ? "network-failed" : "request-failed";
          emitConnectEvent({event:"auth",runtime:"codex",result});
        }
        throw new RunnerExecutionError(safeMessage, {
          continuationId: error instanceof RunnerExecutionError ? error.continuationId ?? threadId : threadId,
          turnId,
          launchFailed: Boolean(spawnError) || (error instanceof RunnerExecutionError && error.launchFailed),
        });
      } finally {
        cleanupRun();
        // Set by requestInterrupt; TS cannot see the closure write.
        const pendingPause = stopPause as Promise<boolean> | null;
        if (pendingPause) {
          let timer: NodeJS.Timeout | undefined;
          const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), STOP_GOAL_PAUSE_MS); });
          stopReport = { goalPaused: await Promise.race([pendingPause, timeout]) };
          clearTimeout(timer);
        }
        rpc.close("run finished");
        for (const requestId of pendingInteractionIds) {
          bridge?.cancel(requestId, { abandoned: true, reason: "run ended" });
        }
        pendingInteractionIds.clear();
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        if (child.exitCode === null && child.signalCode === null) {
          killCodexProcess(child, "SIGKILL");
        }
        if (activeChild === child) {
          activeChild = null;
          requestInterrupt = null;
        }
        if (activeSteer === steerThisRun) {
          activeSteer = null;
        }
      }
    },

    steer(injection: PreparedRuntimeExecution): Promise<boolean> {
      const steerFn = activeSteer;
      return steerFn ? steerFn(injection) : Promise.resolve(false);
    },

    abort,

    stopReport: () => stopReport,

    async shutdown(): Promise<void> {
      abort();
      await runtimeExited;
    },
  };
}
