import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "child_process";

import type { SpawnSpec } from "../types.js";

export interface SpawnProcessOptions {
  spawnImpl?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => ChildProcess;
  stdio?: ["pipe", "pipe", "pipe"];
}

export function spawnProcess(
  spec: SpawnSpec,
  options: SpawnProcessOptions = {}
): ChildProcess {
  const spawnFn = options.spawnImpl ?? spawn;
  const child = spawnFn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    shell: false,
    detached: spec.detached ?? process.platform !== "win32",
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Failed to spawn process with pipe stdio");
  }

  return child;
}
