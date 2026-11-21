import { spawn, type ChildProcess } from "node:child_process";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import { ENV_THREAD_ID } from "../../../lib/constants.js";
import { withoutClaudeProviderEnv } from "../../../lib/config/provider-keys.js";
import {
  RunnerExecutionError,
  type CliRuntimeRunner,
  type ContentChunk,
  type RunnerExecutionOptions,
  type RunnerExecutionResult,
} from "../contracts.js";
import { getDebugLevel } from "../debug.js";
import { threadIdentityInstruction } from "../agent-instructions.js";
import { ACP_AUTH_REQUIRED_CODE, createAcpClient, type AcpClient } from "../acp/client.js";
import { JsonRpcError } from "../json-rpc.js";
import { resolveAntigravityExecutablePath } from "./detect.js";
import { createAntigravityInteractions } from "./interactions.js";
import { compactToolUpdate } from "./streaming.js";

/** One `agy acp` process per run. Spec: docs/specs/cli-antigravity-runtime.md. */

/** No ACP traffic for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const ABORT_FORCE_KILL_MS = 5_000;
const STDERR_TAIL_LINES = 12;

export const ANTIGRAVITY_SIGN_IN_MESSAGE =
  "Antigravity is not signed in on this machine. Run `agy` in a terminal and sign in, then send the message again.";

/** Updates later slices consume (slash commands, context meter, title, modes, models). */
const UNFORWARDED_UPDATES = new Set([
  "available_commands_update",
  "usage_update",
  "session_info_update",
  "current_mode_update",
  "config_option_update",
]);

function debugLog(kind: string, payload: string): void {
  if (getDebugLevel() >= 1) console.log(`[Antigravity:${kind}] ${payload.slice(0, 400)}`);
}

/** agy runs as a launcher around a native binary; signal the whole group. */
function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group already gone; fall through.
    }
  }
  child.kill(signal);
}

export function buildAntigravitySubprocessEnv(threadId: string): NodeJS.ProcessEnv {
  const env = withoutClaudeProviderEnv(process.env);
  delete env.CONVOY_API_KEY;
  env[ENV_THREAD_ID] = threadId;
  env.AGY_CLI_DISABLE_AUTO_UPDATE = "1";
  return env;
}

function systemAppend(options: RunnerExecutionOptions): string {
  return [options.agentPrompt, threadIdentityInstruction(options.threadId), options.workspaceNotice]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
}

/** Opens or resumes the run's session; signed out, it tries `oauth-personal` once. */
async function openSession(
  acp: AcpClient,
  workingDirectory: string,
  options: RunnerExecutionOptions,
  meta: Record<string, unknown> | undefined
): Promise<string> {
  const open = async () => {
    if (!options.continuationId) return (await acp.newSession({ cwd: workingDirectory, _meta: meta })).sessionId;
    await acp.resumeSession({ sessionId: options.continuationId, cwd: workingDirectory, _meta: meta });
    return options.continuationId;
  };
  try {
    return await open();
  } catch (error) {
    if (!(error instanceof JsonRpcError) || error.code !== ACP_AUTH_REQUIRED_CODE) throw error;
  }
  try {
    await acp.authenticate("oauth-personal");
    return await open();
  } catch {
    throw new RunnerExecutionError(ANTIGRAVITY_SIGN_IN_MESSAGE, { continuationId: options.continuationId });
  }
}

export function createAntigravityRunner(factoryOptions: { partialStreaming?: boolean }): CliRuntimeRunner {
  const partialStreaming = factoryOptions.partialStreaming ?? false;
  let aborted = false;
  let activeChild: ChildProcess | null = null;
  let exited: Promise<void> = Promise.resolve();
  let cancelActive: (() => void) | null = null;
  let abandonInteractions: (() => void) | null = null;
  let forceKillTimer: NodeJS.Timeout | null = null;

  const abort = (): void => {
    aborted = true;
    // Before session/cancel, so the prompt's end cannot withdraw them first.
    abandonInteractions?.();
    cancelActive?.();
    const child = activeChild;
    if (!child || child.exitCode !== null || child.signalCode !== null || forceKillTimer) return;
    forceKillTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), ABORT_FORCE_KILL_MS);
    forceKillTimer.unref();
  };

  return {
    async *execute(
      workingDirectory: string,
      prompt: string,
      options: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      aborted = false;
      const executable = await resolveAntigravityExecutablePath();
      // Ask to approve is agy's own `default` session mode; Act is the spawn flag.
      const args = options.cliMode === "default" ? ["acp"] : ["acp", "--dangerously-skip-permissions"];
      const child = spawn(executable.command, args, {
        cwd: workingDirectory,
        env: buildAntigravitySubprocessEnv(options.threadId),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      activeChild = child;
      exited = new Promise((resolve) => {
        child.once("close", () => resolve());
        child.once("error", () => resolve());
      });

      const stderrTail: string[] = [];
      child.stderr?.setEncoding("utf8").on("data", (data: string) => {
        for (const line of data.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
          debugLog("stderr", line);
          stderrTail.push(line.slice(0, 512));
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        }
      });
      child.stdin?.on("error", () => {});

      const chunks: ContentChunk[] = [];
      let done = false;
      let wake: (() => void) | null = null;
      const push = (chunk: ContentChunk) => {
        chunks.push(chunk);
        wake?.();
      };
      const finish = () => {
        done = true;
        wake?.();
      };

      let sessionId = options.continuationId;
      let segment: { type: "convoy/acp_text" | "convoy/acp_reasoning"; text: string } | null = null;
      const closeSegment = () => {
        if (segment && segment.text.length > 0) push({ type: segment.type, data: JSON.stringify({ sessionId, text: segment.text }) });
        segment = null;
      };
      let lastActivityAt = Date.now();
      let idleTimedOut = false;
      let failure: string | null = null;
      const bridgeAbort = new AbortController();
      abandonInteractions = () => bridgeAbort.abort();
      const interactions = createAntigravityInteractions({ bridge: options.interactionBridge, signal: bridgeAbort.signal });

      const acp = createAcpClient(
        { stdin: child.stdin!, stdout: child.stdout! },
        {
          onSessionUpdate(params) {
            lastActivityAt = Date.now();
            debugLog("update", JSON.stringify(params));
            const update = isRecord(params.update) ? params.update : {};
            const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
            if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
              const type = kind === "agent_message_chunk" ? "convoy/acp_text" : "convoy/acp_reasoning";
              const content = isRecord(update.content) ? update.content : {};
              if (segment?.type !== type) {
                closeSegment();
                segment = { type, text: "" };
              }
              segment.text += typeof content.text === "string" ? content.text : "";
              if (partialStreaming) push({ type: "session/update", data: JSON.stringify(params) });
              return;
            }
            if (UNFORWARDED_UPDATES.has(kind)) return;
            closeSegment();
            const forwarded = kind === "tool_call" || kind === "tool_call_update" ? compactToolUpdate(update) : update;
            push({ type: "session/update", data: JSON.stringify({ ...params, update: forwarded }) });
          },
          onRequestPermission(request) {
            lastActivityAt = Date.now();
            return interactions.onRequestPermission(request);
          },
        },
        "Antigravity"
      );

      child.once("error", (error) => {
        failure = error.message;
        acp.close(error.message);
        finish();
      });
      child.once("close", (code, signal) => {
        acp.close("agy exited");
        failure ??= `agy acp exited before the turn completed (${code !== null ? `exit code ${code}` : `signal ${signal ?? "unknown"}`}).${
          stderrTail.length > 0 ? ` Stderr: ${stderrTail.join(" | ")}` : ""
        }`;
        finish();
      });

      const idleWatchdog = setInterval(() => {
        // A run parked on a card is waiting for the user, not idle (OS-1463).
        if (interactions.pendingCount() > 0) lastActivityAt = Date.now();
        if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
          idleTimedOut = true;
          killProcessGroup(child, "SIGKILL");
        }
      }, IDLE_CHECK_INTERVAL_MS);
      idleWatchdog.unref();

      const fail = (message: string) =>
        new RunnerExecutionError(message, { continuationId: sessionId, launchFailed: child.pid === undefined });

      try {
        const initialized = await acp.initialize({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
        const append = systemAppend(options);
        const meta = isRecord(initialized.agentCapabilities?._meta) ? initialized.agentCapabilities._meta : {};
        const canAppend = isRecord(meta.antigravity) && isRecord(meta.antigravity.systemPrompt) && meta.antigravity.systemPrompt.append === true;
        sessionId = await openSession(acp, workingDirectory, options, canAppend ? { antigravity: { systemPrompt: { append } } } : undefined);
        yield {
          type: "convoy/acp_session",
          data: JSON.stringify({ sessionId, agentVersion: initialized.agentInfo?.version ?? null }),
        };

        if (aborted) throw fail("Antigravity run aborted");
        const openedSession = sessionId;
        cancelActive = () => acp.cancel(openedSession);
        interactions.startPrompt();
        acp.prompt(openedSession, canAppend ? prompt : `${append}\n\n${prompt}`).then(
          (result) => {
            interactions.endPrompt();
            closeSegment();
            push({ type: "convoy/acp_prompt_result", data: JSON.stringify({ sessionId, ...result }) });
            failure = null;
            finish();
          },
          (error: unknown) => {
            // A failed prompt fails the run: abandon open requests, don't withdraw them.
            bridgeAbort.abort();
            interactions.endPrompt();
            closeSegment();
            failure ??= error instanceof Error ? error.message : String(error);
            finish();
          }
        );

        for (;;) {
          const chunk = chunks.shift();
          if (chunk) {
            yield chunk;
            continue;
          }
          if (done) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }

        if (aborted) throw fail("Antigravity run aborted");
        if (idleTimedOut) throw fail(`Antigravity produced no output for ${IDLE_TIMEOUT_MS / 60_000} minutes and was terminated.`);
        if (failure !== null) throw fail(failure);
        return { continuationId: sessionId };
      } catch (error) {
        if (error instanceof RunnerExecutionError) throw error;
        if (aborted) throw fail("Antigravity run aborted");
        throw fail(failure ?? (error instanceof Error ? error.message : String(error)));
      } finally {
        clearInterval(idleWatchdog);
        bridgeAbort.abort();
        abandonInteractions = null;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        forceKillTimer = null;
        cancelActive = null;
        acp.close("run finished");
        if (child.exitCode === null && child.signalCode === null) killProcessGroup(child, "SIGKILL");
        if (activeChild === child) activeChild = null;
      }
    },

    abort,

    async shutdown(): Promise<void> {
      abort();
      await exited;
    },
  };
}
