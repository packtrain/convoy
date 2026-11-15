import { mkdtemp, mkdir, rm } from "fs/promises";
import path from "path";
import os from "os";

import type { IsolationContext } from "../types.js";

export interface CreateIsolationEnvOptions {
  rootDir?: string;
  runId: string;
  baseEnv?: Record<string, string | undefined>;
  denylist?: string[];
  envOverrides?: Record<string, string>;
}

export async function createIsolationEnv(
  options: CreateIsolationEnvOptions
): Promise<IsolationContext> {
  const root = options.rootDir ?? path.join(os.tmpdir(), "convoy-cli-runs");
  await mkdir(root, { recursive: true });

  const runRoot = await mkdtemp(path.join(root, `${options.runId}-`));
  const homeDir = path.join(runRoot, "home");
  const configDir = path.join(runRoot, "config");
  const cacheDir = path.join(runRoot, "cache");
  const stateDir = path.join(runRoot, "state");

  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
  ]);

  const base = { ...(options.baseEnv ?? process.env) };
  for (const key of options.denylist ?? []) {
    delete base[key];
  }

  const env: Record<string, string | undefined> = {
    ...base,
    HOME: homeDir,
    XDG_CONFIG_HOME: configDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_STATE_HOME: stateDir,
    ...options.envOverrides,
  };

  return {
    rootDir: runRoot,
    homeDir,
    env,
    cleanup: async () => {
      await rm(runRoot, { recursive: true, force: true });
    },
  };
}
