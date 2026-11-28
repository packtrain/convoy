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
  type RunnerSandboxOptions,
} from "../contracts.js";
import { getDebugLevel } from "../debug.js";
import { withFirstMessageAgentInstructions } from "../agent-instructions.js";
import { ENV_THREAD_ID } from "../../../lib/constants.js";
import { withoutClaudeProviderEnv } from "../../../lib/config/provider-keys.js";

/** Env var override for the Codex executable path. */
export const CODEX_EXECUTABLE_ENV = "CONVOY_CODEX_EXECUTABLE";

/** No JSONL output for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const ABORT_FORCE_KILL_MS = 5_000;

/**
 * Build the `codex exec` argument list. Codex exec is non-interactive, so the OS sandbox
 * is the safety knob instead of approval prompts:
 * - `agent` (and unset) matches Claude's bypassPermissions trust level
 * - every other mode runs sandboxed with workspace writes and never asks
 * - isolation (OS-1242) removes the bypass: every mode is `workspace-write` with the
 *   profile paths as extra writable roots
 */
export function buildCodexExecArgs(options: {
  cliMode?: CliMode;
  runModel?: string;
  runEffort?: string;
  continuationId?: string;
  sandbox?: RunnerSandboxOptions;
  additionalDirectories?: string[];
}): string[] {
  const args = ["exec", "--json", "--skip-git-repo-check"];

  if (options.sandbox) {
    args.push("--sandbox", "workspace-write");
    args.push(...codexWritableRootsConfigArgs(options.sandbox));
  } else if (options.cliMode === undefined || options.cliMode === "agent") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", "workspace-write");
    args.push(...codexAdditionalRootsConfigArgs(options.additionalDirectories));
  }

  if (options.runModel) {
    args.push("--model", options.runModel);
  }

  if (options.runEffort) {
    args.push("-c", `model_reasoning_effort="${options.runEffort}"`);
  }

  if (options.continuationId) {
    args.push("resume", options.continuationId);
  }

  // `-` reads the prompt from stdin, avoiding argv length limits.
  args.push("-");
  return args;
}

/**
* Profile paths as Codex writable roots (OS-1242). `JSON.stringify` output is valid TOML
* inline-array syntax for `-c` overrides. Codex workspace-write also allows `/tmp`, excluded on
* macOS so the boundary matches the docs. ponytail: darwin-only — on Linux /tmp is often the
* only temp dir and excluding it breaks builds.
*
* `approvals_reviewer="user"` is load-bearing: apply_patch runs outside the OS sandbox, gated
* only by patch-safety approval, and a user-config `auto_review` would let out-of-root patches
* through even under `--sandbox read-only` (verified on codex-cli 0.144.4).
*/
export function codexWritableRootsConfigArgs(
  sandbox: RunnerSandboxOptions,
  platform: NodeJS.Platform = process.platform
): string[] {
  return [
    "-c",
    `sandbox_workspace_write.writable_roots=${JSON.stringify(sandbox.writableRoots)}`,
    ...(platform === "darwin" ? ["-c", "sandbox_workspace_write.exclude_slash_tmp=true"] : []),
    "-c",
    'approvals_reviewer="user"',
  ];
}

/** A repo thread's project folder as a writable root when not isolated; isolation's roots already hold it. */
export function codexAdditionalRootsConfigArgs(additionalDirectories: string[] | undefined): string[] {
  return additionalDirectories?.length ? ["-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(additionalDirectories)}`] : [];
}

/** Thread id from a parsed `thread.started` event, if present. */
export function extractCodexContinuationId(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "thread.started") {
    return null;
  }
  return typeof value.thread_id === "string" && value.thread_id.length > 0
    ? value.thread_id
    : null;
}

export async function resolveCodexExecutablePath(): Promise<{
  command: string;
  source: string;
}> {
  const configured = process.env[CODEX_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("codex", {
    ...(configured ? { executablePath: configured } : {}),
  });
}

export function buildCodexSubprocessEnv(threadId: string): NodeJS.ProcessEnv {
  // Claude's provider key is not Codex's (OS-2105).
  const env = withoutClaudeProviderEnv(process.env);
  // The API key must never leak into the agent subprocess environment.
  delete env.CONVOY_API_KEY;
  // Thread identity (OS-1223).
  env[ENV_THREAD_ID] = threadId;
  return env;
}

const isWindows = process.platform === "win32";

/**
 * npm installs wrap the native codex binary in a JS launcher; killing only
 * the wrapper (especially with SIGKILL, which it cannot forward) orphans
 * the native process. Signal the whole process group instead.
 */
export function killCodexProcess(child: ChildProcess, signal: NodeJS.Signals): void {
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
  console.log(`[Codex:${kind}] ${payload.slice(0, 400)}`);
}

function formatStderrTail(stderrTail: string[]): string {
  return stderrTail.length > 0 ? ` Stderr: ${stderrTail.join(" | ")}` : "";
}

export function createCodexRunner(runnerOptions?: {
  sandbox?: RunnerSandboxOptions;
}): CliRuntimeRunner {
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
    killCodexProcess(child, "SIGTERM");
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
      aborted = false;
      // A branch must fork its parent's session, which only the app-server transport can (OS-2073).
      // No continuation on the error: the failed reply must not claim the parent's session as its own.
      if (options.forkTurnId) {
        throw new RunnerExecutionError(
          "Continuing a branched Codex thread requires the codex app-server transport. " +
            "Reconnect the agent without `--codex-exec` to use it."
        );
      }
      // The exec transport has no per-thread RPC channel, so it cannot run
      // runtime commands (OS-1582). Fail visibly instead of sending "/compact"
      // as prose, which the model answers as though it had compacted.
      if (options.runtimeCommand) {
        throw new RunnerExecutionError(
          `Running "/${options.runtimeCommand.command}" requires the codex app-server transport. ` +
            "Reconnect the agent without `--codex-exec` to use it.",
          { continuationId: options.continuationId }
        );
      }
      const executable = await resolveCodexExecutablePath();
      const args = buildCodexExecArgs({
        cliMode: options.cliMode,
        runModel: options.resolvedCliModel,
        runEffort: options.resolvedCliEffort,
        continuationId: options.continuationId,
        sandbox: runnerOptions?.sandbox,
        additionalDirectories: options.additionalDirectories,
      });
      debugLog("spawn", `${executable.command} ${args.join(" ")}`);

      const child = spawn(executable.command, args, {
        cwd: workingDirectory,
        env: buildCodexSubprocessEnv(options.threadId),
        stdio: ["pipe", "pipe", "pipe"],
        // Own process group so aborts can kill the wrapper and the native
        // binary together (see killCodexProcess).
        detached: !isWindows,
      });
      activeChild = child;

      const stderrTail: string[] = [];
      if (child.stderr) {
        createInterface({ input: child.stderr }).on("line", (line) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return;
          }
          debugLog("stderr", trimmed);
          stderrTail.push(trimmed);
          if (stderrTail.length > 12) {
            stderrTail.shift();
          }
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

      // EPIPE guard: codex may exit before consuming the whole prompt.
      child.stdin?.on("error", () => {});
      // codex exec has no per-thread RPC channel for developerInstructions
      // (unlike the app-server transport), so the agent prompt falls back to
      // first-message delivery like opencode/cursor.
      child.stdin?.end(withFirstMessageAgentInstructions(prompt, options));

      let continuationId = options.continuationId;
      let lastOutputAt = Date.now();
      let idleTimedOut = false;
      const idleWatchdog = setInterval(() => {
        if (Date.now() - lastOutputAt > IDLE_TIMEOUT_MS) {
          idleTimedOut = true;
          killCodexProcess(child, "SIGKILL");
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
              // codex --json keeps stdout JSONL-only; drop stray plain lines.
              debugLog("skip", trimmed);
              continue;
            }

            const type =
              isRecord(parsed) && typeof parsed.type === "string"
                ? parsed.type
                : "unknown";
            const nextContinuation = extractCodexContinuationId(parsed);
            if (nextContinuation) {
              continuationId = nextContinuation;
            }

            debugLog(type, trimmed);
            yield { type, data: trimmed };
          }
        }

        const exit = await exitPromise;

        if (spawnError) {
          const message = (spawnError as Error).message;
          throw new RunnerExecutionError(`Failed to run codex: ${message}`, {
            continuationId,
            launchFailed: child.pid === undefined,
          });
        }
        if (aborted) {
          throw new RunnerExecutionError("Codex run aborted", {
            continuationId,
          });
        }
        if (idleTimedOut) {
          throw new RunnerExecutionError(
            `Codex produced no output for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes and was terminated.`,
            { continuationId }
          );
        }
        if (exit.code !== 0) {
          const exitDetail =
            exit.code !== null
              ? `exit code ${exit.code}`
              : `signal ${exit.signal ?? "unknown"}`;
          throw new RunnerExecutionError(
            `Codex exited with ${exitDetail}.${formatStderrTail(stderrTail)}`,
            { continuationId }
          );
        }
        if (!continuationId && options.requireContinuation) {
          throw new RunnerExecutionError(
            "Codex run completed without thread.started thread_id in JSONL output"
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
          killCodexProcess(child, "SIGKILL");
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
