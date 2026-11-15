import { existsSync } from "node:fs";
import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { SpawnSpec } from "../types.js";
import {
  isSupervisorToParentMessage,
  type ParentToSupervisorMessage,
  type SupervisorToParentMessage,
} from "./supervisor-protocol.js";

export interface SupervisorControl {
  interrupt: () => Promise<void>;
  terminate: (reason?: string) => Promise<void>;
}

export interface SupervisedSpawnResult {
  child: ChildProcess;
  control: SupervisorControl | null;
}

export interface SpawnSupervisedProcessOptions {
  spawnImpl?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  terminateGraceMs: number;
  forceKillGraceMs: number;
  startTimeoutMs?: number;
}

function resolveSupervisorCommand(): { command: string; args: string[] } {
  const currentPath = fileURLToPath(import.meta.url);
  const runtimeDir = path.dirname(currentPath);

  const jsEntrypoint = path.join(runtimeDir, "provider-supervisor-entrypoint.js");
  if (existsSync(jsEntrypoint)) {
    return {
      command: process.execPath,
      args: [jsEntrypoint],
    };
  }

  const tsEntrypoint = path.join(runtimeDir, "provider-supervisor-entrypoint.ts");
  if (existsSync(tsEntrypoint)) {
    return {
      command: process.execPath,
      args: ["--import", "tsx", tsEntrypoint],
    };
  }

  throw new Error("Supervisor entrypoint not found");
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      done(false);
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timer);
      done(true);
    };

    child.once("exit", onExit);
  });
}

function sendIpcMessage(child: ChildProcess, message: ParentToSupervisorMessage): Promise<void> {
  if (typeof child.send !== "function") {
    return Promise.reject(new Error("Supervisor IPC channel unavailable"));
  }

  return new Promise((resolve, reject) => {
    child.send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function waitForSupervisorStart(
  child: ChildProcess,
  timeoutMs: number
): Promise<SupervisorToParentMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result: { ok: true; message: SupervisorToParentMessage } | { ok: false; error: Error }) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (result.ok) {
        resolve(result.message);
      } else {
        reject(result.error);
      }
    };

    const onMessage = (raw: unknown) => {
      if (!isSupervisorToParentMessage(raw)) {
        return;
      }
      if (raw.type === "started" || raw.type === "spawn_error") {
        finish({ ok: true, message: raw });
      }
    };

    const onError = (error: Error) => {
      finish({
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish({
        ok: false,
        error: new Error(
          `Supervisor exited before start handshake (code=${code ?? "null"}, signal=${signal ?? "null"})`
        ),
      });
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: new Error(`Supervisor start handshake timed out after ${timeoutMs}ms`),
      });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function spawnSupervisedProcess(
  spec: SpawnSpec,
  options: SpawnSupervisedProcessOptions
): Promise<SupervisedSpawnResult> {
  const spawnFn = options.spawnImpl ?? spawn;
  const startTimeoutMs = options.startTimeoutMs ?? 5_000;

  const supervisor = resolveSupervisorCommand();
  const child = spawnFn(supervisor.command, supervisor.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    shell: false,
    detached: false,
  });

  if (!child.stdin || !child.stdout || !child.stderr || typeof child.send !== "function") {
    throw new Error("Failed to spawn supervisor with stdio+ipc");
  }

  const startPromise = waitForSupervisorStart(child, startTimeoutMs);
  try {
    await sendIpcMessage(child, {
      type: "start",
      spec,
      limits: {
        terminateGraceMs: options.terminateGraceMs,
        forceKillGraceMs: options.forceKillGraceMs,
      },
    });

    const startResult = await startPromise;
    if (startResult.type === "spawn_error") {
      await waitForExit(child, 500).catch(() => undefined);
      throw new Error(`Supervisor spawn failed: ${startResult.error}`);
    }
  } catch (error) {
    if (child.exitCode == null && child.signalCode == null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // best effort
      }
    }
    await waitForExit(child, 500).catch(() => undefined);
    await startPromise.catch(() => undefined);
    throw error;
  }

  const control: SupervisorControl = {
    interrupt: async () => {
      if (child.exitCode != null || child.signalCode != null) {
        return;
      }

      try {
        await sendIpcMessage(child, { type: "interrupt" });
      } catch {
        try {
          child.kill("SIGINT");
        } catch {
          // best effort
        }
      }
    },
    terminate: async (reason?: string) => {
      if (child.exitCode != null || child.signalCode != null) {
        return;
      }

      try {
        await sendIpcMessage(child, { type: "terminate", reason });
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // best effort
        }
      }

      const timeoutMs = options.terminateGraceMs + options.forceKillGraceMs + 250;
      const exited = await waitForExit(child, timeoutMs);
      if (exited) {
        return;
      }

      try {
        child.kill("SIGKILL");
      } catch {
        // best effort
      }
    },
  };

  return { child, control };
}
