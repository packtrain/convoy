import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveExecutable } from "../../sdk/adapters/executable-resolution.js";
import { satisfiesVersionRange } from "../../sdk/versioning/provider-version.js";
import type { DetectedCli } from "../contracts.js";

const execFileAsync = promisify(execFile);

/** Env var override for the agy executable path. */
export const ANTIGRAVITY_EXECUTABLE_ENV = "CONVOY_ANTIGRAVITY_EXECUTABLE";
/** Oldest agy with ACP session resume and the system prompt append (docs/specs/cli-antigravity-runtime.md). */
export const MIN_ANTIGRAVITY_VERSION = "1.5.12";

export async function resolveAntigravityExecutablePath(): Promise<{ command: string; source: string }> {
  const configured = process.env[ANTIGRAVITY_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("antigravity", configured ? { executablePath: configured } : undefined);
}

/** `agy --version` prints a bare `1.5.13`. Sign-in is not checked; a signed-out run fails fast. */
export async function detectAntigravity(): Promise<DetectedCli | null> {
  try {
    const executable = await resolveAntigravityExecutablePath();
    const { stdout } = await execFileAsync(executable.command, ["--version"], { timeout: 10_000 });
    const version = String(stdout ?? "").match(/(\d+\.\d+\.\d+)/)?.[1];
    if (!version || !satisfiesVersionRange(version, `>=${MIN_ANTIGRAVITY_VERSION}`)) return null;
    return { type: "antigravity", version };
  } catch {
    return null;
  }
}
