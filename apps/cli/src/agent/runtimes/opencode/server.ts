import {
  execFile,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { resolveExecutable } from "../../sdk/adapters/executable-resolution.js";
import type { OpencodeAuth, OpencodeSlot } from "../../../lib/config/credentials/validators.js";

/** Env var override for the OpenCode executable path. */
export const OPENCODE_EXECUTABLE_ENV = "CONVOY_OPENCODE_EXECUTABLE";

const SERVER_READY_TIMEOUT_MS = 15_000;
const SHUTDOWN_FORCE_KILL_MS = 5_000;

const isWindows = process.platform === "win32";

export async function resolveOpencodeExecutablePath(): Promise<{
  command: string;
  source: string;
}> {
  const configured = process.env[OPENCODE_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("opencode", {
    ...(configured ? { executablePath: configured } : {}),
  });
}

export function isOpencodeVersionSupported(version: string, minimumVersion: string): boolean {
  const parse = (value: string): number[] =>
    value.split(".").map((segment) => Number.parseInt(segment, 10));
  const actual = parse(version);
  const minimum = parse(minimumVersion);
  if (actual.some(Number.isNaN)) {
    return false;
  }

  for (let index = 0; index < minimum.length; index += 1) {
    const a = actual[index] ?? 0;
    const b = minimum[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return true;
}

export async function opencodeVersion(): Promise<string | undefined> {
  const executable = await resolveOpencodeExecutablePath();
  const { stdout } = await promisify(execFile)(executable.command, ["--version"], {
    timeout: 10_000,
  });
  return String(stdout ?? "").match(/(\d+\.\d+\.\d+)/)?.[1];
}

/** The OpenCode release Convoy checked managed keys against; `project check` installs it (OS-2018). */
export const TESTED_OPENCODE_PACKAGE = "opencode-ai@1.19.5";
/** Oldest OpenCode whose auth and inline-config precedence Convoy checked with managed keys. */
const MANAGED_KEY_MIN_VERSION = "1.18.18";
/** OpenCode's Linux administrator config; it outranks Convoy's inline config. */
const ADMIN_CONFIG_FILES = ["/etc/opencode/opencode.json", "/etc/opencode/opencode.jsonc"];

/** Why this machine's OpenCode cannot take managed keys, or undefined. */
export async function managedKeyRefusal(probe: { version(): Promise<string | undefined>; exists(file: string): boolean } = { version: opencodeVersion, exists: existsSync }): Promise<string | undefined> {
  const config = ADMIN_CONFIG_FILES.find((file) => probe.exists(file));
  if (config) return `${config} overrides Convoy's OpenCode keys. Remove it, or unassign the keys and restore native login.`;
  const version = await probe.version().catch(() => undefined);
  if (version && isOpencodeVersionSupported(version, MANAGED_KEY_MIN_VERSION)) return undefined;
  return `OpenCode ${version ?? "unknown"} is not tested with managed keys. Install ${TESTED_OPENCODE_PACKAGE} root-owned (https://docs.convoy.build/docs/cli/isolated-projects#install-opencode), then reload the project.`;
}

/** URL from the `opencode server listening on http://...` stdout line. */
export function parseServerListeningUrl(line: string): string | null {
  if (!line.includes("opencode server listening")) {
    return null;
  }
  return line.match(/on\s+(https?:\/\/\S+)/)?.[1] ?? null;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("Could not determine a free port")));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

/** Each slot's official endpoint, so a project config cannot redirect a managed key (OS-2018). */
const SLOT_BASE_URLS: Record<OpencodeSlot, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};

function buildOpencodeSubprocessEnv(password: string, auth?: OpencodeAuth): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The API key must never leak into the agent subprocess environment.
  delete env.CONVOY_API_KEY;
  // No CONVOY_THREAD_ID here (OS-1223): this server is shared across
  // threads, so a per-thread env var is impossible — opencode gets thread
  // identity via first-message prompt injection only.
  delete env.OPENCODE_SERVER_USERNAME;
  env.OPENCODE_SERVER_PASSWORD = password;
  if (auth) {
    // Inline config outranks project config; empty auth hides cached logins and OAuth.
    // Spec: docs/specs/cli-provider-keys.md#managed-provider-keys-for-isolated-opencode-os-2018
    for (const key of Object.keys(env)) if (/^(OPENCODE|OPENAI|ANTHROPIC)_/.test(key) && key !== "OPENCODE_SERVER_PASSWORD") delete env[key];
    const keys = auth.mode === "managed" ? Object.entries(auth.keys) as [OpencodeSlot, string][] : [];
    env.OPENCODE_AUTH_CONTENT = "{}";
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      enabled_providers: keys.map(([slot]) => slot),
      provider: Object.fromEntries(keys.map(([slot, apiKey]) => [slot, { options: { apiKey, baseURL: SLOT_BASE_URLS[slot] } }])),
    });
  }
  return env;
}

async function unauthenticatedStatus(url: string): Promise<number> {
  const response = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(5_000) });
  await response.body?.cancel();
  return response.status;
}

/**
 * npm installs wrap the native opencode binary in a JS launcher; signal the
 * whole process group so the native process cannot be orphaned.
 */
function killOpencodeProcess(child: ChildProcess, signal: NodeJS.Signals): void {
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

export interface OpencodeServerHandle {
  url: string;
  /** Basic-auth password of this server instance (user `opencode`). */
  password: string;
}

/** The single spawn shape this module uses (narrower than typeof spawn). */
type SpawnImpl = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

type ServerState = {
  child: ChildProcess;
  handle: OpencodeServerHandle;
};

export interface OpencodeServerManager {
  // Stable identity until restart, for caches scoped to this server instance.
  /** `auth` applies when this call starts the server; one worker serves one project. */
  getServer(auth?: OpencodeAuth): Promise<OpencodeServerHandle>;
  shutdown(): Promise<void>;
}

/**
 * One shared `opencode serve` process per agent process: started lazily on
 * the first OpenCode run, reused across threads/runs, restarted on the
 * next run if it dies, and killed on agent shutdown.
 */
export function createOpencodeServerManager(deps?: {
  spawnImpl?: SpawnImpl;
  resolveExecutablePath?: () => Promise<{ command: string; source: string }>;
  findPort?: () => Promise<number>;
  readyTimeoutMs?: number;
  probeUnauthenticated?: (url: string) => Promise<number>;
  managedRefusal?: () => Promise<string | undefined>;
}): OpencodeServerManager {
  // Resolve lazily: tests that mock child_process without a spawn export
  // must be able to import this module (and shut it down) safely.
  const spawnImpl: SpawnImpl =
    deps?.spawnImpl ??
    ((command, args, options) => spawn(command, args, options));
  const resolvePath = deps?.resolveExecutablePath ?? resolveOpencodeExecutablePath;
  const findPort = deps?.findPort ?? findFreePort;
  const readyTimeoutMs = deps?.readyTimeoutMs ?? SERVER_READY_TIMEOUT_MS;
  const probeUnauthenticated = deps?.probeUnauthenticated ?? unauthenticatedStatus;
  const managedRefusal = deps?.managedRefusal ?? managedKeyRefusal;

  let state: ServerState | null = null;
  let starting: Promise<ServerState> | null = null;
  let exitHandlerRegistered = false;

  function registerExitHandler(): void {
    if (exitHandlerRegistered) {
      return;
    }
    exitHandlerRegistered = true;
    // Detached children survive parent exit; this is the last-resort sync
    // cleanup for paths that bypass shutdown() (crashes, process.exit).
    process.once("exit", () => {
      const child = state?.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        killOpencodeProcess(child, "SIGKILL");
      }
    });
  }

  async function startServer(auth?: OpencodeAuth): Promise<ServerState> {
    // Detection and runs both start here, so no untested binary ever gets the keys.
    const refusal = auth?.mode === "managed" ? await managedRefusal() : undefined;
    if (refusal) throw new Error(refusal);
    const executable = await resolvePath();
    const port = await findPort();
    const password = randomBytes(32).toString("base64url");
    const child = spawnImpl(
      executable.command,
      ["serve", "--hostname=127.0.0.1", `--port=${port}`],
      {
        env: buildOpencodeSubprocessEnv(password, auth),
        stdio: ["ignore", "pipe", "pipe"],
        // Own process group so shutdown can kill wrapper + native binary.
        detached: !isWindows,
      },
    );

    const outputTail: string[] = [];
    const recordTail = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      outputTail.push(trimmed);
      if (outputTail.length > 12) {
        outputTail.shift();
      }
    };

    const url = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          killOpencodeProcess(child, "SIGKILL");
          reject(
            new Error(
              `opencode serve did not report readiness within ${Math.round(readyTimeoutMs / 1000)}s.${
                outputTail.length > 0 ? ` Output: ${outputTail.join(" | ")}` : ""
              }`,
            ),
          );
        });
      }, readyTimeoutMs);
      timer.unref?.();

      if (child.stdout) {
        createInterface({ input: child.stdout }).on("line", (line) => {
          recordTail(line);
          const listeningUrl = parseServerListeningUrl(line);
          if (listeningUrl) {
            settle(() => resolve(listeningUrl));
          }
        });
      }
      if (child.stderr) {
        createInterface({ input: child.stderr }).on("line", recordTail);
      }

      child.once("error", (error) => {
        settle(() => reject(new Error(`Failed to start opencode serve: ${error.message}`)));
      });
      child.once("exit", (code, signal) => {
        settle(() =>
          reject(
            new Error(
              `opencode serve exited before becoming ready (${code !== null ? `exit code ${code}` : `signal ${signal ?? "unknown"}`}).${
                outputTail.length > 0 ? ` Output: ${outputTail.join(" | ")}` : ""
              }`,
            ),
          ),
        );
      });
    });

    // Fail closed on a build that ignores the password: a sibling project could drive it.
    const status = await probeUnauthenticated(url).catch(() => 0);
    if (status !== 401) {
      killOpencodeProcess(child, "SIGKILL");
      throw new Error(status
        ? `opencode serve answered without its password (HTTP ${status}). Upgrade OpenCode, then reload.`
        : "opencode serve did not answer its health probe. Check the OpenCode install, then reload.");
    }

    const nextState: ServerState = { child, handle: { url, password } };
    child.once("exit", () => {
      // Dead server: clear the singleton so the next run restarts it.
      if (state === nextState) {
        state = null;
      }
    });

    registerExitHandler();
    return nextState;
  }

  return {
    async getServer(auth?: OpencodeAuth): Promise<OpencodeServerHandle> {
      if (state && state.child.exitCode === null && state.child.signalCode === null) {
        return state.handle;
      }

      if (!starting) {
        starting = startServer(auth).finally(() => {
          starting = null;
        });
      }

      state = await starting;
      return state.handle;
    },

    async shutdown(): Promise<void> {
      const current = state;
      state = null;
      if (!current) {
        return;
      }
      const { child } = current;
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      await new Promise<void>((resolve) => {
        const forceKill = setTimeout(() => {
          killOpencodeProcess(child, "SIGKILL");
        }, SHUTDOWN_FORCE_KILL_MS);
        forceKill.unref?.();

        child.once("exit", () => {
          clearTimeout(forceKill);
          resolve();
        });
        killOpencodeProcess(child, "SIGTERM");
      });
    },
  };
}

let defaultManager: OpencodeServerManager | null = null;

function getDefaultManager(): OpencodeServerManager {
  defaultManager ??= createOpencodeServerManager();
  return defaultManager;
}

export function getOpencodeServer(auth?: OpencodeAuth): Promise<OpencodeServerHandle> {
  return getDefaultManager().getServer(auth);
}

/** Kill the shared serve process; called from the agent's stop path. */
export function shutdownOpencodeServer(): Promise<void> {
  return getDefaultManager().shutdown();
}
