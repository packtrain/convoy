import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveExecutable } from "../../sdk/adapters/executable-resolution.js";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import {
  RunnerExecutionError,
  type CliMode,
  type CliRuntimeRunner,
  type ContentChunk,
  type RunnerExecutionOptions,
  type RunnerExecutionResult,
} from "../contracts.js";
import { withFirstMessageAgentInstructions } from "../agent-instructions.js";
import { getDebugLevel } from "../debug.js";
import { ENV_THREAD_ID } from "../../../lib/constants.js";
import type { CursorAuth } from "../../../lib/config/credentials/validators.js";
import { discoverCursorCommands } from "./commands.js";
import { supportsTrustFlag, unsupportedManagedKeyVersion } from "./detect.js";
import { resolveCursorModelName } from "./models.js";

/** Env var override for the cursor-agent executable path. */
export const CURSOR_EXECUTABLE_ENV = "CONVOY_CURSOR_EXECUTABLE";

/** cursor-agent's stderr line when the machine is not logged in. */
const CURSOR_AUTH_REQUIRED_MARKER = "Authentication required";
/** cursor-agent's stdout line when CURSOR_API_KEY is refused. */
const CURSOR_KEY_REJECTED_MARKER = "The provided API key is invalid";

/** No JSONL output for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const ABORT_FORCE_KILL_MS = 5_000;

/**
 * Build the `cursor-agent` argument list. Print mode is non-interactive and has no
 * sandbox; the only permission knob is `--force`:
 * - `agent` (and unset) auto-allows everything (`--force`)
 * - every other mode follows the machine's Cursor permission config, with `--trust` when
 *   the installed binary supports it (newer builds require it non-interactively).
 */
export function buildCursorAgentArgs(options: {
  cliMode?: CliMode;
  runModel?: string;
  runEffort?: string;
  continuationId?: string;
  trustFlagSupported: boolean;
}): string[] {
  const args = ["-p", "--output-format=stream-json"];

  if (options.cliMode === undefined || options.cliMode === "agent") {
    args.push("--force");
  } else if (options.trustFlagSupported) {
    args.push("--trust");
  }

  if (options.runModel) {
    args.push(
      "--model",
      resolveCursorModelName(options.runModel, options.runEffort),
    );
  }

  if (options.continuationId) {
    args.push("--resume", options.continuationId);
  }

  return args;
}

/**
 * Chat id from a parsed stream event. `system` is skipped deliberately: it
 * can fire before the session is initialized, so its `session_id` may be
 * missing or stale (matches the web normalizer's continuation rule).
 */
export function extractCursorSessionId(value: unknown): string | null {
  if (!isRecord(value) || value.type === "system") {
    return null;
  }
  return typeof value.session_id === "string" && value.session_id.length > 0
    ? value.session_id
    : null;
}

export async function resolveCursorExecutablePath(): Promise<{
  command: string;
  source: string;
}> {
  const configured = process.env[CURSOR_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("cursor", {
    ...(configured ? { executablePath: configured } : {}),
  });
}

export function buildCursorSubprocessEnv(threadId: string, auth?: CursorAuth): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The API key must never leak into the agent subprocess environment.
  delete env.CONVOY_API_KEY;
  if (auth?.mode === "managed") {
    // Only the key authenticates, against Cursor's own API, and stays out of the project HOME (OS-2017).
    for (const key of Object.keys(env)) if (key.startsWith("CURSOR_") || key.startsWith("AGENT_CLI_")) delete env[key];
    env.CURSOR_API_KEY = auth.secret;
    env.AGENT_CLI_CREDENTIAL_STORE = "memory";
  }
  // Thread identity (OS-1223).
  env[ENV_THREAD_ID] = threadId;
  return env;
}

const isWindows = process.platform === "win32";

/**
 * The cursor-agent install wraps a native binary in a launcher; killing only
 * the wrapper (especially with SIGKILL, which it cannot forward) orphans the
 * native process. Signal the whole process group instead.
 */
export function killCursorProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (!isWindows && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group may already be gone; fall through to a direct kill.
    }
  }
  child.kill(signal);
}

function debugLog(kind: string, payload: string): void {
  if (getDebugLevel() < 1) {
    return;
  }
  console.log(`[Cursor:${kind}] ${payload.slice(0, 400)}`);
}

function formatErrorTail(errorTail: string[]): string {
  return errorTail.length > 0 ? ` Output: ${errorTail.join(" | ")}` : "";
}

function isAuthRequired(errorTail: string[]): boolean {
  return errorTail.some((line) => line.includes(CURSOR_AUTH_REQUIRED_MARKER));
}

export interface CursorRunnerOptions {
  /** Managed Cursor key from the project launcher (OS-2017). */
  cursorAuth?: CursorAuth;
}

export function createCursorRunner(runnerOptions?: CursorRunnerOptions): CliRuntimeRunner {
  const cursorAuth = runnerOptions?.cursorAuth;
  let activeChild: ChildProcess | null = null;
  let aborted = false;
  let forceKillTimer: NodeJS.Timeout | null = null;
  // The processor may abandon the generator mid-yield after an unrelated
  // error, so abort() must also run the per-run cleanup (watchdog, reader)
  // that the generator's own finally would otherwise handle.
  let cleanupActiveRun: (() => void) | null = null;

  const abort = (): void => {
    aborted = true;
    cleanupActiveRun?.();
    const child = activeChild;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    killCursorProcess(child, "SIGTERM");
    forceKillTimer = setTimeout(() => {
      killCursorProcess(child, "SIGKILL");
    }, ABORT_FORCE_KILL_MS);
    forceKillTimer.unref?.();
  };

  return {
    async *execute(
      workingDirectory: string,
      prompt: string,
      options: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      aborted = false;
      if (cursorAuth?.mode === "disabled") {
        throw new RunnerExecutionError("Cursor is disabled for this project. Assign a key or explicitly restore native login.", { continuationId: options.continuationId });
      }
      const unsupported = cursorAuth ? await unsupportedManagedKeyVersion() : undefined;
      if (unsupported) {
        throw new RunnerExecutionError(
          `Cursor Agent ${unsupported} is not tested with managed keys. Install 2026.10.22-27dcf5f root-owned (https://docs.convoy.build/docs/cli/isolated-projects#install-cursor), then reload the project.`,
          { continuationId: options.continuationId }
        );
      }
      const executable = await resolveCursorExecutablePath();
      // Only guarded modes use --trust, so skip the --help probe otherwise.
      const isForceMode =
        options.cliMode === undefined || options.cliMode === "agent";
      const args = buildCursorAgentArgs({
        cliMode: options.cliMode,
        runModel: options.resolvedCliModel,
        runEffort: options.resolvedCliEffort,
        continuationId: options.continuationId,
        trustFlagSupported: isForceMode ? false : await supportsTrustFlag(),
      });
      debugLog("spawn", `${executable.command} ${args.join(" ")}`);

      // Advertise the directory's slash-command inventory so the web
      // composer can autocomplete them (fail-soft; empty list is skipped).
      const commands = await discoverCursorCommands(workingDirectory);


      const child = spawn(executable.command, args, {
        cwd: workingDirectory,
        env: buildCursorSubprocessEnv(options.threadId, cursorAuth),
        stdio: ["pipe", "pipe", "pipe"],
        // Own process group so aborts can kill the wrapper and the native
        // binary together (see killCursorProcess).
        detached: !isWindows,
      });
      activeChild = child;
      const spawned = new Promise<boolean>((resolve) => {
        child.once("spawn", () => resolve(true));
        child.once("error", () => resolve(false));
      });

      // Cursor reports some fatal errors as plain text on STDOUT (e.g.
      // "ActionRequiredError: Named models unavailable...") with an empty
      // stderr, so non-JSON stdout lines feed the same error tail.
      const errorTail: string[] = [];
      const pushErrorTail = (line: string): void => {
        errorTail.push(line);
        if (errorTail.length > 12) {
          errorTail.shift();
        }
      };
      if (child.stderr) {
        createInterface({ input: child.stderr }).on("line", (line) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }
          debugLog("stderr", trimmed);
          pushErrorTail(trimmed);
        });
      }

      let spawnError: Error | null = null;
      const exitPromise = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("error", (error) => {
          spawnError = error;
          resolve({ code: null, signal: null });
        });
        child.once("close", (code, signal) => resolve({ code, signal }));
      });

      // EPIPE guard: cursor-agent may exit before consuming the whole prompt.
      child.stdin?.on("error", () => {});
      // First-message agent prompt delivery: fresh sessions only (print mode
      // has no system-prompt flag; rules files would mutate the checkout).
      child.stdin?.end(withFirstMessageAgentInstructions(prompt, options));

      let continuationId = options.continuationId;
      let lastOutputAt = Date.now();
      let idleTimedOut = false;
      const idleWatchdog = setInterval(() => {
        if (Date.now() - lastOutputAt > IDLE_TIMEOUT_MS) {
          idleTimedOut = true;
          killCursorProcess(child, "SIGKILL");
        }
      }, IDLE_CHECK_INTERVAL_MS);
      idleWatchdog.unref?.();

      const stdoutLines = child.stdout
        ? createInterface({ input: child.stdout })
        : null;

      const cleanupRun = (): void => {
        clearInterval(idleWatchdog);
        stdoutLines?.close();
        if (cleanupActiveRun === cleanupRun) {
          cleanupActiveRun = null;
        }
      };
      cleanupActiveRun = cleanupRun;

      try {
        if (!(await spawned)) {
          throw new RunnerExecutionError(`Failed to run cursor-agent: ${spawnError}`, {
            continuationId, launchFailed: !aborted,
          });
        }
      if (commands.length > 0) {
        yield {
          type: "convoy.commands",
          data: JSON.stringify({ commands }),
        };
      }
        if (stdoutLines) {
          for await (const line of stdoutLines) {
            lastOutputAt = Date.now();
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(trimmed) as unknown;
            } catch {
              // Plain lines are dropped from the stream but kept for the
              // error tail — fatal errors can arrive here (see above).
              debugLog("skip", trimmed);
              pushErrorTail(trimmed);
              continue;
            }

            const type =
              isRecord(parsed) && typeof parsed.type === "string"
                ? parsed.type
                : "unknown";
            const sessionId = extractCursorSessionId(parsed);
            if (sessionId) {
              continuationId = sessionId;
            }

            debugLog(type, trimmed);
            yield { type, data: trimmed };
          }
        }

        const exit = await exitPromise;

        if (spawnError) {
          const message = (spawnError as Error).message;
          throw new RunnerExecutionError(
            `Failed to run cursor-agent: ${message}`,
            { continuationId, launchFailed: child.pid === undefined }
          );
        }
        if (aborted) {
          throw new RunnerExecutionError("Cursor run aborted", {
            continuationId,
          });
        }
        if (idleTimedOut) {
          throw new RunnerExecutionError(
            `Cursor produced no output for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes and was terminated.`,
            { continuationId }
          );
        }
        if (exit.code !== 0) {
          if (cursorAuth && errorTail.some((line) => line.includes(CURSOR_KEY_REJECTED_MARKER))) {
            throw new RunnerExecutionError(
              "Cursor rejected the assigned account key. Rotate it, or unassign it and restore native login.",
              { continuationId }
            );
          }
          if (isAuthRequired(errorTail)) {
            throw new RunnerExecutionError(
              "Cursor Agent is not authenticated on this machine. Run 'cursor-agent login' or set CURSOR_API_KEY.",
              { continuationId }
            );
          }
          const exitDetail =
            exit.code !== null
              ? `exit code ${exit.code}`
              : `signal ${exit.signal ?? "unknown"}`;
          throw new RunnerExecutionError(
            `Cursor exited with ${exitDetail}.${formatErrorTail(errorTail)}`,
            { continuationId }
          );
        }
        if (!continuationId && options.requireContinuation) {
          throw new RunnerExecutionError(
            "Cursor run completed without a session_id in stream-json output"
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
        throw new RunnerExecutionError(
          error instanceof Error ? error.message : String(error),
          { continuationId }
        );
      } finally {
        cleanupRun();
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        if (child.exitCode === null && child.signalCode === null) {
          killCursorProcess(child, "SIGKILL");
        }
        if (activeChild === child) {
          activeChild = null;
        }
      }
    },

    abort,

    async shutdown(): Promise<void> {
      abort();
    },
  };
}
