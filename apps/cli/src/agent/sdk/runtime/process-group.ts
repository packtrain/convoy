import { promisify } from "util";
import { execFile } from "child_process";

import type { ChildProcess } from "child_process";

const execFileAsync = promisify(execFile);

export interface KillProcessGroupOptions {
  platform?: NodeJS.Platform;
  terminateGraceMs: number;
  forceKillGraceMs: number;
  killImpl?: (pid: number, signal: NodeJS.Signals) => void;
  taskkillImpl?: (pid: number, force: boolean) => Promise<void>;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let finished = false;

    const done = (value: boolean) => {
      if (finished) return;
      finished = true;
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

async function defaultTaskkill(pid: number, force: boolean): Promise<void> {
  const args = ["/PID", String(pid), "/T"];
  if (force) args.push("/F");
  await execFileAsync("taskkill", args);
}

function sendPosixGroupSignal(
  child: ChildProcess,
  signal: NodeJS.Signals,
  killImpl: (pid: number, signal: NodeJS.Signals) => void
): void {
  if (!child.pid) return;

  try {
    killImpl(-child.pid, signal);
    return;
  } catch {
    // fall through
  }

  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

export async function killProcessGroup(
  child: ChildProcess,
  options: KillProcessGroupOptions
): Promise<void> {
  if (!child.pid) return;

  const platform = options.platform ?? process.platform;
  const killImpl = options.killImpl ?? process.kill;
  const taskkillImpl = options.taskkillImpl ?? defaultTaskkill;

  if (platform === "win32") {
    await taskkillImpl(child.pid, false).catch(() => undefined);
    const exited = await waitForExit(child, options.terminateGraceMs);
    if (exited) return;
    await taskkillImpl(child.pid, true).catch(() => undefined);
    await waitForExit(child, options.forceKillGraceMs).catch(() => undefined);
    return;
  }

  sendPosixGroupSignal(child, "SIGTERM", killImpl);
  const exited = await waitForExit(child, options.terminateGraceMs);
  if (exited) {
    // The parent is gone; sweep descendants that ignored TERM.
    sendPosixGroupSignal(child, "SIGKILL", killImpl);
    return;
  }

  sendPosixGroupSignal(child, "SIGKILL", killImpl);
  await waitForExit(child, options.forceKillGraceMs).catch(() => undefined);
}
