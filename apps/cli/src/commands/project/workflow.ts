import { projectAccounts, sharedRuntimeStates, sharedShell } from "./launcher.js";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { confirm } from "@inquirer/prompts";
import { serviceRequest } from "../service/client.js";
import { leasePath, lockHolder, servicePaths } from "../service/paths.js";
import { ServiceUnavailableError } from "../service/errors.js";
import { serviceSnapshot, sharedServiceSnapshot } from "../service/resolution.js";
import { chooseEnvironmentMode, environmentMode, managedMounts } from "../environment/resolution.js";
import type { EnvironmentMode } from "../environment/validators.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { ProjectRegistration } from "../service/validators.js";
import { api } from "../../convex/_generated/api.js";
import { createConvexClient } from "../../lib/config/convex-client.js";
import type { ConfigFile } from "../../lib/config/types.js";
import { mutateConfig, readConfig } from "../../lib/config/toml.js";
import { normalizeConvexUrl } from "../../lib/url.js";
import { resolveSetupProject, validateProjectSelection, type ProjectSelectionOptions } from "../setup/resolution.js";
import { promptApiKey, promptProfileKey, promptUrl } from "../setup/prompts.js";
import { checkLauncher, inspectProjectEnvironment, isProjectEnvironment, prepareProject, projectRequest, projectShell } from "./launcher.js";
import { ProjectAddError, assertChildPath, assertManagedPath, assertNoTraversal, assertDeploymentUrl, validateProfileKey, projectIdentity, registrationIdentity, requireProjectScope, requireVisibleProject, loginRuntimeLabels, type LoginRuntime, type ProjectAccounts, type ProjectEnvironment, type ProjectAddResult, type ProjectCheck } from "./validators.js";
import { projectChecks, sharedProjectChecks, type BackendProbe } from "./formatters.js";
import { authDescriptor } from "../../lib/config/credentials/resolution.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { toConvexSiteUrl } from "../../lib/url.js";

export interface ProjectAddOptions extends ProjectSelectionOptions {
  url?: string;
  apiKey?: string;
  project?: string;
  profileKey?: string;
  reuse?: boolean;
  clone?: string;
  nonInteractive?: boolean;
  /** Only while the environment's mode is still open; spec: docs/specs/cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets */
  mode?: EnvironmentMode;
}

export async function addProjectGuided(directory: string, options: ProjectAddOptions): Promise<ProjectAddResult> {
  const result: ProjectAddResult = { ok: false, registered: false, applied: false, retrySafe: true, phase: "validation" };
  try { await addProject(directory, { ...options, nonInteractive: true }, result); result.ok = true; result.phase = "complete"; }
  catch (error) { if (error instanceof ProjectAddError) result.reason = error.reason; }
  return result;
}

export async function addProject(directory: string, options: ProjectAddOptions, result?: ProjectAddResult): Promise<void> {
  const log = result ? () => {} : (message: string) => console.log(message);
  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY);
  const shared = await chooseEnvironmentMode(options.mode, interactive) === "shared";
  if (shared) requireSharedConfig(readConfig());
  if (shared) assertNoTraversal(directory); else assertChildPath(directory);
  const environment = shared ? undefined : inspectProjectEnvironment();
  validateProjectSelection(options, interactive);
  if (!interactive && (!options.url || !options.apiKey || (!options.project && !options.create) || !options.profileKey)) {
    throw new Error("Non-interactive add requires --url, --api-key, --project (or --create with creation inputs) and --profile-key.");
  }
  // Spec: docs/specs/cli-shared-environments.md#registration
  const mounts = shared ? managedMounts() : undefined;
  const target = environment ? assertChildPath(directory, environment.workspace) : canonicalPath(path.resolve(mounts ? "/workspace" : ".", directory));
  if (mounts) assertManagedPath(target, mounts);
  if (options.profileKey) validateProfileKey(options.profileKey);

  const url = normalizeConvexUrl(options.url ?? await promptUrl());
  assertDeploymentUrl(url);
  const apiKey = options.apiKey ?? await promptApiKey();
  const client = createConvexClient({ url, apiKey, quiet: Boolean(result) });
  try {
    let profileKey = options.profileKey;
    let sourceChecked = false;
    const selection = { ...options };
    const project = await resolveSetupProject(client, selection, interactive, undefined, async () => {
      profileKey ??= await promptProfileKey(path.basename(target).toLowerCase());
      if (!options.profileKey) validateProfileKey(profileKey);
      selection.profileKey = profileKey;
      const config = readConfig();
      if (config.profiles[profileKey]) throw new ProjectAddError("profile-conflict", "Profile already exists. Choose another profile key before creating a project.");
      validateWorkspaceOverlap(config, target);
      if (!shared) await client.query(api.apiKeys.core.validateWorkerSetupKey, {});
      sourceChecked = true;
    }, { log, creating: () => { if (result) { result.phase = "creation"; result.retrySafe = false; } } });
    if (result) { result.projectId = project._id; result.phase = "validation"; result.retrySafe = true; }
    const scope = await client.query(api.apiKeys.core.currentScope, {});
    const broadScope = !shared && (scope?.kind === "unscoped" || (scope?.kind === "organization" && scope.projectIds.length === 0));
    if (shared) requireVisibleProject(scope, project.organizationId, project._id);
    else if (!broadScope) requireProjectScope(scope, project.organizationId, project._id);
    const identity = projectIdentity(url, project.organizationId, project._id);
    const promptedAfterSelection = !profileKey;
    profileKey ??= await promptProfileKey(project.alias.toLowerCase());
    if (promptedAfterSelection) validateProfileKey(profileKey);
    const profile: ProjectRegistration["profile"] = {
      name: options.profileName?.trim() || project.name, url, api_key: apiKey, project_id: project._id, paths: [target],
      ...(shared ? { project_mode: "shared" as const, project_organization: project.organizationId }
        : { project_isolation: { identity, organization_id: project.organizationId } }),
    };
    const registration = { key: profileKey, profile };
    const existing = validateRegistration(readConfig(), registration);
    if (broadScope && !sourceChecked) await client.query(api.apiKeys.core.validateWorkerSetupKey, {});
    if (result) result.phase = "preparation";
    if (!environment) {
      if (!existing) prepareSharedFolder(target, options.clone);
    } else {
      const ready = environment.registrations.find((entry) => entry.identity === identity && entry.path === target && entry.status !== "pending" && entry.status !== "removed");
      if (ready && options.clone && ready.clone !== options.clone) throw new ProjectAddError("clone-mismatch", "Project already exists with a different clone source.");
      if (!ready) {
        const prepared = prepareProject({ identity, path: target, reuse: options.reuse ?? false, clone: options.clone });
        if (prepared.path !== target) throw new Error("Launcher returned a different workspace path.");
      }
    }
    if (result) result.phase = "key";
    let workerKey = apiKey;
    if (broadScope) {
      const candidates = Object.values(readConfig().profiles).filter(saved =>
        saved.project_isolation?.identity === identity && saved.url === url && saved.project_id === project._id);
      let reusableKey: string | undefined;
      for (const saved of candidates) {
        const reusable = await client.query(api.apiKeys.core.canReuseProjectKey, {
          projectId: project._id, keyHash: createHash("sha256").update(saved.api_key).digest("hex"),
        });
        if (reusable) { reusableKey = saved.api_key; break; }
      }
      if (reusableKey) {
        workerKey = reusableKey;
      } else {
        if (result) result.retrySafe = false;
        const issued = await client.mutation(api.apiKeys.core.createProjectKey, { projectId: project._id });
        workerKey = issued.key;
        log(`Issued project worker key ${issued.id}. Manage it in Convoy API Keys; it is retained if registration fails.`);
      }
      const workerClient = createConvexClient({ url, apiKey: workerKey, quiet: Boolean(result) });
      try { requireProjectScope(await workerClient.query(api.apiKeys.core.currentScope, {}), project.organizationId, project._id); }
      finally { await workerClient.close(); }
    }
    profile.api_key = workerKey;
    const save = () => saveProjectRegistration(registration, environment ? undefined : "shared");
    if (result) {
      save();
      result.registered = true; result.retrySafe = true; result.phase = "registration";
    }
    const response = await serviceRequest(servicePaths(undefined, false).socket, { op: "project.add", registration })
      .catch((error) => {
        if (!(error instanceof ServiceUnavailableError)) throw error;
        save();
        return undefined;
      });
    if (result) result.applied = Boolean(response?.applied);
    const logins = shared ? "Runtimes use this account's own logins." : "Runtime authentication belongs in this project's private HOME.";
    log(response
      ? `Registered ${profileKey}. ${response.applied ? "Service applied the registration; inspect project list for connection status." : "Service application is pending; inspect project list and service status."} ${logins}`
      : `Registered ${profileKey} offline. Run convoy service start -b or convoy connect --profile ${profileKey}. ${logins}`);
  } finally {
    await client.close();
  }
}

function overlaps(left: string, right: string): boolean {
  const a = path.resolve(left), b = path.resolve(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

function registrationStatus(registration?: ProjectEnvironment["registrations"][number]): string {
  if (!registration) return "missing";
  if (registration.active) return "running";
  return registration.status ?? "stopped";
}

export async function listProjects(json: boolean): Promise<void> {
  const live = await serviceRequest(servicePaths(undefined, false).socket, { op: "status" }).catch((error) => {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return undefined;
  });
  const environment = environmentMode() === "shared" ? { workspace: "", registrations: [] } : inspectProjectEnvironment();
  const profiles = readConfig().profiles;
  const rows = Object.entries(profiles).flatMap(([key, profile]) => {
    const identity = registrationIdentity(profile);
    if (!identity) return [];
    const registration = environment.registrations.find((item) => item.identity === identity);
    const worker = live?.profiles?.find((item) => item.identity === identity || item.profile === key);
    return [{ profile: key, path: profile.paths[0], uid: registration?.uid,
      status: worker?.status ?? (profile.project_mode ? "stopped" : registrationStatus(registration)), service: Boolean(live),
      activeRuns: worker?.activeRuns, pending: worker?.pending, configurationError: live?.configurationError }];
  });
  for (const registration of environment.registrations) {
    if (Object.values(profiles).some((profile) => profile.project_isolation?.identity === registration.identity)) continue;
    rows.push({ profile: "(no profile)", path: registration.path, uid: registration.uid,
      status: registrationStatus(registration), service: Boolean(live), activeRuns: undefined, pending: undefined, configurationError: live?.configurationError });
  }
  if (json) console.log(JSON.stringify(rows));
  else if (!rows.length) console.log("No registered projects.");
  else console.table(rows);
}

export async function removeProject(key: string, yes: boolean, interrupt = false): Promise<void> {
  if (!yes && (!process.stdin.isTTY || !await confirm({ message: `Unregister ${key}? Files and private state will remain.`, default: false }))) {
    throw new Error("Removal cancelled. Use --yes for non-interactive removal.");
  }
  const response = await serviceRequest(servicePaths(undefined, false).socket, { op: "project.remove", profile: key, interrupt })
    .catch((error) => {
      if (!(error instanceof ServiceUnavailableError)) throw error;
      unregisterProject(key);
      return undefined;
    });
  if (response && !response.applied) throw new Error("Registration removed; service application is pending. Inspect service status.");
  console.log(`Unregistered ${key}. Workspace, worktrees and private state retained.`);
}

/** The launcher's private shell, or for a shared registration `$SHELL` in its folder; with a runtime, only its login. */
export async function openProjectShell(key: string, expectedIdentity?: string, signal?: AbortSignal, login?: LoginRuntime): Promise<void> {
  const profile = readConfig().profiles[key];
  const identity = profile && registrationIdentity(profile);
  if (!identity) throw new Error("No registered project with that profile key.");
  if (expectedIdentity && expectedIdentity !== identity) throw new Error("Project registration changed. Inspect status before opening its shell.");
  await (profile.project_mode ? sharedShell(profile.paths[0], signal, login) : projectShell(identity, signal, login));
}

/** Pause the project in a running service, run only the runtime login, then reload and wait for online. A shared login skips the pause and reload. */
export async function loginProject(key: string, runtime: LoginRuntime, interrupt: boolean, timeout = 60_000, interval = 1000): Promise<void> {
  const profile = readConfig().profiles[key];
  const label = loginRuntimeLabels[runtime];
  if (profile?.project_mode) {
    await sharedShell(profile.paths[0], undefined, runtime);
    console.log(`Logged in to ${label}. The login applies to every project in this environment. Running projects were not restarted; if one does not pick it up, run convoy service reload --profile <key> --interrupt.`);
    return;
  }
  const identity = profile?.project_isolation?.identity;
  if (!identity) throw new Error("No isolated registration with that profile key.");
  const socket = servicePaths(undefined, false).socket;
  const status = await serviceRequest(socket, { op: "status" }).catch((error) => {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    return undefined;
  });
  const worker = status?.profiles?.find((profile) => profile.profile === key);
  if (worker && !worker.paused) {
    if (worker.activeRuns && !interrupt) throw new Error(`${key} has ${worker.activeRuns} active runs. Add --interrupt to stop them and log in.`);
    await serviceRequest(socket, { op: "reconcile", profile: key, interrupt: true, pause: true });
  }
  try { await projectShell(identity, undefined, runtime); }
  catch (error) {
    if (worker) await serviceRequest(socket, { op: "reconcile", profile: key, interrupt: true });
    throw error;
  }
  if (!worker) { console.log(`Logged in to ${label}. Start ${key} with convoy connect --profile ${key} or convoy service start -b.`); return; }
  await serviceRequest(socket, { op: "reconcile", profile: key, interrupt: true });
  for (const deadline = Date.now() + timeout; ;) {
    const current = (await serviceRequest(socket, { op: "status" })).profiles?.find((profile) => profile.profile === key);
    if (current?.status === "online") { console.log(`Logged in to ${label}. ${key} is online.`); return; }
    // A runtime notice can arrive while connecting; only a warning on a later status ends the wait.
    if (!current || (current.warning && current.status !== "connecting") || ["failed", "blocked"].includes(current.status) || Date.now() >= deadline) {
      throw new Error(`Logged in to ${label}, but ${key} is ${current?.status ?? "not registered"}${current?.warning ? `: ${current.warning}` : "."} Inspect convoy service status.`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Read-only preconditions of one project; never prints or returns its key. */
export async function checkProject(key: string): Promise<ProjectCheck> {
  const profile = readConfig().profiles[key];
  const identity = profile && registrationIdentity(profile);
  if (!profile || !identity) throw new Error("No registered project with that profile key.");
  if (profile.project_mode) {
    const holder = lockHolder(leasePath(identity, undefined, false)) ?? null;
    const [runtimes, backend] = await Promise.all([sharedRuntimeStates(), probeBackend(profile.url, profile.api_key)]);
    return { profile: key, checks: sharedProjectChecks(key, { holder, runtimes }, backend) };
  }
  const auth = authDescriptor(new CredentialStore().read(), identity);
  const [facts, backend] = await Promise.all([checkLauncher(identity), probeBackend(profile.url, profile.api_key)]);
  return { profile: key, checks: projectChecks(key, facts, backend, {
    codex: !auth || auth.mode === "native", "claude-code": !auth?.claude, cursor: !auth?.cursor || auth.cursor.mode === "native",
    antigravity: !auth?.antigravity || auth.antigravity.mode === "native", opencode: !auth?.opencode,
  }) };
}

/** A heartbeat without a session: 400 after the key is accepted, 401/403 when it is not. */
async function probeBackend(url: string, apiKey: string): Promise<BackendProbe> {
  try {
    const response = await fetch(`${toConvexSiteUrl(url)}/api/agent/heartbeat`, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000),
    });
    return response.status === 400 ? "ok" : response.status === 401 || response.status === 403 ? "rejected" : { status: response.status };
  } catch { return "unreachable"; }
}

function validateWorkspaceOverlap(config: ConfigFile, target: string, identity?: string) {
  for (const entry of Object.values(config.profiles)) {
    if (identity && registrationIdentity(entry) === identity) continue;
    if (entry.paths.some((root) => overlaps(root, target) || overlaps(`${root}-worktrees`, target) || overlaps(root, `${target}-worktrees`))) {
      throw new ProjectAddError("workspace-overlap", "Workspace overlaps an existing profile or its worktree directory.");
    }
  }
}

export function validateRegistration(config: ConfigFile, registration: ProjectRegistration) {
  const { key: profileKey, profile } = registration;
  const identity = registrationIdentity(profile);
  const target = profile.paths[0];
  if (Buffer.byteLength(JSON.stringify(profile)) > 32768) throw new Error("Project registration is too large.");
  const existing = config.profiles[profileKey];
  if (existing && (registrationIdentity(existing) !== identity || Boolean(existing.project_mode) !== Boolean(profile.project_mode) || existing.paths.length !== 1 || existing.paths[0] !== target)) {
    throw new ProjectAddError("profile-conflict", `Profile "${profileKey}" already belongs to a different registration.`);
  }
  // Aliases of one project share its checkout; another folder would silently switch the worker.
  const alias = Object.entries(config.profiles).find(([key, other]) => key !== profileKey && identity && registrationIdentity(other) === identity);
  if (alias && (alias[1].paths.length !== 1 || alias[1].paths[0] !== target)) {
    throw new ProjectAddError("workspace-overlap", `This project is already registered at ${alias[1].paths[0]} as ${alias[0]}. Use that folder for another profile key.`);
  }
  validateWorkspaceOverlap(config, target, identity);
  return existing;
}

export function saveProjectRegistration(registration: ProjectRegistration, environment: ProjectEnvironment | "shared" = inspectProjectEnvironment()): void {
  const { profile, key } = registration;
  if (environment === "shared") {
    if (!profile.project_mode || profile.project_isolation || profile.paths.length !== 1 || !path.isAbsolute(profile.paths[0])) {
      throw new Error("Registration changed or preparation is incomplete. Repeat project add.");
    }
    mutateConfig((config) => {
      const existing = validateRegistration(config, registration);
      config.profiles[key] = { ...existing, ...profile };
      sharedServiceSnapshot(config);
    });
    return;
  }
  const isolation = profile.project_isolation;
  const ready = environment.registrations.find((entry) => entry.identity === isolation?.identity);
  if (!isolation || projectIdentity(profile.url, isolation.organization_id, profile.project_id) !== isolation.identity ||
      profile.paths.length !== 1 || !ready || ready.status === "pending" || ready.status === "removed" ||
      ready.path !== profile.paths[0] || path.dirname(ready.path) !== environment.workspace || profile.provider_key || profile.codex_provider_key) {
    throw new Error("Registration changed or preparation is incomplete. Repeat project add.");
  }
  mutateConfig((config) => {
    const existing = validateRegistration(config, registration);
    config.profiles[key] = { ...existing, ...profile };
    serviceSnapshot(config, environment);
  });
}

export function projectRemoval(key: string) {
  const config = readConfig();
  const identity = config.profiles[key] && registrationIdentity(config.profiles[key]);
  if (!identity) throw new Error("No registered project with that profile key.");
  return { identity, last: !Object.entries(config.profiles).some(([otherKey, other]) =>
    otherKey !== key && registrationIdentity(other) === identity) };
}

export function unregisterProject(key: string, expectedIdentity?: string): void {
  mutateConfig((config) => {
    const profile = config.profiles[key];
    const identity = profile && registrationIdentity(profile);
    if (!identity) throw new Error("No registered project with that profile key.");
    if (expectedIdentity && expectedIdentity !== identity) throw new Error("Registration changed. Inspect project list before retrying.");
    const hasOtherProfile = Object.entries(config.profiles).some(([otherKey, other]) =>
      otherKey !== key && registrationIdentity(other) === identity);
    // Without the launcher registry there is no entry to disable, so removal stays possible for recovery.
    if (!hasOtherProfile && profile.project_isolation && isProjectEnvironment()) projectRequest({ action: "remove", identity });
    delete config.profiles[key];
    if (config.settings?.default_profile === key) delete config.settings.default_profile;
  });
}

export async function readProjectAccounts(key: string, expectedIdentity: string): Promise<ProjectAccounts> {
  const profile = readConfig().profiles[key];
  const identity = profile && registrationIdentity(profile);
  if (!identity || identity !== expectedIdentity) throw new Error("Project registration changed. Refresh before checking accounts.");
  if (!profile.project_mode) return projectAccounts(identity);
  const { codex, "claude-code": claude } = await sharedRuntimeStates();
  return { codex: { status: codex.login }, "claude-code": { status: claude.login } };
}

/** Guard: a shared environment never runs isolated registrations. Spec: docs/specs/cli-shared-environments.md#mode */
function requireSharedConfig(config: ConfigFile): void {
  if (Object.values(config.profiles).some(profile => profile.project_isolation)) {
    throw new Error("This environment is shared, but config.toml holds isolated registrations, which need the project launcher. Reinstall the launcher, or remove them with convoy project remove <profile>.");
  }
}

/** Shared registration uses the folder as this account: reuse it, create it, or clone into it over HTTPS. */
function prepareSharedFolder(target: string, clone?: string): void {
  if (clone) {
    const source = new URL(clone);
    if (source.protocol !== "https:" || source.username || source.password) throw new ProjectAddError("path", "Clone sources must be HTTPS URLs without embedded credentials.");
    if (existsSync(target) && readdirSync(target).length) throw new ProjectAddError("path", "The clone target already exists and is not empty.");
    mkdirSync(path.dirname(target), { recursive: true });
    const result = spawnSync("git", ["clone", "--", source.href, target], { stdio: ["ignore", "ignore", "pipe"], timeout: 300_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (result.status !== 0) throw new ProjectAddError("path", "git clone failed. Check the URL and your git credentials, then retry.");
    return;
  }
  if (existsSync(target)) {
    if (!statSync(target).isDirectory()) throw new ProjectAddError("path", "The project path exists and is not a folder.");
    return;
  }
  mkdirSync(target, { recursive: true });
}

/** Resolves symlinks through the deepest existing ancestor, so overlap checks compare physical folders. */
function canonicalPath(target: string): string {
  const missing: string[] = [];
  let existing = target;
  while (!existsSync(existing) && path.dirname(existing) !== existing) { missing.unshift(path.basename(existing)); existing = path.dirname(existing); }
  return path.join(realpathSync(existing), ...missing);
}
