import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ENV_THREAD_ID } from "../../../lib/constants.js";
import { withoutClaudeProviderEnv } from "../../../lib/config/provider-keys.js";
import { resolveExecutable } from "../../sdk/adapters/executable-resolution.js";
import { satisfiesVersionRange } from "../../sdk/versioning/provider-version.js";
import { ACP_PERMISSION_CANCELLED, createAcpClient, type AcpClient } from "../acp/client.js";
import type { DetectedCli, DetectedCliModel } from "../contracts.js";

const execFileAsync = promisify(execFile);

/** Env var override for the agy executable path. */
export const ANTIGRAVITY_EXECUTABLE_ENV = "CONVOY_ANTIGRAVITY_EXECUTABLE";
/** Oldest agy with ACP session resume and the system prompt append (docs/specs/cli-antigravity-runtime.md). */
export const MIN_ANTIGRAVITY_VERSION = "1.5.12";
/** Registration must not stall on a slow or hung inventory session. */
const INVENTORY_TIMEOUT_MS = 20_000;
/** Same budget as OpenCode's; the backend parser holds the hard ceiling. */
export const MAX_ADVERTISED_MODELS = 150;

export async function resolveAntigravityExecutablePath(): Promise<{ command: string; source: string }> {
  const configured = process.env[ANTIGRAVITY_EXECUTABLE_ENV]?.trim();
  return resolveExecutable("antigravity", configured ? { executablePath: configured } : undefined);
}

/** agy runs as a launcher around a native binary; signal the whole group. */
export function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group already gone; fall through.
    }
  }
  child.kill(signal);
}

export function buildAntigravitySubprocessEnv(threadId?: string): NodeJS.ProcessEnv {
  const env = withoutClaudeProviderEnv(process.env);
  delete env.CONVOY_API_KEY;
  if (threadId) env[ENV_THREAD_ID] = threadId;
  env.AGY_CLI_DISABLE_AUTO_UPDATE = "1";
  return env;
}

/** Reads the model option, then selects each model once to learn its thinking levels. */
export async function collectAntigravityModels(
  acp: Pick<AcpClient, "initialize" | "newSession" | "setConfigOption">,
  cwd: string,
  onSession: (sessionId: string) => void
): Promise<DetectedCliModel[]> {
  await acp.initialize({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  const { sessionId, configOptions } = await acp.newSession({ cwd });
  onSession(sessionId);
  const modelOption = configOptions.find((option) => option.category === "model");
  if (!modelOption) throw new Error("agy advertised no model option");
  const models: DetectedCliModel[] = [];
  for (const choice of modelOption.options.slice(0, MAX_ADVERTISED_MODELS)) {
    const updated = await acp.setConfigOption(sessionId, modelOption.id, choice.value);
    const levels = updated.find((option) => option.category === "thought_level")?.options.map((level) => level.value) ?? [];
    models.push({ slug: choice.value, name: choice.name, ...(levels.length > 0 ? { variants: levels } : {}) });
  }
  return models;
}

/** The files agy keeps per conversation under the user's profile (verified on 1.5.13). */
async function deleteAgySessionFiles(sessionId: string): Promise<void> {
  if (!/^[\w-]+$/.test(sessionId)) return;
  const root = join(homedir(), ".gemini", "antigravity-cli");
  await Promise.all(
    [`conversations/${sessionId}.db`, `conversations/${sessionId}.db-wal`, `conversations/${sessionId}.db-shm`, `brain/${sessionId}`].map(
      (path) => rm(join(root, path), { recursive: true, force: true })
    )
  );
}

/** Runs the inventory in a fresh temp directory, then kills agy and deletes its files. */
async function runInventorySession(command: string, cwd: string): Promise<DetectedCliModel[]> {
  const child = spawn(command, ["acp"], {
    cwd,
    env: buildAntigravitySubprocessEnv(),
    stdio: ["pipe", "pipe", "ignore"],
    detached: process.platform !== "win32",
  });
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
  child.stdin?.on("error", () => {});
  const acp = createAcpClient(
    { stdin: child.stdin!, stdout: child.stdout! },
    { onSessionUpdate: () => {}, onRequestPermission: async () => ACP_PERMISSION_CANCELLED },
    "Antigravity"
  );
  child.once("error", (error) => acp.close(error.message));
  child.once("close", () => acp.close("agy exited"));
  let sessionId: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      collectAntigravityModels(acp, cwd, (id) => (sessionId = id)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Antigravity inventory timed out")), INVENTORY_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    acp.close("inventory finished");
    if (child.exitCode === null && child.signalCode === null) killProcessGroup(child, "SIGKILL");
    await exited;
    if (sessionId) await deleteAgySessionFiles(sessionId).catch(() => {});
  }
}

/**
 * One throwaway ACP session, deleted afterwards with its agy files. Undefined (catalog
 * unknown) on any failure: signed out, no temp directory, past the budget.
 */
export async function loadAntigravityModels(command: string): Promise<DetectedCliModel[] | undefined> {
  let cwd: string | undefined;
  try {
    cwd = await mkdtemp(join(tmpdir(), "convoy-agy-models-"));
    return await runInventorySession(command, cwd);
  } catch {
    return undefined;
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

/** `agy --version` prints a bare `1.5.13`; the models come from {@link loadAntigravityModels}. */
export async function detectAntigravity(): Promise<DetectedCli | null> {
  try {
    const executable = await resolveAntigravityExecutablePath();
    const { stdout } = await execFileAsync(executable.command, ["--version"], { timeout: 10_000 });
    const version = String(stdout ?? "").match(/(\d+\.\d+\.\d+)/)?.[1];
    if (!version || !satisfiesVersionRange(version, `>=${MIN_ANTIGRAVITY_VERSION}`)) return null;
    const models = await loadAntigravityModels(executable.command);
    return { type: "antigravity", version, ...(models ? { models } : {}) };
  } catch {
    return null;
  }
}
