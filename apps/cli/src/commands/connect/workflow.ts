import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { canPromptToConnect } from "./prompts.js";
import {
  resolveProfile,
  resolveConfigFromProfileCommand,
  getAllProfiles,
  addPathToProfile,
  resolveProfileProviderKey,
  resolveProviderKeyByName,
  buildProviderKeyEnv,
  applyProviderKeyEnv,
  PROVIDER_LABELS,
  type Profile,
  type ResolvedProviderKey,
  getProfileByKey,
} from "../../lib/config/index.js";
import { CodexProviderKeySchema, type CodexProviderKey } from "../../lib/config/types.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { authDescriptor, connectAuth, launchAuth, assertCredentialNames } from "../../lib/config/credentials/resolution.js";
import type { ClaudeAuth, CodexAuth, CursorAuth, OpencodeAuth } from "../../lib/config/credentials/validators.js";
import { launchProject, sharedRuntimeStates } from "../project/launcher.js";
import { environmentMode } from "../environment/resolution.js";
import { acquireLock, leasePath, LockHeldError } from "../service/paths.js";
import { guidance } from "../project/formatters.js";
import { loginRuntimeSchema, projectIdentity, type LoginRuntime } from "../project/validators.js";
import { promptUnmatchedFolder } from "../setup/prompts.js";
import { ConnectDiagnosticError, createAgentRunner, SessionConflictError } from "../../agent/app/runner.js";
import { redactAuth } from "../../lib/config/convex-client.js";
import {
  DEFAULT_MAX_CONCURRENT_CHATS,
  MAX_MAX_CONCURRENT_CHATS,
} from "../../agent/app/runtime-config.js";
import { runSetup } from "../setup/workflow.js";
import { maybeLogMissingProjectSkillHint } from "../../lib/skill-install-guidance.js";
import { checkForNewerVersion, getCliVersion } from "../../lib/version.js";
import { ENV_PROFILE } from "../../lib/constants.js";
import { canPromptForUpdate, offerUpdate } from "../update/prompts.js";
import {
  EXIT_FATAL,
  emitConnectEvent,
  enableConnectEvents,
  exitAfterFlush,
} from "../../lib/connect-events.js";

interface ConnectOptions {
  force?: boolean;
  repo?: string;
  name?: string;
  stream?: string;
  delay?: string;
  concurrency?: string;
  buffered?: boolean;
  isolated?: boolean;
  codexExec?: boolean;
  json?: boolean;
  providerKey?: string;
}

interface RunConnectConfig {
  convexUrl: string;
  apiKey: string;
  projectId: string;
  paths?: string[];
  connectionName?: string;
  profileKey?: string;
  force?: boolean;
  nonInteractive?: boolean;
  /** Set on retries so the update prompt shows once per process. */
  updateOffered?: boolean;
  shutdownSignal?: AbortSignal;
  streamFile?: string;
  streamDelayMs?: number;
  concurrency?: number;
  partialStreaming?: boolean;
  isolated?: boolean;
  codexAuth?: CodexAuth;
  claudeAuth?: ClaudeAuth;
  cursorAuth?: CursorAuth;
  opencodeAuth?: OpencodeAuth;
  claudeProviderToken?: string;
  codexProvider?: CodexProviderKey;
  codexAppServer?: boolean;
  jsonEvents?: boolean;
  /** Who takes a shared registration's lease; the service's worker passes "service". */
  leaseHolder?: "service" | "connect";
}

export const DEFAULT_CONNECT_CONCURRENCY = DEFAULT_MAX_CONCURRENT_CHATS;

/**
 * Partial streaming and the Codex app-server transport are on by default
 * (OS-1659) — they are the experience the web app is built around. Each has a
 * single opt-out flag (`--buffered`, `--codex-exec`); there is no positive
 * twin, because passing nothing already means "on".
 */
export const DEFAULT_PARTIAL_STREAMING = true;
export const DEFAULT_CODEX_APP_SERVER = true;

/**
 * `--buffered` turns streaming off for the run; otherwise the profile's
 * `streaming` config decides. Undefined means "unset" — `runConnect` applies
 * the default (on).
 */
export function resolvePartialStreaming(
  buffered: boolean | undefined,
  profileStreaming: boolean | undefined
): boolean | undefined {
  return buffered ? false : profileStreaming;
}

/** `--isolated` flag wins; otherwise the profile's `isolated` config; default off (OS-1242). */
export function resolveIsolated(
  flag: boolean | undefined,
  profileIsolated: boolean | undefined
): boolean {
  return flag ?? profileIsolated ?? false;
}

/**
 * `--codex-exec` runs Codex through `codex exec --json` instead of the
 * app-server transport. Undefined means "unset" — `runConnect` applies the
 * default (app-server).
 */
export function resolveCodexAppServer(
  codexExec: boolean | undefined
): boolean | undefined {
  return codexExec ? false : undefined;
}

/**
 * Resolve the provider key for this run — the `--provider-key` override
 * when given, otherwise the profile's assigned key — exiting fatally when
 * the referenced key does not exist in config.toml.
 */
function resolveProviderKeyOrExit(
  profile: Profile,
  overrideName?: string
): Promise<ResolvedProviderKey | undefined> {
  return resolveOrExit(() =>
    overrideName ? resolveProviderKeyByName(overrideName) : resolveProfileProviderKey(profile)
  );
}

/** The profile's Codex key (OS-2105); same fatal handling as the Claude key. */
function resolveCodexProviderKeyOrExit(profile: Profile): Promise<ResolvedProviderKey | undefined> {
  return resolveOrExit(() => resolveProfileProviderKey(profile, "codex"));
}

async function resolveOrExit<T>(resolve: () => T): Promise<T> {
  try {
    return resolve();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitConnectEvent({ event: "status", status: "failed", message });
    console.error(chalk.red(`\nError: ${message}`));
    exitAfterFlush(EXIT_FATAL);
    // exitAfterFlush terminates asynchronously; never resume the caller.
    return new Promise<never>(() => {});
  }
}

/**
 * Inject the provider key's env into this process before anything detects
 * runtimes or spawns agents: detection reads process env first, every agent
 * subprocess inherits it, and the Claude runner re-sends it via `--settings`
 * so a conflicting ~/.claude/settings.json `env` cannot override it.
 */
function activateProviderKey(providerKey: ResolvedProviderKey): void {
  applyProviderKeyEnv(buildProviderKeyEnv(providerKey.key));
}

export function parseConnectConcurrencyOption(
  value: string | undefined
): number {
  if (value === undefined) {
    return DEFAULT_CONNECT_CONCURRENCY;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid concurrency "${value}". Use a positive integer (for example: -c 5).`
    );
  }
  if (parsed > MAX_MAX_CONCURRENT_CHATS) {
    throw new Error(
      `Invalid concurrency "${value}". Maximum supported value is ${MAX_MAX_CONCURRENT_CHATS}.`
    );
  }

  return parsed;
}

/** Explicit flag wins, then the profile setting, then the runtime default. */
export function resolveConnectConcurrency(
  flagConcurrency: number | undefined,
  profileConcurrency: number | undefined
): number {
  return flagConcurrency ?? profileConcurrency ?? DEFAULT_CONNECT_CONCURRENCY;
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return apiKey;
  }

  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
}

interface ConnectConfigSummary {
  profileKey: string;
  profileName: string;
  convexUrl: string;
  apiKey: string;
  projectId: string;
  paths: string[];
  resolutionSource?: string;
}

export function logConnectConfigSummary(summary: ConnectConfigSummary): void {
  console.log(chalk.dim("Resolved config:"));
  console.log(`  Profile key: ${chalk.green(summary.profileKey)}`);
  console.log(`  Profile name: ${chalk.cyan(summary.profileName)}`);
  if (summary.resolutionSource) {
    console.log(`  Source:      ${chalk.dim(summary.resolutionSource)}`);
  }
  console.log(`  URL:         ${chalk.cyan(summary.convexUrl)}`);
  console.log(`  Project ID:  ${chalk.dim(summary.projectId)}`);
  console.log(`  API Key:     ${chalk.dim(maskApiKey(summary.apiKey))}`);
  console.log("  Paths:");
  for (const profilePath of summary.paths) {
    console.log(`    - ${chalk.dim(profilePath)}`);
  }
  console.log("");
}

interface ConnectWithProfileConfig {
  force?: boolean;
  profileKey: string;
  profileName: string;
  convexUrl: string;
  apiKey: string;
  projectId: string;
  paths: string[];
  providerKey?: ResolvedProviderKey;
  codexProviderKey?: ResolvedProviderKey;
  resolutionSource?: string;
  connectionName?: string;
  streamFile?: string;
  streamDelayMs?: number;
  concurrency?: number;
  partialStreaming?: boolean;
  isolated?: boolean;
  codexAuth?: CodexAuth;
  codexAppServer?: boolean;
  jsonEvents?: boolean;
}

export async function connectUsingProfile(
  config: ConnectWithProfileConfig
): Promise<void> {
  if ((config.providerKey || config.codexProviderKey) && getProfileByKey(config.profileKey)?.project_isolation) {
    throw new Error("Host provider-key overrides are unavailable for project isolation. Authenticate inside convoy project shell instead.");
  }
  // Exec cannot carry the provider checks, so an AWS-assigned Codex never downgrades to it.
  if (config.codexProviderKey && config.codexAppServer === false) {
    throw new Error("Codex on AWS Bedrock needs the app-server transport. Drop --codex-exec or unassign the Codex key with 'convoy keys unassign --runtime codex'.");
  }
  const codexProvider = config.codexProviderKey && CodexProviderKeySchema.parse(config.codexProviderKey.key);
  const usingProfileMessage = config.resolutionSource
    ? `Using profile "${config.profileKey}" (matched by ${config.resolutionSource})`
    : `\nUsing profile "${config.profileKey}" (${config.profileName})`;

  console.log(chalk.dim(usingProfileMessage));
  if (config.providerKey) {
    console.log(
      chalk.dim(
        `Provider: ${PROVIDER_LABELS[config.providerKey.key.provider]} ("${config.providerKey.name}")`
      )
    );
    activateProviderKey(config.providerKey);
  }
  if (config.codexProviderKey && codexProvider) {
    console.log(
      chalk.dim(
        `Codex provider: ${PROVIDER_LABELS[codexProvider.provider]} ("${config.codexProviderKey.name}", ${codexProvider.region})`
      )
    );
  }
  logConnectConfigSummary({
    profileKey: config.profileKey,
    profileName: config.profileName,
    convexUrl: config.convexUrl,
    apiKey: config.apiKey,
    projectId: config.projectId,
    paths: config.paths,
    resolutionSource: config.resolutionSource,
  });

  await runConnect({
    convexUrl: config.convexUrl,
    apiKey: config.apiKey,
    projectId: config.projectId,
    paths: config.paths,
    connectionName: config.connectionName,
    force: config.force,
    profileKey: config.profileKey,
    streamFile: config.streamFile,
    streamDelayMs: config.streamDelayMs,
    concurrency: config.concurrency,
    partialStreaming: config.partialStreaming,
    isolated: config.isolated,
    claudeProviderToken: config.providerKey?.key.token,
    codexProvider,
    codexAppServer: config.codexAppServer,
    jsonEvents: config.jsonEvents,
  });
}

/**
 * Print the update banner once the newer-version lookup settles.
 * See docs/specs/cli-update-notice.md.
 */
async function logUpdateNotice(newerVersion: Promise<string | null>): Promise<void> {
  const latest = await newerVersion;
  if (!latest) {
    return;
  }
  console.log(
    chalk.yellow(`↑ Update available: ${getCliVersion()} → ${latest}`) +
      chalk.dim("  ·  convoy update")
  );
}

/**
 * Run the agent connection (reusable function)
 * This starts a long-running process that connects to the backend
 */
export async function runConnect(config: RunConnectConfig): Promise<void> {
  if (config.shutdownSignal?.aborted) return;
  const profile = config.profileKey ? getProfileByKey(config.profileKey) : undefined;
  const mode = environmentMode();
  if (mode === "isolated" && !profile?.project_isolation) {
    throw new Error("Use convoy project add to register this project before connecting in this environment.");
  }
  if (mode === "shared" && profile?.project_isolation) {
    throw new Error("This environment is shared, and isolated registrations need the project launcher. Remove the registration with convoy project remove.");
  }
  if (config.profileKey && profile?.project_isolation) {
    const isolation = profile.project_isolation;
    if (config.convexUrl !== profile.url || config.projectId !== profile.project_id ||
        config.apiKey !== profile.api_key || config.paths?.length !== 1 || config.paths[0] !== profile.paths[0] ||
        projectIdentity(profile.url, isolation.organization_id, profile.project_id) !== isolation.identity || config.streamFile) {
      throw new Error("An isolated registration cannot override its identity, credentials, workspace or execution source.");
    }
    const credentials = new CredentialStore().read();
    assertCredentialNames(credentials);
    const managedAuth = launchAuth(isolation.identity, authDescriptor(credentials,isolation.identity));
    if (managedAuth.codexAuth && config.codexAppServer === false) throw new Error("Managed Codex credentials require app-server mode.");
    await launchProject(isolation.identity, { config: {
      convexUrl: profile.url, apiKey: profile.api_key, projectId: profile.project_id,
      organizationId: isolation.organization_id, profileKey: config.profileKey,
      connectionName: config.connectionName, force: config.force,
      concurrency: config.concurrency, partialStreaming: config.partialStreaming,
      ...managedAuth,
      isolated: config.isolated, codexAppServer: config.codexAppServer, jsonEvents: config.jsonEvents,
    } });
    return;
  }
  // A shared registration has one owner at a time. Spec: docs/specs/cli-shared-environments.md#locks
  let release: (() => void) | undefined;
  if (profile?.project_mode === "shared" && profile.project_organization) {
    const identity = projectIdentity(profile.url, profile.project_organization, profile.project_id);
    // A service worker's frame already carries its assignment. Spec: docs/specs/cli-shared-environments.md#credentials
    if (config.leaseHolder !== "service") {
      const credentials = new CredentialStore().read();
      assertCredentialNames(credentials);
      const managedAuth = launchAuth(identity, authDescriptor(credentials, identity));
      if (managedAuth.codexAuth && config.codexAppServer === false) throw new Error("Managed Codex credentials require app-server mode.");
      config = { ...config, ...connectAuth(managedAuth) };
    }
    try { release = acquireLock(leasePath(identity), config.leaseHolder ?? "connect"); }
    catch (error) {
      if (!(error instanceof LockHeldError)) throw error;
      if (config.jsonEvents) {
        enableConnectEvents();
        emitConnectEvent({ event: "status", status: "failed", reason: "project-active", holder: error.holder });
      }
      throw new Error(`Project is in use by ${guidance.holder(error.holder)}. Stop it before continuing.`);
    }
  }
  try {
    // The service warns about logged-out runtimes from this event. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins
    const runtimes = release && config.jsonEvents ? await sharedRuntimeStates() : undefined;
    await connectAgents(config, runtimes && {
      runtimes: loginRuntimeSchema.options.filter(key => runtimes[key].installed),
      loggedOut: loginRuntimeSchema.options.filter(key => runtimes[key].login === "signed-out"),
    });
  } finally { release?.(); }
}

async function connectAgents(config: RunConnectConfig, shared?: { runtimes: string[]; loggedOut: string[] }): Promise<void> {
  const paths = config.paths ?? [process.cwd()];
  const concurrency = config.concurrency ?? DEFAULT_CONNECT_CONCURRENCY;
  // Defaults land here so every caller (connect, the bare `convoy` entry,
  // setup's auto-connect) gets them without repeating the fallback.
  const partialStreaming = config.partialStreaming ?? DEFAULT_PARTIAL_STREAMING;
  const codexAppServer = config.codexAppServer ?? DEFAULT_CODEX_APP_SERVER;

  if (config.jsonEvents) {
    enableConnectEvents();
  }
  // Agent-run `convoy` commands target this bridge's profile. Spec: docs/specs/cli-thread-agents.md#thread-identity-delivery-os-1223
  if (config.profileKey) process.env[ENV_PROFILE] = config.profileKey;
  // Isolated workers report the launcher's runtime state so clients can offer logins and warn.
  const launcherList = (name: string) => (process.env[name] ?? "").split(",").filter(Boolean);
  const native: Record<LoginRuntime, boolean> = {
    codex: !config.codexProvider && (!config.codexAuth || config.codexAuth.mode === "native"), "claude-code": !config.claudeAuth, cursor: !config.cursorAuth, opencode: !config.opencodeAuth,
  };
  emitConnectEvent({ event: "status", status: "connecting", ...shared && { ...shared, loggedOut: shared.loggedOut.filter((runtime) => native[runtime as LoginRuntime]) },
    ...(process.env.CONVOY_PROJECT_RUNTIMES !== undefined ? { runtimes: launcherList("CONVOY_PROJECT_RUNTIMES"),
      untrusted: launcherList("CONVOY_PROJECT_UNTRUSTED"), loggedOut: launcherList("CONVOY_PROJECT_LOGGED_OUT").filter((runtime) => native[runtime as LoginRuntime] === true) } : {}) });

  console.log(chalk.bold(`\nConvoy Agent v${getCliVersion()}\n`));
  if (!config.streamFile) {
    maybeLogMissingProjectSkillHint(paths);
  }

  // Runs while we connect, so the lookup never delays an unattended startup.
  let newerVersion = config.streamFile
    ? Promise.resolve(null)
    : checkForNewerVersion();
  if (!config.updateOffered && canPromptForUpdate(config)) {
    const latest = await newerVersion;
    newerVersion = Promise.resolve(null);
    if (latest && await offerUpdate(latest)) {
      console.log(chalk.green("Updated. Run convoy connect again."));
      return;
    }
  }

  const connectSpinner = ora(
    `Connecting to ${chalk.cyan(config.convexUrl)}...`
  ).start();

  try {
    const runner = await createAgentRunner({
      convexUrl: config.convexUrl,
      apiKey: config.apiKey,
      projectId: config.projectId,
      paths,
      connectionName: config.connectionName,
      profileKey: config.profileKey,
      force: config.force,
      streamFile: config.streamFile,
      streamDelayMs: config.streamDelayMs,
      maxConcurrentChats: concurrency,
      partialStreaming,
      isolated: config.isolated,
      codexAppServer,
      codexAuth: config.codexAuth,
      claudeAuth: config.claudeAuth,
      cursorAuth: config.cursorAuth,
      opencodeAuth: config.opencodeAuth,
      claudeProviderToken: config.claudeProviderToken,
      codexProvider: config.codexProvider,
    });

    connectSpinner.succeed(`Connected to ${chalk.cyan(config.convexUrl)}`);
    console.log(
      chalk.dim(
        `Runtime config: concurrency=${concurrency}, mode=${config.streamFile ? "stream" : "runtime"}, streaming=${partialStreaming ? "on" : "off"}, isolated=${config.isolated ? "on" : "off"}, codex=${codexAppServer ? "app-server" : "exec"}`
      )
    );
    await logUpdateNotice(newerVersion);
    console.log(chalk.dim("Waiting for commands... (Ctrl+C to stop)\n"));

    // Handle graceful shutdown
    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(chalk.dim("\n\nShutting down..."));
      const forceExitTimer = setTimeout(() => {
        process.exit(0);
      }, 30_000);
      forceExitTimer.unref?.();

      try {
        await runner.stop();
      } catch {
        // Ignore cleanup errors
      } finally {
        clearTimeout(forceExitTimer);
        if (!config.shutdownSignal) process.exit(0);
      }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("SIGHUP", shutdown);

    let shutdownCompletion: Promise<void> | undefined;
    const onAbort = () => { shutdownCompletion = shutdown(); };
    config.shutdownSignal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (config.shutdownSignal?.aborted) await shutdown();
      else await runner.run();
      await shutdownCompletion;
    } finally {
      config.shutdownSignal?.removeEventListener("abort", onAbort);
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      process.removeListener("SIGHUP", shutdown);
    }
  } catch (error) {
    if (config.nonInteractive) {
      // Raw backend errors stay hidden; intentional diagnostics are shown redacted.
      const message = error instanceof SessionConflictError
        ? "Session conflict. Stop the other connection or retry convoy connect with --force to take it over."
        : error instanceof ConnectDiagnosticError
          ? `Isolated connection failed: ${redactAuth(error.message, config.apiKey)}`
          : "Isolated connection failed. Check backend availability, project credentials and runtime configuration.";
      if (error instanceof ConnectDiagnosticError && error.reason) emitConnectEvent({ event: "status", status: "failed", reason: error.reason,
        runtimes: (process.env.CONVOY_PROJECT_RUNTIMES ?? "").split(",").filter(Boolean) });
      connectSpinner.fail(message);
      throw new Error(message);
    }
    // Handle session conflict - prompt user to force disconnect
    if (error instanceof SessionConflictError) {
      connectSpinner.fail("Session conflict");
      console.log(
        chalk.yellow(
          `\n${error.message} (${error.activeSessionCount} active session${error.activeSessionCount > 1 ? "s" : ""})`
        )
      );

      // Supervised mode has no TTY to prompt on: take over automatically
      // (the supervisor starting connect is the takeover decision).
      if (config.jsonEvents) {
        emitConnectEvent({ event: "status", status: "blocked", message: error.message });
        if (!config.force) {
          console.log(chalk.dim("Retrying with force (json mode)..."));
          return connectAgents({ ...config, force: true, updateOffered: true });
        }
        exitAfterFlush(EXIT_FATAL);
        return;
      }

      if (!canPromptToConnect()) {
        throw new Error("Session conflict. Retry with convoy connect --force to take it over.");
      }

      const shouldForce = await confirm({
        message: "Disconnect existing session(s) and connect?",
        default: false,
      });

      if (shouldForce) {
        // Retry with force=true
        return connectAgents({ ...config, force: true, updateOffered: true });
      }

      console.log(chalk.dim("\nConnection cancelled."));
      process.exit(0);
    }

    connectSpinner.fail("Failed to connect");
    const errorMessage = error instanceof Error ? error.message : String(error);
    emitConnectEvent({ event: "status", status: "failed", message: errorMessage });
    console.error(chalk.red(`\nError: ${errorMessage}`));
    exitAfterFlush(EXIT_FATAL);
  }
}

export async function runConnectCommandAction(
  options: ConnectOptions,
  cmd: Command
): Promise<void> {
  // Reserve stdout for NDJSON before anything prints — the profile summary
  // and resolution logs below would otherwise corrupt the event stream.
  if (options.json) {
    enableConnectEvents();
  }

  let concurrencyOverride: number | undefined;
  try {
    concurrencyOverride =
      options.concurrency === undefined
        ? undefined
        : parseConnectConcurrencyOption(options.concurrency);
  } catch (error) {
    console.error(
      chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`)
    );
    process.exit(1);
  }

  const cwd = options.repo || process.cwd();
  const globalOptions = cmd.optsWithGlobals() as {
    profile?: string;
    buffered?: boolean;
    isolated?: boolean;
    codexExec?: boolean;
  };
  const explicitProfile = globalOptions.profile;
  // The opt-out flags may be given on the root command (`convoy --buffered
  // connect`) or on the subcommand; either position turns the feature off.
  const bufferedFlag = options.buffered ?? globalOptions.buffered;
  const isolatedFlag = options.isolated ?? globalOptions.isolated;
  const codexExecFlag = options.codexExec ?? globalOptions.codexExec;
  const resolution = resolveProfile(cwd, {
    profile: explicitProfile,
  });

  if (environmentMode() === "isolated" && !resolution.profile?.project_isolation) {
    throw new Error("Use convoy project add to register a project, then connect --profile <key>.");
  }

  if (explicitProfile && !resolution.profile) {
    console.error(chalk.red(`\nProfile "${explicitProfile}" not found.`));
    console.log(chalk.dim("Run 'convoy config list' to see available profiles."));
    process.exit(1);
  }

  if (resolution.source === "none" || !resolution.profile) {
    const profiles = getAllProfiles();

    if (profiles.length === 0) {
      // Supervised mode has no TTY: fail structured instead of launching the wizard.
      if (options.json) {
        emitConnectEvent({
          event: "status",
          status: "failed",
          message: "No profiles configured. Run 'convoy setup' first.",
        });
        console.error(chalk.red("\nNo profiles configured. Run 'convoy setup' first."));
        exitAfterFlush(EXIT_FATAL);
        return;
      }
      console.log(chalk.yellow("\nNo profiles configured. Starting setup wizard...\n"));
      await runSetup();
      return;
    }

    // Same: never open the unmatched-folder prompt under a supervisor.
    if (options.json) {
      emitConnectEvent({
        event: "status",
        status: "failed",
        message:
          "No profile matches this folder. Pass --profile <key> or add the folder to a profile.",
      });
      console.error(
        chalk.red(
          "\nNo profile matches this folder. Pass --profile <key> or add the folder to a profile."
        )
      );
      exitAfterFlush(EXIT_FATAL);
      return;
    }

    const choice = await promptUnmatchedFolder(profiles);
    if (choice.action === "create") {
      await runSetup();
      return;
    }

    const selectedProfile = profiles.find((profile) => profile.key === choice.key);
    if (!selectedProfile) {
      console.error(chalk.red("Selected profile not found"));
      process.exit(1);
    }

    let paths = selectedProfile.profile.paths;
    if (choice.action === "add-folder") {
      addPathToProfile(choice.key, cwd);
      const resolved = path.resolve(cwd);
      if (!paths.some((profilePath) => path.resolve(profilePath) === resolved)) {
        paths = [...paths, resolved];
      }
      console.log(chalk.green("✓") + ` Added folder to profile "${choice.key}"`);
    }

    await connectUsingProfile({
      profileKey: choice.key,
      profileName: selectedProfile.profile.name,
      convexUrl: selectedProfile.profile.url,
      apiKey: selectedProfile.profile.api_key,
      projectId: selectedProfile.profile.project_id,
      paths,
      providerKey: await resolveProviderKeyOrExit(
        selectedProfile.profile,
        options.providerKey
      ),
      codexProviderKey: await resolveCodexProviderKeyOrExit(selectedProfile.profile),
      connectionName: options.name,
      force: options.force,
      streamFile: options.stream,
      streamDelayMs: options.delay ? Number(options.delay) : undefined,
      concurrency: resolveConnectConcurrency(
        concurrencyOverride,
        selectedProfile.profile.concurrency
      ),
      partialStreaming: resolvePartialStreaming(
        bufferedFlag,
        selectedProfile.profile.streaming
      ),
      isolated: resolveIsolated(isolatedFlag, selectedProfile.profile.isolated),
      codexAppServer: resolveCodexAppServer(codexExecFlag),
      jsonEvents: options.json,
    });
    return;
  }

  const config = resolveConfigFromProfileCommand(cmd, cwd);
  if (!config.convexUrl || !config.apiKey || !config.projectId) {
    console.error(chalk.red("\nMissing required configuration:"));
    if (!config.convexUrl) console.error("  - Convex URL");
    if (!config.apiKey) console.error("  - API Key");
    if (!config.projectId) console.error("  - Project ID");
    console.log(chalk.dim("\nRun 'convoy setup' to configure."));
    process.exit(1);
  }

  if (!resolution.key) {
    console.error(chalk.red("\nResolved profile key is missing."));
    process.exit(1);
  }

  await connectUsingProfile({
    profileKey: resolution.key,
    profileName: resolution.profile.name,
    convexUrl: config.convexUrl,
    apiKey: config.apiKey,
    projectId: config.projectId,
    paths: resolution.profile.paths,
    providerKey: await resolveProviderKeyOrExit(
      resolution.profile,
      options.providerKey
    ),
    codexProviderKey: await resolveCodexProviderKeyOrExit(resolution.profile),
    resolutionSource: resolution.source,
    connectionName: options.name,
    force: options.force,
    streamFile: options.stream,
    streamDelayMs: options.delay ? Number(options.delay) : undefined,
    concurrency: resolveConnectConcurrency(
      concurrencyOverride,
      resolution.profile.concurrency
    ),
    partialStreaming: resolvePartialStreaming(
      bufferedFlag,
      resolution.profile.streaming
    ),
    isolated: resolveIsolated(isolatedFlag, resolution.profile.isolated),
    codexAppServer: resolveCodexAppServer(codexExecFlag),
    jsonEvents: options.json,
  });
}
