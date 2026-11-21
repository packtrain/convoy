import { z } from "zod";
import { compareVersions } from "../../agent/sdk/versioning/provider-version.js";
import { packageVersion } from "./validators.js";
import type { Environment, EnvironmentMode, RuntimeState } from "./validators.js";
import { homedir } from "node:os";
import { select } from "@inquirer/prompts";
import { claimLocalEnvironment, readImageRecord, readLocalEnvironment, saveLocalEnvironment } from "./paths.js";
import { installLauncher, isProjectEnvironment, launcherFacts } from "../project/launcher.js";
import { readConfig } from "../../lib/config/toml.js";
import { MODE_COPY, launcherPrerequisites, prerequisiteFailure, prerequisiteLines } from "./formatters.js";
import type { Prerequisite } from "./validators.js";
import { RUNTIME_PACKAGES, TESTED_BUILDS } from "../project/formatters.js";
import { loginRuntimeSchema, type LoginRuntime } from "../project/validators.js";
let target: Environment | undefined;
export function setTargetEnvironment(environment?: Environment) { target = environment; }
export function targetEnvironment() { return target; }

/** The record's mode; without one, isolated when the launcher registry exists, else shared. */
export function environmentMode(home = homedir(), launcher = isProjectEnvironment): EnvironmentMode {
  return readLocalEnvironment(home)?.mode ?? (launcher() ? "isolated" : "shared");
}

/** The first `service start` or `project add` saves the inferred mode. */
export function recordEnvironmentMode(home = homedir(), launcher = isProjectEnvironment): EnvironmentMode {
  const saved = readLocalEnvironment(home);
  if (saved) return saved.mode;
  return saveLocalEnvironment(home, { schema: 1, mode: launcher() ? "isolated" : "shared" }).mode;
}

/** The machine state the mode choice reads and changes; tests pass fakes. */
export interface ModeSetup {
  home: string;
  platform: NodeJS.Platform;
  launcher(): boolean;
  registered(): boolean;
  ask(): Promise<EnvironmentMode>;
  checks(): Promise<Prerequisite[]>;
  install(): { ok: boolean; output: string };
  log(line: string): void;
}
export const localModeSetup = (): ModeSetup => ({
  home: homedir(), platform: process.platform, launcher: isProjectEnvironment,
  registered: () => Object.values(readConfig().profiles).some(profile => profile.project_mode || profile.project_isolation),
  ask: () => select({ message: "Project separation on this machine", default: "shared" as EnvironmentMode, loop: false, choices: [
    { value: "shared", name: "Shared", description: MODE_COPY.shared }, { value: "isolated", name: "Isolated", description: MODE_COPY.isolated }] }),
  checks: async () => launcherPrerequisites(await launcherFacts()),
  install: installLauncher,
  log: line => console.log(line),
});

/** Linux offers the choice until a mode record, the launcher or a registered project exists. Spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets */
export function modeChoiceOpen(setup = localModeSetup()) {
  return setup.platform === "linux" && !readLocalEnvironment(setup.home) && !setup.launcher() && !setup.registered() && !readImageRecord();
}

/** Saves the mode while the choice is open; isolated first needs every prerequisite and the install. */
export async function applyEnvironmentMode(mode: EnvironmentMode, setup = localModeSetup()) {
  // Another command may have fixed the mode while a prompt was open.
  const settled = () => { if (!modeChoiceOpen(setup)) throw fixedModeError(recordEnvironmentMode(setup.home, setup.launcher), setup.platform); };
  settled();
  if (mode === "isolated") {
    const checks = await setup.checks();
    setup.log(["Isolated mode prerequisites:", ...prerequisiteLines(checks)].join("\n"));
    if (checks.some(check => check.fix)) throw new Error(prerequisiteFailure("run the same command again"));
    const release = claimLocalEnvironment(setup.home);
    try {
      settled();
      setup.log("Installing the project launcher with sudo…");
      const result = setup.install();
      if (result.output) setup.log(result.output);
      // install.py writes the registry last, so a later failure leaves a finished launcher.
      if (!result.ok && setup.launcher()) setup.log("The installer reported an error, but the launcher is installed, so this machine is now isolated. Check the output above.");
      else if (!result.ok) throw new Error("The launcher install failed or was cancelled. This machine stays shared and no mode was saved.");
      return save(mode, setup);
    } finally { release(); }
  }
  save(mode, setup);
}

function save(mode: EnvironmentMode, setup: ModeSetup) {
  const saved = saveLocalEnvironment(setup.home, { schema: 1, mode }).mode;
  if (saved !== mode) throw fixedModeError(saved, setup.platform);
}

const fixedModeError = (mode: EnvironmentMode, platform: NodeJS.Platform) => new Error(platform === "linux"
  ? `This environment is already ${mode}, and the mode can't change in place. To switch, set up a new environment.`
  : "Isolated mode needs Linux. On a Mac, use a managed Docker environment for isolated projects.");

/** While the choice is open: `--mode`, else the prompt, else shared. Afterwards the fixed mode, which `--mode` must match. */
export async function chooseEnvironmentMode(requested: EnvironmentMode | undefined, interactive: boolean, setup = localModeSetup()): Promise<EnvironmentMode> {
  if (!modeChoiceOpen(setup)) {
    const mode = recordEnvironmentMode(setup.home, setup.launcher);
    if (requested && requested !== mode) throw fixedModeError(mode, setup.platform);
    return mode;
  }
  const mode = requested ?? (interactive ? await setup.ask() : "shared");
  await applyEnvironmentMode(mode, setup);
  return mode;
}

/** Inside a shared managed Docker image, its host folder mounts; undefined elsewhere. */
export function managedMounts(): string[] | undefined {
  const image = readImageRecord();
  return image?.mode === "shared" ? image.mounts : undefined;
}

/** Pin the host release; never guess compatibility from npm's latest tag. */
export async function publishedVersion(version: string, installed?: string, request: typeof fetch = fetch) {
  packageVersion.parse(version);
  if (version.includes("-")) throw new Error("Install a stable published host CLI before updating environments.");
  if (installed) {
    packageVersion.parse(installed);
    if (compareVersions(installed, version) > 0) throw new Error(`Target ${installed} is newer than host ${version}. Update the host first; no downgrade was attempted.`);
  }
  let response: Response;
  try { response = await request(`https://registry.npmjs.org/@useconvoy/cli/${version}`, { signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("Cannot reach npm. Check the host network and retry; target unchanged."); }
  if (response.status === 404) throw new Error(`Required release ${version} is not published on npm. Wait for the release or install a published host CLI; target unchanged.`);
  if (!response.ok) throw new Error("npm lookup failed. Check registry availability and retry; target unchanged.");
  const result = z.object({ name: z.literal("@useconvoy/cli"), version: packageVersion }).parse(await response.json());
  if (result.version !== version) throw new Error("npm returned a different release. Retry later; target unchanged.");
  return result.version;
}

/** `--version` binary per runtime, in display order. */
export const RUNTIME_BINARIES: Record<LoginRuntime, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode", cursor: "cursor-agent", antigravity: "antigravity" };
/**
 * Prints `binary<TAB>first --version line` per runtime; an empty version means not installed, "?" no output.
 * A throwaway HOME: the image's ~/.config is root-owned, and OpenCode creates its config folder even for --version.
 */
export const RUNTIME_PROBE = `h=$(mktemp -d); for b in ${Object.values(RUNTIME_BINARIES).join(" ")}; do v=""; if command -v "$b" >/dev/null 2>&1; then v=$(HOME="$h" XDG_CONFIG_HOME="$h/config" XDG_DATA_HOME="$h/data" XDG_CACHE_HOME="$h/cache" XDG_STATE_HOME="$h/state" timeout 20 "$b" --version 2>/dev/null | head -n 1); [ -n "$v" ] || v="?"; fi; printf '%s\\t%s\\n' "$b" "$v"; done; rm -rf "$h"`;
const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/;

export function parseRuntimeVersions(output: string) {
  const found: Partial<Record<LoginRuntime, string>> = {};
  for (const line of output.split("\n")) {
    const [binary, text = ""] = line.split("\t");
    const runtime = loginRuntimeSchema.options.find(key => RUNTIME_BINARIES[key] === binary);
    if (runtime && text.trim()) found[runtime] = VERSION.exec(text)?.[0] ?? "unknown";
  }
  return found;
}

/** Cursor's dated builds compare by date; never offer a downgrade. */
export function runtimeState(installed: string | undefined, offered: string | undefined): RuntimeState {
  if (!offered) return "unknown";
  if (!installed) return "missing";
  if (installed === "unknown") return "update";
  if (installed === offered) return "current";
  const order = /^\d{4}\./.test(offered) ? installed.slice(0, 10).localeCompare(offered.slice(0, 10)) || -1 : compareVersions(installed, offered);
  return order < 0 ? "update" : order > 0 ? "newer" : "current";
}

/** The tested build where a runtime has one, else npm `latest`. */
export async function offeredVersion(runtime: LoginRuntime, request: typeof fetch = fetch) {
  const tested = TESTED_BUILDS[runtime], pkg = RUNTIME_PACKAGES[runtime];
  if (tested || !pkg) return tested;
  let response: Response;
  try { response = await request(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("Cannot reach npm. Check the host network and retry."); }
  if (!response.ok) throw new Error("npm lookup failed. Check registry availability and retry.");
  return z.object({ version: packageVersion }).parse(await response.json()).version;
}
