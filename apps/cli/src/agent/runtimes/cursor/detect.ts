import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DetectedCli } from "../contracts.js";
import { resolveCursorExecutablePath } from "./runner.js";

const execFileAsync = promisify(execFile);

export type AvailableCursorCli = DetectedCli & {
  type: "cursor";
};

/** `cursor-agent --version` prints a bare line like "2025.09.18-7ae6800". */
export function parseCursorVersion(stdout: string): string {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line && /^\d{4}\.\d{2}\.\d{2}/.test(line) ? line : "unknown";
}

async function cursorVersion(): Promise<string> {
  const executable = await resolveCursorExecutablePath();
  const { stdout } = await execFileAsync(executable.command, ["--version"], {
    timeout: 10_000,
  });
  return parseCursorVersion(String(stdout ?? ""));
}

export async function detectCursorAgent(): Promise<AvailableCursorCli | null> {
  try {
    return { type: "cursor", version: await cursorVersion() };
  } catch {
    return null;
  }
}

/** Oldest cursor-agent whose in-memory credential store Convoy checked (OS-2017). */
const MANAGED_KEY_MIN_VERSION = "2026.08.11";
let managedKeyProbe: Promise<string | undefined> | null = null;

/**
 * Undefined when the installed cursor-agent can take a managed key; else the
 * version to name. Older builds may write the key into the project HOME.
 */
export function unsupportedManagedKeyVersion(): Promise<string | undefined> {
  managedKeyProbe ??= cursorVersion().then(
    (version) => (version !== "unknown" && version.slice(0, 10) >= MANAGED_KEY_MIN_VERSION ? undefined : version),
    () => "unknown",
  );
  return managedKeyProbe;
}

let trustFlagProbe: Promise<boolean> | null = null;

/**
 * Whether the installed cursor-agent knows `--trust` (trust the working
 * directory). Newer builds require it to run non-interactively without
 * `--force`; older builds (2025.09.x) trust the cwd by default and reject
 * the flag. A `--help` grep is more robust than comparing date-versions
 * against an assumed release date. Memoized per process.
 */
export function supportsTrustFlag(): Promise<boolean> {
  if (!trustFlagProbe) {
    trustFlagProbe = (async () => {
      try {
        const executable = await resolveCursorExecutablePath();
        const { stdout } = await execFileAsync(executable.command, ["--help"], {
          timeout: 10_000,
        });
        return String(stdout ?? "").includes("--trust");
      } catch {
        return false;
      }
    })();
  }
  return trustFlagProbe;
}

/** Test-only: reset the memoized `--trust` probe. */
export function resetTrustFlagProbeForTests(): void {
  trustFlagProbe = null;
  managedKeyProbe = null;
}
