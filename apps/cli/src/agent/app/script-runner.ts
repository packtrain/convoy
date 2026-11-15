import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import type { Readable } from "node:stream";
import { killProcessGroup } from "../sdk/runtime/process-group.js";
import {
  RunnerExecutionError,
  type CliRuntimeRunner,
  type ContentChunk,
  type RunnerExecutionOptions,
  type RunnerExecutionResult,
  type ScriptResult,
} from "../runtimes/contracts.js";

/** Runtime-agnostic transcript chunk for script output; the web renders it as text. */
export const SCRIPT_OUTPUT_CHUNK_TYPE = "convoy_script_output";
/** Mirrors `SCRIPT_OUTPUT_TAIL_MAX_CHARS` server-side, which clamps again on write. */
export const SCRIPT_OUTPUT_TAIL_MAX_CHARS = 8_000;

const TERMINATE_GRACE_MS = 5_000;
const FORCE_KILL_GRACE_MS = 2_000;
// After `exit`, how long to wait for stdio to close before giving up on a
// grandchild that still holds the pipe.
const EXIT_DRAIN_GRACE_MS = 2_000;

export interface ScriptRunnerOptions {
  spawnImpl?: (script: string, cwd: string) => ChildProcess;
}

function defaultSpawn(script: string, cwd: string): ChildProcess {
  return spawn("bash", ["-c", script], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so a timeout or Stop takes the script's children too.
    detached: process.platform !== "win32",
  });
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/** Keep the last `max` chars, never starting on the low half of a surrogate pair. */
export function appendTail(tail: string, data: string, max = SCRIPT_OUTPUT_TAIL_MAX_CHARS): string {
  const joined = tail + data;
  if (joined.length <= max) {
    return joined;
  }
  let start = joined.length - max;
  const code = joined.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) {
    start += 1;
  }
  return joined.slice(start);
}

/**
 * Runs a Workflow Bash step's script (OS-1886) in place of an agent runtime:
 * `bash -c` in the run's working directory, stdout/stderr streamed as
 * transcript chunks, killed at the step's timeout or on Stop. Never touches
 * the thread's agent session — the run engine decides what the agent hears.
 */
export function createScriptRunner(options: ScriptRunnerOptions = {}): CliRuntimeRunner {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  let active: ChildProcess | null = null;

  const kill = (child: ChildProcess) => killProcessGroup(child, { terminateGraceMs: TERMINATE_GRACE_MS, forceKillGraceMs: FORCE_KILL_GRACE_MS });

  return {
    async *execute(
      workingDirectory: string,
      _prompt: string,
      runOptions: RunnerExecutionOptions
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      const request = runOptions.scriptRequest;
      if (!request) {
        throw new RunnerExecutionError("Script runner needs a script request");
      }

      const queue: ContentChunk[] = [];
      let wake: (() => void) | null = null;
      let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      let closed = false;
      let drainTimer: NodeJS.Timeout | undefined;
      let spawnError: Error | null = null;
      let timedOut = false;
      let outputTail = "";
      const notify = () => {
        wake?.();
        wake = null;
      };
      const pump = (stream: Readable | null) => {
        stream?.setEncoding("utf8");
        stream?.on("data", (data: string) => {
          queue.push({ type: SCRIPT_OUTPUT_CHUNK_TYPE, data });
          notify();
        });
      };

      const child = spawnImpl(request.script, workingDirectory);
      active = child;
      pump(child.stdout);
      pump(child.stderr);
      child.on("error", (error) => {
        spawnError = error;
        notify();
      });
      // `exit` can fire while stdout/stderr still hold data; `close` means drained.
      child.on("exit", (code, signal) => {
        exit = { code, signal };
        drainTimer = setTimeout(() => {
          closed = true;
          notify();
        }, EXIT_DRAIN_GRACE_MS);
      });
      child.on("close", () => {
        closed = true;
        notify();
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void kill(child);
      }, request.timeoutMs);

      try {
        while (true) {
          while (queue.length > 0) {
            const chunk = queue.shift()!;
            outputTail = appendTail(outputTail, chunk.data);
            yield chunk;
          }
          if ((exit && closed) || spawnError) {
            break;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        if (spawnError) {
          throw new RunnerExecutionError(`Script could not start: ${(spawnError as Error).message}`);
        }
        const ended = exit!;
        const exitCode = ended.code ?? 128 + (ended.signal ? os.constants.signals[ended.signal] ?? 0 : 0);
        const message = timedOut ? `Timed out after ${formatSeconds(request.timeoutMs)}` : `Exited with code ${exitCode}`;
        yield { type: "convoy_notice", data: JSON.stringify({ code: "script-exit", title: "Script", message }) };
        const scriptResult: ScriptResult = { exitCode, timedOut, outputTail };
        return { scriptResult };
      } finally {
        clearTimeout(timer);
        clearTimeout(drainTimer);
        active = null;
      }
    },
    abort(): void {
      if (active) {
        void kill(active);
      }
    },
    async shutdown(): Promise<void> {
      this.abort();
    },
  };
}
