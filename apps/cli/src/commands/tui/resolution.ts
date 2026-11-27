import type { EnvironmentProposal, EnvironmentMaintenance, EnvironmentForm, EnvironmentProgress } from "../environment/validators.js";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ServiceLogs } from "../service/logs.js";
import { startService } from "../service/command.js";
import { addLocalProject, isProjectEnvironment } from "../project/launcher.js";
import type { LogEntry } from "../service/validators.js";
import { ServiceClient } from "../service/client.js";
import { servicePaths } from "../service/paths.js";
import { bridge, docker, helperArgs } from "../environment/docker.js";
import { prepareEnvironment, environmentMaintenance, provisionEnvironment, EnvironmentController } from "../environment/workflow.js";
import { containerName, environmentName, type EnvironmentMode, type Prerequisite } from "../environment/validators.js";
import { applyEnvironmentMode, environmentMode, localModeSetup, modeChoiceOpen } from "../environment/resolution.js";
import { environmentDirectory, readEnvironment, withEnvironmentLock } from "../environment/paths.js";
import { targetCommands } from "../environment/index.js";
import { readRemotes, remoteTarget } from "../remote/index.js";
import { supportsGuidedProject, addTargetProjectGuided } from "../environment/projects.js";
import type { ProjectAddOptions } from "../project/workflow.js";
import { unavailableProjectResult, type LoginRuntime, type ProjectAddResult, type ProjectCheck, type ProjectAccounts } from "../project/validators.js";
import { checkProject, openProjectShell, projectRepos, readProjectAccounts } from "../project/workflow.js";
import type { DiscoveredRepo } from "../../lib/git/index.js";
import { localManagedStatus } from "../keys/workflow.js";
import type { ManagedCredentialStatus } from "../../lib/config/credentials/validators.js";
export interface Connection {
  /** Local's mode, or a managed Docker record's; a shared target logs in without pausing or reloading its projects. */
  mode?: EnvironmentMode;
  /** Local's first-setup mode choice; `apply` saves the mode, installing the launcher for isolated. */
  chooseMode?: { open(): boolean; checks(): Promise<Prerequisite[]>; apply(mode: EnvironmentMode, log: (line: string) => void): Promise<void> };
  /** Managed runtime credential store of this environment; absent where none exists. */
  credentials?: { status(): Promise<ManagedCredentialStatus>; allowDomain?(host: string): Promise<void> };
  maintenance?: EnvironmentMaintenance;
  checkProject?: () => Promise<boolean>;
  /** Shown by Add project when this target cannot register projects here, or its CLI is too old to. */
  addProjectUnavailable?: string;
  addProject?: (directory: string, options: ProjectAddOptions) => Promise<ProjectAddResult>;
  /** The git repos Add project's review lists for a reused folder. */
  repos?: (directory: string) => Promise<DiscoveredRepo[]>;
  id: string;
  name: string;
  transport: string;
  endpoint: string;
  /** Project shell (private when isolated); with a runtime, only that runtime's login runs in it. */
  shell?: (profile: string, identity?: string, signal?: AbortSignal, login?: LoginRuntime) => Promise<void>;
  /** Read-only `project check` on this target. */
  account?: (profile: string, identity: string) => Promise<ProjectAccounts>;
  check?: (profile: string) => Promise<ProjectCheck>;
  start?: () => Promise<void>;
  startUnavailable?: string;
  savedLogs?: (after: number, profile?: string) => Promise<{ entries: LogEntry[]; cursor: number; gap: boolean }>;
  open(signal: AbortSignal): Promise<ServiceClient>;
}

export function connections(selected?: string, home = homedir()): { targets: Connection[]; selected: number; warnings: string[] } {
  const warnings: string[] = [];
  let mode: EnvironmentMode | undefined;
  if (home === homedir()) {
    try { mode = environmentMode(home); } catch (error) { warnings.push(error instanceof Error ? error.message : "Cannot read the environment record."); }
  }
  // Shared mode registers and starts projects without the launcher. Spec: docs/specs/cli-shared-environments.md
  const isolated = mode === "isolated" && isProjectEnvironment();
  const runnable = mode === "shared" || isolated;
  const targets: Connection[] = [{
    id: "local", name: "Local", transport: "unix", endpoint: join(home, ".convoy/service/control.sock"),
    addProject: runnable ? addLocalProject : undefined,
    // An isolated project's folder is private to its account; its worker reports the repos.
    repos: mode === "shared" ? projectRepos : undefined,
    start: runnable && Boolean(process.getuid?.()) ? () => startService(true, true) : undefined,
    mode,
    chooseMode: {
      open: () => modeChoiceOpen({ ...localModeSetup(), home }),
      checks: () => localModeSetup().checks(),
      apply: (mode, log) => applyEnvironmentMode(mode, { ...localModeSetup(), home, log }),
    },
    shell: runnable ? async (profile, expectedIdentity, signal, login) => {
      if (!expectedIdentity) throw new Error("Project registration changed. Inspect status before opening its shell.");
      await openProjectShell(profile, expectedIdentity, signal, login);
    } : undefined,
    credentials: runnable ? { status: localManagedStatus } : undefined,
    account: runnable ? readProjectAccounts : undefined,
    check: runnable ? checkProject : undefined,
    startUnavailable: mode === "isolated" ? "Start requires the control account in a configured Linux project environment." : "Start the service as your own account, not root.",
    savedLogs: async (after, profile) => new ServiceLogs(servicePaths(home, false).directory, undefined, "reader").read(after, profile),
    open: signal => ServiceClient.open(servicePaths(home, false).socket, signal),
  }];
  const directory = join(home, ".convoy/environments");
  let names: string[] = [];
  try { names = readdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("Cannot list managed environments. Check directory permissions."); }
  for (const name of names.sort()) {
    if (!environmentName.safeParse(name).success || !existsSync(join(directory, name, "environment.json"))) continue;
    const read = () => {
      const environment = readEnvironment(environmentDirectory(name, home, false));
      if (!environment || environment.name !== name) throw new Error("Invalid environment identity");
      return environment;
    };
    try {
      const environment = read();
      const running = async () => {
        const current = read();
        const container = await new EnvironmentController().container(current).catch(() => {
          throw new Error("Docker host unavailable or environment identity changed. Inspect environment status.");
        });
        if (!container?.State.Running) throw new Error("Container unavailable. Start the environment outside this TUI; the service cannot be inspected here.");
        return current;
      };
      targets.push({
        maintenance: environmentMaintenance(environment, home),
        checkProject: async () => supportsGuidedProject(await running()),
        repos: async directory => targetCommands.repos(await running(), directory),
        mode: environment.mode ?? "isolated",
        id: name, name, transport: "docker", endpoint: `docker exec ${containerName(environment)} /home/node/.convoy/service/control.sock`,
        addProject: async (directory, options) => {
          let started = false;
          try {
            return await withEnvironmentLock(environmentDirectory(name, home, false), async () => {
              const current = await running();
              if (current.owner !== environment.owner || current.daemon !== environment.daemon) throw new Error("Environment changed.");
              started = true;
              return addTargetProjectGuided(current, directory, options);
            });
          } catch (error) { if (!started) return unavailableProjectResult(); throw error; }
        },
        start: () => withEnvironmentLock(environmentDirectory(name, home, false), async () => {
          const current = await running();
          await docker(helperArgs(current, "start"), { timeout: 180_000 }).catch(() => {
            throw new Error("Service start failed or outcome unknown. Inspect service status before retrying.");
          });
        }),
        shell: (profile, expectedIdentity, signal, login) => targetCommands.shell(read(), profile, { expectedIdentity, signal, home, login }),
        // Quiet: helper diagnostics written to stderr would tear the Ink frame.
        account: async (profile, identity) => targetCommands.account(await running(), profile, identity),
        check: async profile => targetCommands.check(await running(), profile, false),
        credentials: {
          status: async () => targetCommands.credentialStatus(await running()),
          // Quiet, unlike `keys add`: helper progress written to stderr would tear the Ink frame.
          allowDomain: host => withEnvironmentLock(environmentDirectory(name, home, false), async () => {
            await docker(helperArgs(await running(), "allow-domain", host), { timeout: 180_000 });
          }),
        },
        savedLogs: async (after, profile) => {
          const current = await running();
          const retained = await targetCommands.operationalLogs(current, profile, false).catch(() => {
            throw new Error("Saved service logs unavailable in the running container. Check CLI compatibility and file permissions.");
          });
          const entries = retained.filter(entry => entry.seq > after).slice(0, 100);
          return { entries, cursor: entries.at(-1)?.seq ?? after, gap: after > 0 && after < (retained[0]?.seq ?? 1) - 1 };
        },
        open: async signal => {
          const controller = new EnvironmentController((args, options) => docker(args, { ...options, signal }));
          const current = read();
          const container = await controller.container(current);
          if (!container?.State.Running) throw new Error("Managed environment is stopped.");
          signal.throwIfAborted();
          return ServiceClient.open(bridge(current), signal);
        },
      });
    } catch {
      const warning = `Cannot read managed environment ${name}. Check its private environment.json.`;
      if (name === selected) throw new Error(warning);
      warnings.push(warning);
    }
  }
  try {
    for (const remote of readRemotes(home)) targets.push({
      id: remote.name, name: remote.name, transport: "ssh",
      endpoint: `ssh ${remote.host}${remote.container ? ` docker exec ${remote.container}` : ""}`,
      addProjectUnavailable: `Update the CLI on ${remote.name}, restart its service, then retry. Or add projects from a terminal: convoy project add <path> --remote ${remote.name}.`,
      ...remoteTarget(remote),
    });
  } catch (error) { warnings.push(error instanceof Error ? error.message : "Cannot read saved remotes."); }
  const index = selected ? targets.findIndex(target => target.id === selected && target.transport === "docker") : 0;
  if (index < 0) throw new Error("Unknown managed environment. Inspect convoy environment status before attaching.");
  return { targets, selected: index, warnings };
}

export { prepareEnvironment };

export async function createConnection(form: EnvironmentForm, progress: EnvironmentProgress, proposal?: EnvironmentProposal): Promise<Connection> {
  await provisionEnvironment(form, progress, proposal);
  const result = connections(form.name);
  return result.targets[result.selected];
}
