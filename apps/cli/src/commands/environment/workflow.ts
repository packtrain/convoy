import { RUNTIME_BINARIES, RUNTIME_PROBE, offeredVersion, parseRuntimeVersions, publishedVersion, runtimeState } from "./resolution.js";
import { TESTED_BUILDS, runtimeInstall, runtimeLabel } from "../project/formatters.js";
import type { LoginRuntime } from "../project/validators.js";
import type { RuntimeVersion } from "./validators.js";
import { environmentFormSchema, type EnvironmentProposal, type EnvironmentForm, type EnvironmentMaintenance, type EnvironmentProgress } from "./validators.js";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getBundledTemplateDir } from "../devcontainer/install.js";
import { getCliVersion } from "../../lib/version.js";
import { docker, helperArgs, type Docker } from "./docker.js";
import { environmentDirectory, readEnvironment, resolveMounts, saveEnvironment, withEnvironmentLock } from "./paths.js";
import { readRemotes } from "../remote/paths.js";
import { z } from "zod";
import { dockerInfoSchema, targetStatusSchema, containerSchema, volumeSchema, LABEL, OWNER, isolatedMounts, sharedMounts, retiredMounts, volumeMounts, containerName, environmentName, packageVersion, type Environment, type EnvironmentMode } from "./validators.js";

/** Starts the service whenever Docker starts the container, as after a host reboot. Spec: docs/specs/cli-environments.md#restart-after-a-reboot */
const BOOT = "python3 -I /usr/local/libexec/convoy-environment start || echo 'The Convoy service did not start. Start the environment from the TUI.' >&2; exec sleep infinity";

/** Validated host folders; isolated environments take none. Spec: docs/specs/cli-shared-environments.md#host-folder-mounts */
function checkedMounts(mode: EnvironmentMode | undefined, folders: string[] = []) {
  if (folders.length && mode !== "shared") throw new Error("Isolated environments can't mount host folders, because per-project accounts don't fit host file ownership. Use --mode shared.");
  return resolveMounts(folders);
}
/** On a Linux host the shared image's `node` takes the host user's ids, so files in mounts stay the user's. */
function hostIds() {
  const uid = process.getuid?.(), gid = process.getgid?.();
  return process.platform === "linux" && uid && gid && (uid !== 1000 || gid !== 1000) ? { uid, gid } : undefined;
}

export class EnvironmentController {
  constructor(readonly execute: Docker = docker, readonly report: (text: string) => void = console.error) {}

  async daemon() {
    let info: { ID?: string; OSType?: string };
    try { info = dockerInfoSchema.parse(JSON.parse(await this.execute(["info", "--format", "{{json .}}"]))); }
    catch { throw new Error("Docker is unavailable. Start Docker Desktop or Docker Engine, then retry."); }
    if (!info.ID || info.OSType !== "linux") throw new Error("Managed projects require a Linux Docker engine.");
    return info.ID;
  }
  async container(environment: Environment) {
    if (await this.daemon() !== environment.daemon) throw new Error("This environment belongs to a different Docker daemon. Restore the original Docker context.");
    const name = containerName(environment);
    const ids = await this.execute(["container", "ls", "-aq", "--filter", `name=^/${name}$`]);
    if (!ids) return undefined;
    const value = containerSchema.parse(JSON.parse(await this.execute(["container", "inspect", name])))[0];
    if (value.Config.Labels?.[OWNER] !== environment.owner || value.Config.Labels?.[LABEL] !== environment.name) throw new Error("Container ownership does not match. No container was changed.");
    return value;
  }
  async volumes(environment: Environment) {
    for (const kind of Object.keys(volumeMounts(environment))) {
      const name = `${containerName(environment)}-${kind}`;
      const found = await this.execute(["volume", "ls", "-q", "--filter", `name=^${name}$`]);
      if (!found) await this.execute(["volume", "create", "--label", `${OWNER}=${environment.owner}`, "--label", `${LABEL}=${environment.name}`, name]);
      const volume = volumeSchema.parse(JSON.parse(await this.execute(["volume", "inspect", name])))[0];
      if (volume.Labels?.[OWNER] !== environment.owner || volume.Labels?.[LABEL] !== environment.name) throw new Error("Volume ownership does not match. No data was changed.");
    }
  }
  async build(environment: Environment, localPackage?: string) {
    // Fail before the long image build when npm lacks the release, e.g. a source checkout.
    if (!localPackage) await publishedVersion(environment.version).catch((error: Error) => {
      throw new Error(`${error.message} To build from source, pack the CLI (pnpm pack in apps/cli) and pass --package <tgz>.`);
    });
    const context = mkdtempSync(join(tmpdir(), "convoy build "));
    try {
      const templates = getBundledTemplateDir();
      cpSync(resolve(templates, "../project-isolation"), context, { recursive: true });
      cpSync(join(templates, "init-firewall.sh"), join(context, "init-firewall.sh"));
      let file = readFileSync(join(context, "Dockerfile"), "utf8");
      if (localPackage) {
        cpSync(resolve(localPackage), join(context, "convoy.tgz"));
        file = file.replace("RUN npm install --prefix", "COPY convoy.tgz /tmp/convoy.tgz\nRUN npm install --prefix")
          .replace("@useconvoy/cli@${CONVOY_VERSION}", "/tmp/convoy.tgz");
      }
      const ids = environment.mode === "shared" ? hostIds() : undefined;
      file += '\nUSER root\nCOPY environment.py /usr/local/libexec/convoy-environment\nRUN mkdir -p /home/node/.convoy && chown node:node /home/node/.convoy && chmod 0700 /home/node/.convoy\n'
        + (ids ? `RUN groupmod -o -g ${ids.gid} node && usermod -o -u ${ids.uid} -g ${ids.gid} node\n` : "")
        + (environment.mode === "shared" ? "RUN chown -R node:node /home/node /workspace\n" : "")
        + `COPY convoy-environment.json /etc/convoy-environment.json\nENTRYPOINT ${JSON.stringify(["/bin/sh", "-c", BOOT])}\n`;
      writeFileSync(join(context, "Dockerfile"), file);
      writeFileSync(join(context, "convoy-environment.json"), JSON.stringify({ mode: environment.mode ?? "isolated", mounts: environment.mounts ?? [] }));
      this.report(`Building environment ${environment.name}, CLI ${environment.version}…`);
      await this.execute(["build", "--build-arg", `CONVOY_VERSION=${environment.version}`, "--tag", `${containerName(environment)}:managed`, context], { progress: true, timeout: 1_800_000 });
    } finally { rmSync(context, { recursive: true, force: true }); }
  }
  async create(environment: Environment) {
    const binds = checkedMounts(environment.mode, environment.mounts);
    await this.volumes(environment);
    const seccomp = resolve(getBundledTemplateDir(), "../project-isolation/seccomp.json");
    await this.execute(["create", "--name", containerName(environment), "--init", "--restart", "unless-stopped",
      "--label", `${OWNER}=${environment.owner}`, "--label", `${LABEL}=${environment.name}`,
      "--security-opt", `seccomp=${seccomp}`, "--security-opt", "apparmor=unconfined",
      "--security-opt", "systempaths=unconfined",
      "--cap-add=NET_ADMIN", "--cap-add=NET_RAW", "--log-opt", "max-size=5m", "--log-opt", "max-file=2",
      ...Object.entries(volumeMounts(environment)).flatMap(([kind, target]) => ["--mount", `type=volume,source=${containerName(environment)}-${kind},target=${target}`]),
      ...binds.flatMap(folder => ["--mount", `type=bind,source=${folder},target=${folder}`]),
      "--env", `DEVCONTAINER_NETWORK_MODE=${environment.networkMode ?? "strict"}`, "--env", `CONVEX_DEPLOYMENT=${environment.deployment}`,
      "--env", `DEVCONTAINER_EXTRA_ALLOWED_DOMAINS=${environment.domains}`, `${containerName(environment)}:managed`]);
  }
  async start(environment: Environment, localPackage?: string) {
    let container = await this.container(environment);
    if (!container) { await this.build(environment, localPackage); await this.create(environment); container = await this.container(environment); }
    if (!container?.State.Running) await this.execute(["start", containerName(environment)]);
    await this.execute(helperArgs(environment, "start"), { progress: true, timeout: 180_000 });
  }
  private async installedRuntimes(environment: Environment) {
    const container = await this.container(environment);
    if (!container?.State.Running) throw new Error("Environment is stopped. Start environment from Actions, then check runtimes again.");
    return parseRuntimeVersions(await this.execute(["exec", "--user", "node", containerName(environment), "sh", "-c", RUNTIME_PROBE], { timeout: 120_000 }));
  }
  /** Installed and offered version per agent runtime. Spec: docs/specs/cli-tui.md#agent-runtimes-cli-01240-os-2236 */
  async runtimes(environment: Environment, request: typeof fetch = fetch): Promise<RuntimeVersion[]> {
    const installed = await this.installedRuntimes(environment);
    return Promise.all((Object.keys(RUNTIME_BINARIES) as LoginRuntime[]).map(async runtime => {
      const row = { runtime, label: runtimeLabel(runtime), installed: installed[runtime] };
      try { const offered = await offeredVersion(runtime, request); return { ...row, offered, state: runtimeState(row.installed, offered) }; }
      catch (error) { return { ...row, state: "unknown" as const, error: error instanceof Error ? error.message : "Version lookup failed." }; }
    }));
  }
  /** Root install of the exact offered version; returns the version the runtime then reports. */
  async installRuntime(environment: Environment, runtime: LoginRuntime, version: string) {
    packageVersion.parse(version);
    if (TESTED_BUILDS[runtime] && version !== TESTED_BUILDS[runtime]) throw new Error(`${runtimeLabel(runtime)} installs only its tested build.`);
    const container = await this.container(environment);
    if (!container?.State.Running) throw new Error("Environment is stopped. Start environment from Actions, then retry.");
    await this.execute(["exec", "--user", "root", containerName(environment), "sh", "-c", runtimeInstall(runtime, version)], { progress: true, timeout: 900_000 });
    const reported = (await this.installedRuntimes(environment))[runtime];
    if (reported !== version) throw new Error(`${runtimeLabel(runtime)} reports ${reported ?? "no version"} after install, not ${version}.`);
    return reported;
  }
  async operation(environment: Environment, operation: "delete" | "status" | "stop" | "service-stop" | "restart" | "update" | "rebuild", options: { version?: string; interrupt?: boolean; localPackage?: string; mounts?: string[] } = {}): Promise<Record<string, unknown>> {
    const container = await this.container(environment);
    if (operation === "status") {
      if (!container?.State.Running) return { environment: environment.name, hostVersion: getCliVersion(), state: container ? "stopped" : "not-created", selectedVersion: environment.version };
      const target = targetStatusSchema.parse(JSON.parse(await this.execute(helperArgs(environment, "status"))));
      if (target.serviceVersion) environment.version = target.serviceVersion;
      return { environment: environment.name, hostVersion: getCliVersion(), state: "running", ...target };
    }
    if (operation === "delete") {
      if (!options.interrupt) throw new Error("Use --interrupt to delete this environment and all saved data.");
      const volumes: string[] = [];
      for (const kind of new Set([...Object.keys(isolatedMounts), ...Object.keys(sharedMounts), ...retiredMounts])) {
        const name = `${containerName(environment)}-${kind}`;
        const found = await this.execute(["volume", "ls", "-q", "--filter", `name=^${name}$`]);
        if (!found) continue;
        const volume = volumeSchema.parse(JSON.parse(await this.execute(["volume", "inspect", name])))[0];
        if (volume.Labels?.[OWNER] !== environment.owner || volume.Labels?.[LABEL] !== environment.name) throw new Error("Volume ownership does not match. No data was changed.");
        volumes.push(name);
      }
      if (container?.State.Running) {
        await this.execute(helperArgs(environment, "stop"), { timeout: 60_000 });
        await this.execute(["stop", "--time", "45", containerName(environment)]);
      }
      if (container) await this.execute(["rm", containerName(environment)]);
      for (const name of volumes) await this.execute(["volume", "rm", name]);
      return { deleted: true, environment: environment.name };
    }
    if (!container && operation === "stop") return { stopped: true, state: "not-created", dataRetained: true };
    if (!container) throw new Error("Environment has not been created. Run convoy run first.");
    if (["restart", "update", "rebuild"].includes(operation) && !options.interrupt) throw new Error("Use --interrupt to allow stopping this environment's connections and active work.");
    if (operation === "service-stop") {
      if (container.State.Running) await this.execute(helperArgs(environment, "stop"), { timeout: 60_000 });
      return { serviceStopped: true, containerRetained: true };
    }
    if (operation === "stop") {
      if (container.State.Running) {
        await this.execute(helperArgs(environment, "stop"), { timeout: 60_000 });
        await this.execute(["stop", "--time", "45", containerName(environment)]);
      }
      return { stopped: true, dataRetained: true };
    }
    if (!container.State.Running) throw new Error("Environment is stopped. Run convoy run first.");
    if (operation === "rebuild") {
      // Check every mount before touching the container; the record changes only once the old one is gone.
      const next = checkedMounts(environment.mode, options.mounts ?? environment.mounts);
      if (options.mounts) await this.requireProjectsKept(environment, next);
      const replaced = { ...environment, mounts: next.length ? next : undefined };
      await this.build(replaced, options.localPackage);
      // ponytail: reread after the minutes-long build; a project added in the seconds before stop can still slip through.
      if (options.mounts) await this.requireProjectsKept(environment, next);
      await this.execute(helperArgs(environment, "stop"));
      await this.execute(["stop", "--time", "45", containerName(environment)]);
      await this.execute(["rm", containerName(environment)]);
      environment.mounts = replaced.mounts;
      await this.create(environment);
      await this.start(environment);
    } else if (operation === "update") {
      if (Boolean(options.version) === Boolean(options.localPackage)) throw new Error("Choose exactly one of --version or --package.");
      if (options.localPackage) {
        const source = resolve(options.localPackage);
        if (!statSync(source).isFile()) throw new Error("--package must name a local package file.");
        const destination = `/tmp/convoy-update-${randomUUID()}.tgz`;
        try {
          await this.execute(["cp", source, `${containerName(environment)}:${destination}`]);
          await this.execute(helperArgs(environment, "update-package", destination), { progress: true, timeout: 1_800_000 });
        } finally {
          await this.execute(["exec", "--user", "root", containerName(environment), "rm", "-f", destination])
            .catch(() => { console.error(`Could not remove temporary package ${destination} from the container.`); });
        }
      } else {
        const version = packageVersion.parse(options.version);
        await this.execute(helperArgs(environment, "update", version), { progress: true, timeout: 1_800_000 });
        environment.version = version;
      }
    } else await this.execute(helperArgs(environment, "restart"), { progress: true, timeout: 120_000 });
    return this.operation(environment, "status");
  }

  /** Refuses new mounts that would drop a registered project's folder. */
  private async requireProjectsKept(environment: Environment, next: string[]) {
    const dropped = (environment.mounts ?? []).filter(folder => !next.some(kept => folder === kept || folder.startsWith(kept + "/")));
    if (!dropped.length) return;
    const projects = z.array(z.object({ profile: z.string(), path: z.string().optional() })).parse(JSON.parse(
      await this.execute(["exec", "--user", "node", containerName(environment), "convoy", "project", "list", "--json"])));
    const lost = projects.find(project => project.path && dropped.some(folder => project.path!.startsWith(folder + "/")) && !next.some(kept => project.path!.startsWith(kept + "/")));
    if (lost) throw new Error(`Project ${lost.profile} at ${lost.path} needs the mounted folder you are dropping. Remove the project first, or keep the folder.`);
  }
}

export async function loadEnvironment(name: string, controller = new EnvironmentController()) {
  const environment = readEnvironment(environmentDirectory(name));
  if (!environment) throw new Error(`Environment ${name} is unknown. Run convoy run --environment ${name}.`);
  const container = await controller.container(environment);
  if (!container?.State.Running) throw new Error(`Environment ${name} is stopped. Run convoy run --environment ${name}.`);
  return environment;
}

export async function runEnvironment(name: string, options: { deployment?: string; domains?: string; networkMode?: Environment["networkMode"]; mode?: EnvironmentMode; mounts?: string[]; localPackage?: string; beforeStart?: (environment: Environment, created: boolean) => Promise<void> }, controller = new EnvironmentController()) {
  environmentName.parse(name);
  const directory = environmentDirectory(name);
  return withEnvironmentLock(directory, async () => {
    let environment = readEnvironment(directory);
    const created = !environment;
    if (!environment) {
      if (readRemotes().some(remote => remote.name === name)) throw new Error(`Remote ${name} already uses this name, so --target ${name} would be ambiguous. Choose another name.`);
      const mode = options.mode ?? "shared", mounts = checkedMounts(mode, options.mounts);
      environment = { schema: 1, name, owner: randomUUID(), daemon: await controller.daemon(), version: getCliVersion(), networkMode: options.networkMode, mode,
        ...(mounts.length ? { mounts } : {}), deployment: options.deployment ?? "", domains: options.domains ?? "" };
    } else if (options.mode !== undefined && options.mode !== (environment.mode ?? "isolated")) {
      throw new Error(`Environment ${name} is ${environment.mode ?? "isolated"}. Choose a new environment name for a ${options.mode} one.`);
    } else if (options.mounts !== undefined && JSON.stringify(checkedMounts(environment.mode, options.mounts)) !== JSON.stringify(environment.mounts ?? [])) {
      throw new Error(`Environment ${name} has other mounted folders. Change them with convoy environment rebuild --env ${name} --mount <folder> --interrupt.`);
    } else if ((options.networkMode !== undefined && options.networkMode !== (environment.networkMode ?? "strict")) || (options.deployment !== undefined && options.deployment !== environment.deployment) || (options.domains !== undefined && options.domains !== environment.domains)) {
      throw new Error("This environment already has a network configuration. Choose a new environment name for different deployment/domain settings.");
    }
    await options.beforeStart?.(environment, created);
    if (created) saveEnvironment(directory, environment);
    await controller.start(environment, options.localPackage);
    await controller.operation(environment, "status");
    saveEnvironment(directory, environment);
    return environment;
  });
}

/** Host TUI adapter. All mutations retain the controller's ownership and recovery checks. */
export function environmentMaintenance(expected: Environment, home?: string): EnvironmentMaintenance {
  const directory = environmentDirectory(expected.name, home, false);
  const current = () => {
    const value = readEnvironment(directory);
    if (!value || value.owner !== expected.owner || value.daemon !== expected.daemon) throw new Error("Environment identity changed. Reopen the TUI before continuing.");
    return value;
  };
  const controller = (progress: EnvironmentProgress) => new EnvironmentController(
    (args, options) => docker(args, { ...options, onProgress: progress }), progress);
  const status = () => withEnvironmentLock(directory, async () => {
    const environment = current();
    const result = await controller(() => {}).operation(environment, "status");
    saveEnvironment(directory, environment);
    return result;
  });
  return {
    status,
    release: async () => {
      const result = await status();
      if (typeof result.serviceVersion !== "string") throw new Error("Installed target version unknown. Start the environment and inspect status before updating.");
      return { installed: result.serviceVersion, proposed: await publishedVersion(getCliVersion(), result.serviceVersion) };
    },
    runtimes: () => withEnvironmentLock(directory, () => controller(() => {}).runtimes(current())),
    installRuntime: (runtime, version, progress) => withEnvironmentLock(directory, () => controller(progress).installRuntime(current(), runtime, version)),
    execute: (operation, progress, options = {}) => withEnvironmentLock(directory, async () => {
      const environment = current();
      const control = controller(progress);
      if (operation === "update") {
        const before = await control.operation(environment, "status");
        if (typeof before.serviceVersion !== "string") throw new Error("Installed target version unknown. Start the environment before updating.");
        if (options.version !== getCliVersion()) throw new Error("Proposed release changed. Check for updates again.");
        await publishedVersion(options.version, before.serviceVersion);
      }
      progress(`${operation}: ${environment.name}${options.version ? ` → ${options.version}` : ""}`);
      let result: Record<string, unknown>;
      if (operation === "start") { await control.start(environment); result = await control.operation(environment, "status"); }
      else result = await control.operation(environment, operation, { ...options, interrupt: true });
      if (["start", "restart", "update"].includes(operation) && result.serviceRunning !== true) throw new Error("Service readiness was not confirmed. Inspect status, then Start to recover.");
      if (operation === "update" && result.serviceVersion !== options.version) throw new Error("The installed version does not match the proposed release. Inspect status and recovery before retrying.");
      if (typeof result.serviceVersion === "string") environment.version = packageVersion.parse(result.serviceVersion);
      if (operation === "delete") rmSync(join(directory, "environment.json"));
      else saveEnvironment(directory, environment);
      return result;
    }),
  };
}

/** `localPackage` installs a packed CLI instead of the npm release when the container is built. */
export async function prepareEnvironment(form: EnvironmentForm, controller = new EnvironmentController(), localPackage?: string): Promise<EnvironmentProposal> {
  environmentFormSchema.parse(form);
  let saved: Environment | undefined;
  try { saved = readEnvironment(environmentDirectory(form.name, undefined, false)); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (!saved) {
    const mode = form.mode ?? "shared", mounts = checkedMounts(mode, form.mounts);
    return { ...form, mode, ...(mounts.length ? { mounts } : { mounts: undefined }), version: getCliVersion(), install: true, ...(localPackage ? { localPackage } : {}) };
  }
  if (form.mode !== undefined && form.mode !== (saved.mode ?? "isolated")) throw new Error(`Environment ${form.name} is ${saved.mode ?? "isolated"}. Choose a new name for a ${form.mode} one.`);
  if (form.mounts?.length && JSON.stringify(checkedMounts(saved.mode, form.mounts)) !== JSON.stringify(saved.mounts ?? [])) {
    throw new Error(`Environment ${form.name} has other mounted folders. Change them with convoy environment rebuild --env ${form.name} --mount <folder> --interrupt.`);
  }
  if ((form.networkMode !== undefined && form.networkMode !== (saved.networkMode ?? "strict")) || (form.deployment && form.deployment !== saved.deployment) || (form.domains && form.domains !== saved.domains)) {
    throw new Error("This environment already has a network configuration. Choose a new name for different settings.");
  }
  const status = await controller.operation(saved, "status");
  return { name: form.name, ...(saved.networkMode ? { networkMode: saved.networkMode } : {}), mode: saved.mode ?? "isolated", ...(saved.mounts ? { mounts: saved.mounts } : {}), deployment: saved.deployment, domains: saved.domains, owner: saved.owner, daemon: saved.daemon,
    version: packageVersion.parse(status.serviceVersion ?? saved.version), install: status.state === "not-created", ...(localPackage && status.state === "not-created" ? { localPackage } : {}) };
}

export async function provisionEnvironment(form: EnvironmentForm, progress: EnvironmentProgress, proposal?: EnvironmentProposal) {
  const controller = new EnvironmentController((args, options) => docker(args, { ...options, onProgress: progress }), progress);
  const confirmed = proposal ?? await prepareEnvironment(form, controller);
  return runEnvironment(form.name, { networkMode: form.networkMode, mode: form.mode, mounts: form.mounts?.length ? form.mounts : undefined, deployment: form.deployment || undefined, domains: form.domains || undefined, localPackage: confirmed.localPackage,
    beforeStart: async (environment, created) => {
      if (created !== !confirmed.owner || (confirmed.owner && (environment.owner !== confirmed.owner || environment.daemon !== confirmed.daemon)) || (environment.networkMode ?? "strict") !== (confirmed.networkMode ?? "strict") || environment.deployment !== confirmed.deployment || environment.domains !== confirmed.domains
        || (environment.mode ?? "isolated") !== (confirmed.mode ?? "isolated") || JSON.stringify(environment.mounts ?? []) !== JSON.stringify(confirmed.mounts ?? [])) throw new Error("Environment changed. Review the target again.");
      const status = created ? undefined : await controller.operation(environment, "status");
      const version = packageVersion.parse(status?.serviceVersion ?? environment.version);
      const install = created || status?.state === "not-created";
      if (version !== confirmed.version || install !== confirmed.install) throw new Error("Environment version or container changed. Review the target again.");
      environment.version = version;
      if (install && !confirmed.localPackage) await publishedVersion(version).catch((error: Error) => {
        throw new Error(`${error.message} To test a local build, pack the CLI (pnpm pack in apps/cli) and start convoy tui --package <tgz>.`);
      });
    },
  }, controller);
}
