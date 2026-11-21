import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectAddOptions } from "./workflow.js";
import type { ServiceProfile } from "../service/validators.js";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { projectEnvironmentSchema, projectRegistrationSchema, type WorkerLaunchConfig, projectAddResultSchema, unavailableProjectResult, type LoginRuntime, launcherCheckSchema, projectAccountsSchema, loginRuntimeSchema, LOGIN_COMMANDS, type SharedRuntimeStates } from "./validators.js";
import { findOnPath } from "../../agent/sdk/adapters/executable-resolution.js";
import { RUNTIME_BINARIES } from "../environment/resolution.js";
import { USER_INSTALLS } from "./formatters.js";
import { compareVersions } from "../../agent/sdk/versioning/provider-version.js";
import { launchCapabilities } from "../../lib/config/credentials/resolution.js";
import { cliPackageRoot } from "../../lib/version.js";
import type { LauncherFacts } from "../environment/validators.js";

export const PROJECT_LAUNCHER = "/usr/local/libexec/convoy-project-launcher";

export function isProjectEnvironment(): boolean {
  return process.platform === "linux" && existsSync("/etc/convoy-projects.json");
}

/** The workspace root `installLauncher` creates; projects register as its children. */
export const ISOLATED_WORKSPACE = "/srv/convoy-workspaces";

/** The path and every parent are root-owned without group or world writes, as install.py requires. */
function rootOwned(path: string) {
  for (let item = path; ; item = dirname(item)) {
    const info = statSync(item);
    if (info.uid !== 0 || info.mode & 0o022) return false;
    if (item === "/") return true;
  }
}

/** Reads what isolated mode needs from this machine, changing nothing. Spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets */
export async function launcherFacts(): Promise<LauncherFacts> {
  const bwrap = await findOnPath("bwrap") ?? undefined;
  const probe = bwrap ? spawnSync(bwrap, ["--unshare-user", "--ro-bind", "/", "/", "true"], { encoding: "utf8", timeout: 10_000 }) : undefined;
  let apparmor = false;
  try { apparmor = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1"; } catch { /* Kernel without the AppArmor restriction. */ }
  const node = realpathSync(process.execPath), cli = realpathSync(cliPackageRoot() ?? ".");
  return {
    bwrap, apparmor, node, nodeRootOwned: rootOwned(node), cli, cliRootOwned: rootOwned(cli),
    userns: probe && probe.status !== 0 ? probe.stderr?.trim().split("\n").at(-1) || probe.error?.message || "bwrap failed" : undefined,
  };
}

/** Creates the workspace and runs install.py with sudo, which prompts on the terminal. Returns their combined output. */
export function installLauncher(): { ok: boolean; output: string } {
  const { uid, gid, username } = userInfo();
  const root = realpathSync(cliPackageRoot() ?? ".");
  const steps = [
    ["install", "-d", "-m", "0755", "-o", String(uid), "-g", String(gid), ISOLATED_WORKSPACE],
    ["python3", "-I", join(root, "dist/templates/project-isolation/install.py"), "--control-user", username,
      "--workspace", ISOLATED_WORKSPACE, "--package-root", root, "--node", realpathSync(process.execPath)],
  ];
  let output = "";
  for (const args of steps) {
    const result = spawnSync("sudo", args, { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
    output += `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status !== 0) return { ok: false, output: output.trim() };
  }
  return { ok: true, output: output.trim() };
}

export function projectRequest(request: Record<string, unknown>): unknown {
  if (process.platform !== "linux") throw new Error("Project isolation requires the configured Linux execution environment.");
  const result = spawnSync("sudo", ["-n", PROJECT_LAUNCHER], {
    input: JSON.stringify(request), encoding: "utf8", maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Linux project launcher unavailable. Follow the project-isolation setup instructions.");
  }
  return JSON.parse(result.stdout);
}

/** One launcher request off the calling thread; rejects with the launcher's own message when it gives one. */
function launcherRequestAsync(request: Record<string, unknown>, timeout: number, fallback: string): Promise<unknown> {
  const child = spawn("sudo", ["-n", PROJECT_LAUNCHER], {
    stdio: "pipe", env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  let output = "", errors = "";
  child.stdin.on("error", () => {});
  child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString("utf8")).slice(-4096); });
  child.stdin.end(JSON.stringify(request) + "\n");
  return new Promise((resolve, reject) => {
    const fail = (message = fallback) => { clearTimeout(deadline); child.kill("SIGKILL"); reject(new Error(message)); };
    const deadline = setTimeout(() => fail(), timeout);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (Buffer.byteLength(output) > 1024 * 1024) fail(); });
    child.once("error", () => fail());
    child.once("close", (code) => {
      clearTimeout(deadline);
      if (code !== 0) { fail(errors.trim() || fallback); return; }
      try { resolve(JSON.parse(output)); } catch { fail(); }
    });
  });
}

/** Poll without blocking control requests while the registry is locked. */
export async function inspectProjectEnvironmentAsync() {
  const fallback = "Cannot inspect project registry. Check launcher setup and registry lock.";
  const result = await launcherRequestAsync({ action: "list" }, 12000, fallback).catch(() => { throw new Error(fallback); });
  try { return projectEnvironmentSchema.parse(result); } catch { throw new Error(fallback); }
}

/** The launcher's read-only preconditions for one project, including the boundary probes. */
export async function checkLauncher(identity: string) {
  const result = await launcherRequestAsync({ action: "check", identity }, 90_000, "Project check failed in the launcher. Check launcher setup.").catch((error: Error) => {
    throw new Error(error.message === "Unsupported operation" ? "The project launcher predates project check. Rerun install.py with the same arguments to update it." : error.message);
  });
  return launcherCheckSchema.parse(result);
}

export function inspectProjectEnvironment() {
  return projectEnvironmentSchema.parse(projectRequest({ action: "list" }));
}

export function prepareProject(request: Record<string, unknown>) {
  return projectRegistrationSchema.parse(projectRequest({ ...request, action: "add" }));
}

/** Shared invocation; callers choose output routing and own the control pipe. */
export function spawnProjectLauncher(identity: string, config: WorkerLaunchConfig, output: "pipe" | "inherit", capabilityChecked = false) {
  const capabilities = launchCapabilities(config);
  const supported = capabilities.length && !capabilityChecked ? inspectProjectEnvironment().capabilities ?? [] : capabilities;
  if (capabilities.some((c) => !supported.includes(c))) throw new Error("Managed credentials require an updated project launcher. Reinstall it before connecting.");
  const child = spawn("sudo", ["-n", PROJECT_LAUNCHER], {
    stdio: ["pipe", output, output], cwd: "/",
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  });
  child.stdin!.on("error", () => {});
  // The launcher records who holds the lease; only a service connection gets launcher failure events.
  child.stdin!.write(`${JSON.stringify({ action: "connect", identity, config, holder: output === "pipe" ? "service" : "connect" })}\n`);
  return child;
}

/** Runtime config homes and the agy override a shared service and its workers keep, so they run what a foreground connect runs. */
export const SHARED_RUNTIME_ENV = ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "CONVOY_ANTIGRAVITY_EXECUTABLE"];

const WORKER = fileURLToPath(new URL(`./worker.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url));

/** Shared mode: the service runs the worker itself, with the PATH it was started with. Spec: docs/specs/cli-shared-environments.md#execution */
export function spawnSharedWorker(entry: ServiceProfile, worker = WORKER, execArgv = process.execArgv) {
  if (!entry.path || entry.config.mode !== "shared") throw new Error("Not a shared registration.");
  const env: Record<string, string> = {};
  for (const name of ["HOME", "PATH", "LANG", "TERM", ...SHARED_RUNTIME_ENV]) if (process.env[name]) env[name] = process.env[name]!;
  const child = spawn(process.execPath, [...execArgv, worker], { stdio: ["pipe", "pipe", "pipe"], cwd: "/", env });
  child.stdin.on("error", () => {});
  child.stdin.write(`${JSON.stringify({ ...entry.config, paths: [entry.path], projectIdentity: entry.identity })}\n`);
  return child;
}

/** The root launcher owns the lease and watches this control process's pipe. */
export async function launchProject(identity: string, payload: { config: WorkerLaunchConfig }): Promise<void> {
  const child = spawnProjectLauncher(identity, payload.config, "inherit");
  const stop = () => child.stdin!.end();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    const status = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (status !== 0) throw new Error(`Project connection ended with status ${status}. Files were retained. If another connection or service owns this project, check 'convoy service status' and stop that owner before retrying.`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}

/** Open the private shell, or with a runtime run only that runtime's login in it. */
export async function projectShell(identity: string, signal?: AbortSignal, login?: LoginRuntime): Promise<void> {
  signal?.throwIfAborted();
  const code = await terminalExit(spawn("sudo", ["-n", PROJECT_LAUNCHER, ...(login ? ["login", identity, login] : ["shell", identity])], {
    stdio: "inherit", env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
  }), signal);
  if (code !== 0) throw new Error(login
    ? `Runtime login exited with status ${code}. If the launcher reported unsupported arguments, rerun install.py to update it.`
    : `Project shell exited with status ${code}.`);
}

/** Shared mode: `$SHELL` in the project folder, or the runtime's own login in HOME. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins */
export async function sharedShell(folder: string, signal?: AbortSignal, login?: LoginRuntime): Promise<void> {
  signal?.throwIfAborted();
  if (!login && !existsSync(folder)) throw new Error(`Project folder ${folder} is missing.`);
  const agy = login === "antigravity" ? await resolveAgy() : undefined;
  if (login === "antigravity" && !agy) throw new Error(`Antigravity is not installed on this account. Install it: ${USER_INSTALLS.antigravity}.`);
  const code = await terminalExit(agy ? spawn(agy, ["acp", "--login"], { cwd: homedir(), stdio: "inherit" }) : login
    // exec /usr/bin/env: the runtime takes the spawned PID, so abort's SIGTERM reaches it, env prefix included.
    ? spawn("/bin/sh", ["-c", `exec /usr/bin/env ${LOGIN_COMMANDS[login]}`], { cwd: homedir(), stdio: "inherit" })
    : spawn(process.env.SHELL || "/bin/sh", [], { cwd: folder, stdio: "inherit" }), signal);
  // A shell's status is its last command's, so only a login's counts.
  if (login && code !== 0) throw new Error(`Runtime login exited with status ${code}.`);
}

/** Waits for a terminal child; abort and service signals stop it first. */
async function terminalExit(child: ChildProcess, signal?: AbortSignal): Promise<number> {
  const stop = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", stop, { once: true });
  for (const name of ["SIGTERM", "SIGHUP"] as const) process.once(name, stop);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", value => resolve(value ?? 1));
    });
    signal?.throwIfAborted();
    return code;
  } finally {
    signal?.removeEventListener("abort", stop);
    for (const name of ["SIGTERM", "SIGHUP"] as const) process.off(name, stop);
  }
}

/** Run preparation off the renderer thread; credentials travel only on stdin. */
export async function addLocalProject(directory: string, options: ProjectAddOptions) {
  const entry = new URL(`../environment/setup-entrypoint.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url);
  let child: ChildProcessWithoutNullStreams;
  try { child = spawn(process.execPath, [...process.execArgv, fileURLToPath(entry)], { stdio: "pipe" }); }
  catch { return unavailableProjectResult(); }
  let output = "", started = false;
  child.once("spawn", () => { started = true; });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify({ guided: true, directory, options }));
  child.stderr.resume();
  return new Promise<ReturnType<typeof projectAddResultSchema.parse>>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 360_000);
    child.stdout.on("data", chunk => { output += chunk.toString(); if (Buffer.byteLength(output) > 32768) child.kill("SIGKILL"); });
    child.once("error", () => { clearTimeout(timeout); if (!started) resolve(unavailableProjectResult()); else reject(new Error("Registration outcome unknown. Inspect saved projects before retrying.")); });
    child.once("close", code => {
      clearTimeout(timeout);
      try { if (code !== 0) throw new Error(); resolve(projectAddResultSchema.parse(JSON.parse(output))); }
      catch { reject(new Error("Registration outcome unknown. Inspect saved projects before retrying.")); }
    });
  });
}

/** Native runtime account report from the private project sandbox. */
export async function projectAccounts(identity: string) {
  return projectAccountsSchema.parse(await launcherRequestAsync({ action: "account", identity }, 20_000, "Cannot check account. Update the project launcher and retry."));
}

const STATUS_COMMANDS: Partial<Record<LoginRuntime, string[]>> = { codex: ["login", "status"], "claude-code": ["auth", "status", "--json"] };

/** Runtimes on PATH and their own login status; `unknown` unless the status command answers clearly. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins */
export async function sharedRuntimeStates(): Promise<SharedRuntimeStates> {
  const entries = await Promise.all(loginRuntimeSchema.options.map(async runtime => {
    if (runtime === "antigravity") return [runtime, await agyState()] as const;
    const binary = await findOnPath(RUNTIME_BINARIES[runtime]), args = STATUS_COMMANDS[runtime];
    if (!binary || !args) return [runtime, { installed: Boolean(binary), login: "unknown" }] as const;
    const { code, stdout, output } = await statusOutput(binary, args);
    return [runtime, { installed: true, login: runtime === "codex" ? codexLogin(code, output) : claudeLogin(code, stdout) }] as const;
  }));
  return Object.fromEntries(entries) as SharedRuntimeStates;
}

// Lazy: detect.ts loads child_process at import, which launcher tests mock.
const antigravity = () => import("../../agent/runtimes/antigravity/detect.js");

/** The agy the worker would run: the override, then `agy`, then `antigravity`; undefined when none resolves. */
async function resolveAgy(): Promise<string | undefined> {
  return (await (await antigravity()).resolveAntigravityExecutablePath().catch(() => undefined))?.command;
}

/** agy has no status command; it is usable when `--version` succeeds at or above the worker's floor. */
async function agyState(): Promise<SharedRuntimeStates["antigravity"]> {
  const binary = await resolveAgy();
  if (!binary) return { installed: false, login: "unknown" };
  const { MIN_ANTIGRAVITY_VERSION } = await antigravity();
  const { code, stdout } = await statusOutput(binary, ["--version"]);
  const version = code === 0 ? /\d+\.\d+\.\d+/.exec(stdout)?.[0] : undefined;
  if (!version) return { installed: true, login: "unknown", unusable: "did not report its version" };
  return compareVersions(version, MIN_ANTIGRAVITY_VERSION) < 0 ? { installed: true, login: "unknown", unusable: `${version} is older than Convoy supports` } : { installed: true, login: "unknown" };
}

// Same answers the launcher's account_result recognizes.
function codexLogin(code: number | null, output: string) {
  const lines = output.trim().split(/\r?\n/);
  if (code === 0 && lines.some(line => line === "Logged in using ChatGPT" || line.startsWith("Logged in using an API key"))) return "signed-in";
  return code === 1 && lines.at(-1) === "Not logged in" ? "signed-out" : "unknown";
}

function claudeLogin(code: number | null, stdout: string) {
  try {
    const { loggedIn } = JSON.parse(stdout) as { loggedIn?: unknown };
    if (code === 0 && loggedIn === true) return "signed-in";
    if ((code === 0 || code === 1) && loggedIn === false) return "signed-out";
  } catch { /* not JSON */ }
  return "unknown";
}

/** Runs one status command; its process group is killed after 8 s or 16 KiB, like the launcher's. */
function statusOutput(command: string, args: string[]): Promise<{ code: number | null; stdout: string; output: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "", output = "", done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      resolve({ code, stdout, output });
    };
    const timer = setTimeout(() => finish(null), 8000);
    const read = (out: boolean) => (chunk: Buffer) => {
      if (out) stdout += chunk;
      output += chunk;
      if (output.length > 16384) finish(null);
    };
    child.stdout.on("data", read(true)); child.stderr.on("data", read(false));
    child.once("error", () => finish(null));
    child.once("close", code => finish(code));
  });
}
