export { registerEnvironmentCommands } from "./command.js";
export { targetEnvironment } from "./resolution.js";
import type { ProjectAddOptions } from "../project/workflow.js";
import { addTargetProject } from "./projects.js";
import { targetLifecycle, targetShell } from "./command.js";
import { EnvironmentController } from "./workflow.js";
import { environmentDirectory, readEnvironment, withEnvironmentLock } from "./paths.js";
import { containerName, type Environment } from "./validators.js";
import { projectCheckSchema, projectAccountsSchema, type LoginRuntime } from "../project/validators.js";
import { managedCredentialStatusSchema } from "../../lib/config/credentials/validators.js";
import { logSchema } from "../service/validators.js";
import { docker, helperArgs } from "./docker.js";

export const targetCommands = {
  addProject: (environment: Environment, directory: string, options: ProjectAddOptions) =>
    withEnvironmentLock(environmentDirectory(environment.name), () => addTargetProject(environment, directory, options)),
  listProjects: async (environment: Environment, json: boolean) => {
    const result: unknown = JSON.parse(await docker(["exec", "--user", "node", containerName(environment), "convoy", "project", "list", "--json"]));
    if (json) console.log(JSON.stringify(result)); else console.table(result);
  },
  shell: (environment: Environment, profile: string, options: { expectedIdentity?: string; signal?: AbortSignal; home?: string; login?: LoginRuntime } = {}) => {
    const directory = environmentDirectory(environment.name, options.home, false);
    return withEnvironmentLock(directory, async () => {
      const current = readEnvironment(directory);
      if (!current || current.owner !== environment.owner || current.daemon !== environment.daemon) throw new Error("Environment identity changed. Inspect environment status.");
      const controller = new EnvironmentController((args, settings) => docker(args, { ...settings, signal: options.signal }));
      const container = await controller.container(current);
      options.signal?.throwIfAborted();
      if (!container?.State.Running) throw new Error("Container unavailable. Start the environment before opening its shell.");
      return targetShell(current, profile, undefined, options);
    }, 600_000, options.signal);
  },
  /** The container's own CLI pauses, logs in and reloads against its service. */
  login: (environment: Environment, profile: string, runtime: LoginRuntime, interrupt: boolean) =>
    withEnvironmentLock(environmentDirectory(environment.name), () => targetShell(environment, profile, undefined, { login: runtime, cli: ["project", "login", profile, "--runtime", runtime, ...(interrupt ? ["--interrupt"] : [])] })),
  account: async (environment: Environment, profile: string, identity: string) => projectAccountsSchema.parse(JSON.parse(
    await docker(["exec", "--user", "node", containerName(environment), "convoy", "project", "account", profile, "--expected-identity", identity], { timeout: 25_000, diagnostics: false }),
  )),
  check: async (environment: Environment, profile: string, diagnostics = true) => projectCheckSchema.parse(JSON.parse(
    await docker(["exec", "--user", "node", containerName(environment), "convoy", "project", "check", profile, "--json"], { timeout: 120_000, diagnostics }),
  )),
  operationalLogs: async (environment: Environment, profile?: string, diagnostics = true) => {
    const output = await docker(["exec", "--user", "node", containerName(environment), "convoy", "service", "logs", "--json", ...(profile ? ["--profile", profile] : [])], { diagnostics });
    return output ? output.split("\n").map(line => logSchema.parse(JSON.parse(line))) : [];
  },
  credentialStatus: async (environment: Environment) => managedCredentialStatusSchema.parse(JSON.parse(
    await docker(["exec", "--user", "node", containerName(environment), "convoy", "keys", "status", "--json"]),
  )),
  allowDomain: (environment: Environment, host: string) => withEnvironmentLock(environmentDirectory(environment.name), () =>
    docker(helperArgs(environment, "allow-domain", host), { progress: true, timeout: 180_000 })),
  lifecycle: targetLifecycle,
  start: (environment: Environment) => withEnvironmentLock(environmentDirectory(environment.name), () => new EnvironmentController().start(environment)),
};
