import { targetEnvironment, targetCommands } from "../environment/index.js";
import { password } from "@inquirer/prompts";
import { readConfig, resolveProfile } from "../../lib/config/index.js";
import { MANAGED_PROVIDER_LABELS } from "../../lib/config/provider-keys.js";
import { codexAwsHost } from "../../agent/runtimes/codex/auth.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { assertCredentialNames, authDescriptor, mutateCredentials } from "../../lib/config/credentials/resolution.js";
import { MANAGED_RUNTIME_LABELS, managedRuntimeSchema, opencodeSlotSchema, runtimeDescriptor, secretSchema, type ManagedCredentialStatus, type CredentialMutation } from "../../lib/config/credentials/validators.js";
import { inspectProjectEnvironmentAsync, isProjectEnvironment } from "../project/launcher.js";
import { serviceRequest, serviceEndpoint } from "../service/client.js";
import { environmentMode } from "../environment/resolution.js";
import { registrationIdentity } from "../project/validators.js";
import { remoteTarget, targetRemote } from "../remote/index.js";
import { ServiceUnavailableError } from "../service/errors.js";
import { servicePaths } from "../service/paths.js";

/** A `--env` or `--remote` target: its service owns the store, so keys never touch host storage. */
export function targeted() { return !!(targetEnvironment() ?? targetRemote()); }

/** A shared environment keeps its own store. Spec: docs/specs/cli-shared-environments.md#credentials */
function assertManagedEnvironment() {
  if (!targeted() && environmentMode() !== "shared" && !isProjectEnvironment())
    throw new Error(
      "Managed keys live in a project environment. From this machine, add --env <name> or --remote <name>; inside the environment, run as its Linux control account. For an ordinary profile, add a Mantle or Bedrock key without --auth api-key."
    );
}

export async function inputSecret(
  options: { fromEnv?: string; stdin?: boolean; token?: string; region?: string },
  message = "OpenAI API key (API usage billing)"
): Promise<string> {
  assertManagedEnvironment();
  if (options.token !== undefined || options.region !== undefined || (options.fromEnv && options.stdin))
    throw new Error("Managed keys require a masked prompt, --from-env or --stdin; token arguments are not accepted.");
  let secret: string;
  if (options.fromEnv) secret = process.env[options.fromEnv] ?? "";
  else if (options.stdin) {
    let buffer = "";
    for await (const chunk of process.stdin) {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 4098) throw new Error("Managed key input is too large.");
    }
    secret = buffer;
  } else {
    if (!process.stdin.isTTY) throw new Error("Use --stdin or --from-env for non-interactive key input.");
    secret = await password({ message, mask: "*" });
  }
  const parsed = secretSchema.safeParse(secret);
  if (!parsed.success) throw new Error("Managed key input must be a nonempty single line of at most 4096 characters.");
  return parsed.data;
}

export function managedProfile(profile?: string): string {
  if (targeted()) {
    if (!profile) throw new Error("Pass --profile for a registered target project.");
    return profile;
  }
  const resolved = resolveProfile(process.cwd(), { profile });
  if (!resolved.key) throw new Error("Pass --profile for a registered isolated project.");
  return resolved.key;
}

export async function changeCredentials(request: CredentialMutation) {
  const target = targetEnvironment();
  // The container firewall allows listed hosts only; the region decides the endpoint.
  if (target && request.action === "add" && request.aws) await targetCommands.allowDomain(target, codexAwsHost(request.aws));
  const remote = targetRemote();
  if (target || remote) {
    // The bridge never falls back to host storage: a lost reply is an unknown outcome.
    const result = { ...await serviceRequest(serviceEndpoint(), { op: "credentials.mutate", credentials: request }), offline: false };
    if (remote && request.action === "add" && request.aws) console.error(`If outbound access is restricted, allow ${codexAwsHost(request.aws)} on ${remote.name}.`);
    return result;
  }
  assertManagedEnvironment();
  const environment = environmentMode() === "shared" ? "shared" : await inspectProjectEnvironmentAsync();
  if (environment !== "shared" && !environment.capabilities?.includes("credentials-v1"))
    throw new Error("Managed credentials require an updated launcher. Follow the VM upgrade instructions.");
  try {
    const status = await serviceRequest(servicePaths().socket, { op: "status" });
    if (!status.capabilities?.includes("credentials-v1"))
      throw new Error("Managed credentials require an updated service. Stop and upgrade it before changing keys.");
    if (environment === "shared" && !status.capabilities.includes("credentials-shared-v1"))
      throw new Error("This service predates shared-environment credentials. Restart it: convoy service stop, then convoy service start.");
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
    mutateCredentials(request, environment);
    return { registered: true, applied: false, offline: true };
  }
  // Once a service was found, any mutation failure is never replayed offline.
  return { ...(await serviceRequest(servicePaths().socket, { op: "credentials.mutate", credentials: request })), offline: false };
}

export async function managedStatus(): Promise<ManagedCredentialStatus> {
  const target = targetEnvironment(), remote = targetRemote();
  if (remote) return remoteTarget(remote).credentials.status();
  return target ? targetCommands.credentialStatus(target) : localManagedStatus();
}

/** Status of this machine's store; the TUI calls it directly instead of through the --env global. */
export async function localManagedStatus(): Promise<ManagedCredentialStatus> {
  const data = new CredentialStore().read();
  const config = readConfig();
  assertCredentialNames(data, config.keys);
  let service: Awaited<ReturnType<typeof serviceRequest>> | undefined;
  try {
    service = await serviceRequest(servicePaths().socket, { op: "status" });
  } catch (error) {
    if (!(error instanceof ServiceUnavailableError)) throw error;
  }
  const environment = environmentMode() !== "shared" && isProjectEnvironment() ? await inspectProjectEnvironmentAsync() : undefined;
  return {
    service: !!service,
    compatible: !service || (!!service.capabilities?.includes("credentials-v1") && (environmentMode() !== "shared" || service.capabilities.includes("credentials-shared-v1"))),
    configurationError: service?.configurationError ?? false,
    entries: Object.entries(data.entries).map(([name, e]) => ({
      name,
      provider: e.provider ?? e.aws?.provider ?? "openai",
      ...(e.aws ? { region: e.aws.region } : {}),
      auth: "api-key",
      billing: e.aws ? "AWS" : e.provider === "cursor" ? "Cursor account" : "API usage",
      enabled: e.enabled,
      revision: e.current,
      retainedRevisions: e.revisions.map((r) => r.revision),
    })),
    projects: [...new Set([data.bindings, data.claudeBindings ?? {}, data.cursorBindings ?? {}, data.opencodeBindings ?? {}].flatMap((record) => Object.keys(record)))].map((identity) => {
      const worker = service?.profiles?.find((w) => w.identity === identity);
      const active = environment?.registrations.find((r) => r.identity === identity)?.active;
      const desired = authDescriptor(data, identity);
      return {
        identity,
        profiles: Object.entries(config.profiles)
          .filter(([, p]) => registrationIdentity(p) === identity)
          .map(([key]) => key),
        desired,
        applied: worker && !["stopped", "failed", "blocked"].includes(worker.status) ? worker.auth : undefined,
        state: worker?.status ?? (active ? "direct/unknown" : "offline"),
        pending: worker ? !!worker.pending || JSON.stringify(worker.auth) !== JSON.stringify(desired) : undefined,
        authResult: worker?.authResult,
        verified: worker?.status === "online" && !worker.paused && worker.authResult?.result === "request-succeeded",
      };
    }),
  };
}

/** `; <runtime> <mode>, desired N, applied N` per bound runtime, and per OpenCode slot; Codex's leads the line. */
function runtimeStatus({ desired, applied, pending }: ManagedCredentialStatus["projects"][number]) {
  const part = (label: string, bound: { mode: string; revision?: number }, revision?: number) =>
    `; ${label} ${bound.mode}, desired ${bound.revision ?? "none"}, applied ${pending === undefined ? "unknown" : (revision ?? "none")}`;
  const single = managedRuntimeSchema.options.filter((runtime) => runtime !== "codex").map((runtime) => {
    const bound = runtimeDescriptor(runtime, desired);
    return bound ? part(MANAGED_RUNTIME_LABELS[runtime], bound, runtimeDescriptor(runtime, applied)?.revision) : "";
  }).join("");
  const slots = desired?.opencode;
  if (!slots) return single;
  if (!Object.keys(slots).length) return `${single}; OpenCode disabled`;
  return single + opencodeSlotSchema.options.map((slot) => {
    const bound = slots[slot];
    return bound ? part(`OpenCode ${MANAGED_PROVIDER_LABELS[slot]}`, bound, applied?.opencode?.[slot]?.revision) : "";
  }).join("");
}

export function printManagedStatus(status: Awaited<ReturnType<typeof managedStatus>>, json = false) {
  if (json) {
    console.log(JSON.stringify(status));
    return;
  }
  for (const entry of status.entries)
    console.log(`${entry.name}: ${MANAGED_PROVIDER_LABELS[entry.provider] ?? entry.provider}${entry.region ? `, ${entry.region}` : entry.provider === "cursor" ? ", billed to its Cursor account" : " API usage"}, ${entry.enabled ? "enabled" : "disabled"}, revision ${entry.revision}`);
  for (const project of status.projects)
    console.log(
      `${project.profiles.join(", ") || project.identity}: ${project.desired?.mode}, desired ${project.desired?.revision ?? "none"}, applied ${project.pending === undefined ? "unknown" : (project.applied?.revision ?? "none")}, ${project.state}${project.pending ? ", pending reconnect" : ""}${project.authResult ? ", " + project.authResult.result : ", not verified"}${runtimeStatus(project)}`
    );
  if (status.configurationError) console.log("Service configuration error; running workers retained their previous configuration.");
  if (!status.compatible) console.log("Upgrade the service to apply managed credentials.");
  if (!status.entries.length && !status.projects.length) console.log("No managed credentials or bindings.");
}

/** The target flag to repeat in follow-up hints. */
function via() {
  const remote = targetRemote(), environment = targetEnvironment();
  return remote ? ` --remote ${remote.name}` : environment ? ` --env ${environment.name}` : "";
}

export async function runManagedCommand(action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    if (result && typeof result === "object" && "applied" in result) {
      console.log(
        result.applied
          ? "Managed credential change saved and applied to the service snapshot. Provider validity is not verified."
          : `Managed credential change saved. Run convoy keys status${via()}, then reload affected service profiles with --interrupt or reconnect direct workers.`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Managed credential operation failed.");
    process.exitCode = 1;
  }
}
