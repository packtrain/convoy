import { spawn, type ChildProcess } from "child_process";

import { killProcessGroup } from "./process-group.js";
import {
  isParentToSupervisorMessage,
  type ParentToSupervisorMessage,
  type SupervisorLimits,
  type SupervisorSpawnErrorMessage,
  type SupervisorStartedMessage,
  type SupervisorToParentMessage,
} from "./supervisor-protocol.js";

const DEFAULT_LIMITS: SupervisorLimits = {
  terminateGraceMs: 3_000,
  forceKillGraceMs: 1_500,
};

let managedChild: ChildProcess | null = null;
let limits: SupervisorLimits = { ...DEFAULT_LIMITS };
let terminatePromise: Promise<void> | null = null;
let started = false;

function sendToParent(message: SupervisorToParentMessage): void {
  if (typeof process.send !== "function") {
    return;
  }
  process.send(message);
}

function sendSpawnError(error: string): void {
  const payload: SupervisorSpawnErrorMessage = { type: "spawn_error", error };
  sendToParent(payload);
}

function sendStarted(pid: number | null): void {
  const payload: SupervisorStartedMessage = { type: "started", pid };
  sendToParent(payload);
}

function interruptManagedChild(): void {
  if (!managedChild?.pid) {
    return;
  }

  try {
    process.kill(-managedChild.pid, "SIGINT");
    return;
  } catch {
    // fall through
  }

  try {
    managedChild.kill("SIGINT");
  } catch {
    // best effort only
  }
}

async function terminateManagedChild(reason: string): Promise<void> {
  if (!managedChild?.pid) {
    return;
  }

  if (terminatePromise) {
    return terminatePromise;
  }

  terminatePromise = killProcessGroup(managedChild, {
    terminateGraceMs: limits.terminateGraceMs,
    forceKillGraceMs: limits.forceKillGraceMs,
  }).finally(() => {
    terminatePromise = null;
  });

  await terminatePromise;

  // Keep reason available for debugger/diagnostics without writing to stdout/stderr.
  void reason;
}

async function terminateAndExit(reason: string, exitCode: number): Promise<void> {
  try {
    await terminateManagedChild(reason);
  } finally {
    process.exit(exitCode);
  }
}

function assertIpcEnabled(): void {
  if (typeof process.send === "function") {
    return;
  }
  throw new Error("Supervisor requires an IPC channel");
}

function wireManagedChild(child: ChildProcess): void {
  managedChild = child;

  const stdout = child.stdout;
  const stderr = child.stderr;
  const stdin = child.stdin;

  if (!stdout || !stderr || !stdin) {
    throw new Error("Managed child missing stdio streams");
  }

  process.stdin.on("data", (chunk) => {
    if (!stdin.destroyed) {
      stdin.write(chunk);
    }
  });

  process.stdin.on("end", () => {
    if (!stdin.destroyed) {
      stdin.end();
    }
  });

  stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });

  stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.once("exit", (code, signal) => {
    process.exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    // If a terminate sequence is already in flight, let terminateAndExit
    // own process shutdown sequencing.
    if (terminatePromise) {
      return;
    }
    process.exit();
  });
}

function startManagedChild(message: ParentToSupervisorMessage): void {
  if (message.type !== "start") {
    return;
  }

  if (started) {
    sendSpawnError("Supervisor already started");
    return;
  }

  started = true;
  limits = {
    terminateGraceMs: message.limits.terminateGraceMs,
    forceKillGraceMs: message.limits.forceKillGraceMs,
  };

  try {
    const child = spawn(message.spec.command, message.spec.args, {
      cwd: message.spec.cwd,
      env: message.spec.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      detached:
        typeof message.spec.detached === "boolean"
          ? message.spec.detached
          : process.platform !== "win32",
    });

    wireManagedChild(child);
    let spawnConfirmed = false;

    child.once("spawn", () => {
      spawnConfirmed = true;
      sendStarted(child.pid ?? null);
    });

    child.once("error", (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!spawnConfirmed) {
        sendSpawnError(errorMessage);
        process.exitCode = 1;
        process.exit();
        return;
      }

      // Runtime child process errors should perform termination cleanup
      // and must not be reported as spawn-time errors.
      process.stderr.write(`[Supervisor] managed child runtime error: ${errorMessage}\n`);
      void terminateAndExit("managed_child_runtime_error", 1);
    });
  } catch (error) {
    sendSpawnError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    process.exit();
  }
}

function handleMessage(raw: unknown): void {
  if (!isParentToSupervisorMessage(raw)) {
    return;
  }

  if (raw.type === "start") {
    startManagedChild(raw);
    return;
  }

  if (raw.type === "interrupt") {
    interruptManagedChild();
    return;
  }

  if (raw.type === "terminate") {
    void terminateAndExit(raw.reason ?? "terminate_request", 0);
  }
}

export function startSupervisor(): void {
  assertIpcEnabled();

  process.on("message", handleMessage);
  process.on("disconnect", () => {
    void terminateAndExit("parent_disconnect", 0);
  });

  process.on("SIGINT", () => {
    interruptManagedChild();
  });

  process.once("SIGTERM", () => {
    void terminateAndExit("sigterm", 0);
  });

  process.once("SIGHUP", () => {
    void terminateAndExit("sighup", 0);
  });
}
