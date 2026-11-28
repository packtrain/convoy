import { randomUUID } from "crypto";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import { type ClaudeAuth, type CodexAuth, type CursorAuth, type AntigravityAuth, type OpencodeAuth } from "../../lib/config/credentials/validators.js";
import { loginRuntimeLabels } from "../../commands/project/validators.js";
import type { CodexProviderKey } from "../../lib/config/types.js";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { createConvexClient, type ConvoyClient } from "../../lib/config/index.js";
import { codexSecret } from "../runtimes/codex/auth.js";
import { createRunnerForCliType, detectAvailableClis } from "../runtimes/registry.js";
import { shutdownOpencodeServer } from "../runtimes/opencode/server.js";
import type { DetectedCli } from "../runtimes/contracts.js";
import { createMessageHandler, type MessageHandler } from "./thread-processor.js";
import { createInteractionRouter } from "./interaction-router.js";
import { createWorktreeOpProcessor } from "./worktree-op-processor.js";
import { getGitRemoteUrl } from "../../lib/git/index.js";
import { resolveConvexSiteUrl, toConvexSiteUrl } from "../../lib/url.js";
import { getCliVersion } from "../../lib/version.js";
import { satisfiesVersionRange } from "../sdk/versioning/provider-version.js";
import { EXIT_FATAL, EXIT_SESSION_REPLACED, emitConnectEvent, exitAfterFlush, type ConnectFailureReason } from "../../lib/connect-events.js";

export interface AgentRunnerOptions {
  convexUrl: string;
  apiKey: string;
  projectId: string;
  paths: string[];
  connectionName?: string;
  profileKey?: string;
  force?: boolean;
  streamFile?: string;
  streamDelayMs?: number;
  maxConcurrentChats?: number;
  partialStreaming?: boolean;
  /** OS-sandbox agents to the profile's paths (OS-1242). */
  isolated?: boolean;
  codexAuth?: CodexAuth;
  /** Managed Claude Code credential from the project launcher (OS-2108). */
  claudeAuth?: ClaudeAuth;
  /** Managed Cursor key from the project launcher (OS-2017). */
  cursorAuth?: CursorAuth;
  /** Managed Gemini key for Antigravity from the project launcher (OS-2476). */
  antigravityAuth?: AntigravityAuth;
  /** Managed OpenCode keys from the project launcher (OS-2018). */
  opencodeAuth?: OpencodeAuth;
  /** Token of the profile's Claude provider key, redacted from uploads. */
  claudeProviderToken?: string;
  /** AWS provider assigned to Codex (OS-2105); requires app-server. */
  codexProvider?: CodexProviderKey;
  codexAppServer?: boolean;
}

export interface AgentRunner {
  run(): Promise<void>;
  stop(): Promise<void>;
}

/** An intentional, credential-free startup diagnostic that isolated connect may show. */
export class ConnectDiagnosticError extends Error {
  constructor(message: string, readonly reason?: ConnectFailureReason) {
    super(message);
    this.name = "ConnectDiagnosticError";
  }
}

/**
 * Error thrown when there's an active session conflict.
 * The CLI should catch this, prompt the user, and retry with force=true.
 */
export class SessionConflictError extends Error {
  public readonly activeSessionCount: number;

  constructor(message: string, activeSessionCount: number) {
    super(message);
    this.name = "SessionConflictError";
    this.activeSessionCount = activeSessionCount;
  }
}

async function postJsonWithTimeout(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Minimum codex-cli exposing the app-server protocol this integration speaks.
 * The transport is the default since OS-1659, so an older binary must fall
 * back to `codex exec` instead of failing every Codex run — the user did not
 * ask for app-server, they just got the default.
 */
export const MIN_CODEX_APP_SERVER_VERSION = ">=0.142.0";

export function supportsCodexAppServer(availableClis: DetectedCli[]): boolean {
  const codex = availableClis.find((cli) => cli.type === "codex");
  return (
    codex !== undefined &&
    satisfiesVersionRange(codex.version, MIN_CODEX_APP_SERVER_VERSION)
  );
}

function formatDetectedCli(cli: DetectedCli): string {
  const base = `${cli.type}@${cli.version}`;

  if (cli.provider) {
    // "anthropic" is the internal slug for a direct claude.ai connection.
    const provider = cli.provider === "anthropic" ? "claude" : cli.provider;
    return `${base} (provider=${provider}${cli.region ? `, region=${cli.region}` : ""})`;
  }

  return base;
}

/**
 * Create the main agent runner
 */
export async function createAgentRunner(options: AgentRunnerOptions): Promise<AgentRunner> {
  const {
    convexUrl,
    apiKey,
    projectId,
    paths,
    connectionName,
    profileKey,
    force,
    streamFile,
    streamDelayMs,
    maxConcurrentChats,
    partialStreaming,
    isolated,
    codexAppServer,
  } = options;

  // Isolation (OS-1242): the profile's paths become the sandbox write
  // boundary for every spawned agent. Resolved to absolute so relative
  // config entries cannot silently widen or miss the boundary.
  const sandbox = isolated
    ? { writableRoots: paths.map((p) => path.resolve(p)) }
    : undefined;

  // Generate unique instance ID for this CLI process
  // This allows multiple CLI instances to be tracked separately
  const instanceId = randomUUID();

  let client: ConvoyClient | null = null;
  let running = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let sessionId: string | null = null;
  let profileId: string | null = null;
  let messageHandler: MessageHandler | null = null;
  let stopSession: () => void = () => {};
  let stopPromise: Promise<void> | null = null;
  // Settled during registration, once codex's version is known: the requested
  // transport, downgraded to exec when the installed codex is too old.
  let effectiveCodexAppServer = codexAppServer ?? false;

  // Asked from the backend on each registration; the guess only until then.
  let httpBaseUrl = toConvexSiteUrl(convexUrl);

  /**
   * Register the agent with the backend
   */
  async function registerAgent(takeOver = force): Promise<void> {
    httpBaseUrl = await resolveConvexSiteUrl(convexUrl);
    const availableClis: DetectedCli[] = await detectAvailableClis({ codexProvider: options.codexProvider, claudeAuth: options.claudeAuth,
      antigravityAuth: options.antigravityAuth, opencodeAuth: options.opencodeAuth });

    if (!streamFile && availableClis.length === 0) {
      throw new ConnectDiagnosticError(process.env.CONVOY_PROJECT_IDENTITY
        ? `No runtime started in this project. Detected for this project: ${process.env.CONVOY_PROJECT_RUNTIMES || "none"}. Install ${Object.values(loginRuntimeLabels).join(", ")} root-owned, for example under /usr/local/bin, then reload the project.`
        : "No supported CLI runtime was detected on PATH. Install Claude Code or use --stream for fixture-based testing.", "runtime-missing");
    }

    // Credentialed Codex never downgrades: exec cannot carry the provider checks.
    if (codexAppServer && !options.codexAuth && !options.codexProvider && !supportsCodexAppServer(availableClis)) {
      effectiveCodexAppServer = false;
      const codex = availableClis.find((cli) => cli.type === "codex");
      if (codex) {
        console.log(
          chalk.yellow(
            `⚠ codex ${codex.version} predates the app-server protocol (needs ${MIN_CODEX_APP_SERVER_VERSION.slice(2)}); Codex threads will run through \`codex exec\`. Upgrade codex-cli for approvals, plan mode, and steering.`
          )
        );
      }
    }

    // Detect git remote URLs for each path in parallel
    const pathsWithRemotes = await Promise.all(
      paths.map(async (p) => ({
        path: p,
        gitRemoteUrl: (await getGitRemoteUrl(p)) ?? undefined,
      }))
    );

    const effectiveName = connectionName ?? os.hostname();

    const response = await postJsonWithTimeout(
      `${httpBaseUrl}/api/agent/register`,
      apiKey,
      {
        instanceId,
        projectId,
        hostname: os.hostname(),
        name: effectiveName,
        appVersion: getCliVersion(),
        profileKey,
        paths: pathsWithRemotes,
        availableClis,
        supportsPartialStreaming: partialStreaming ?? false,
        supportsInteractiveApprovals: true,
        // Legacy boolean kept for older backends; `steeringCliTypes` is the
        // per-runtime capability (codex steers only over app-server).
        supportsSteering: true,
        steeringCliTypes: effectiveCodexAppServer
          ? ["claude-code", "codex", "antigravity"]
          : ["claude-code", "antigravity"],
        force: takeOver,
      },
      5000
    ).catch(() => {
      throw new ConnectDiagnosticError(`Cannot reach Convoy at ${httpBaseUrl}. Check this host's network, DNS and proxy.`, "backend-unreachable");
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        activeSessionCount?: number;
      };

      // Handle session conflict - throw specific error so CLI can prompt user
      if (response.status === 409 && errorData.code === "SESSION_CONFLICT") {
        throw new SessionConflictError(
          errorData.error ?? "Another CLI session is already active for this folder.",
          errorData.activeSessionCount ?? 1
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new ConnectDiagnosticError("Convoy rejected this project's API key. It may be revoked or expired.", "auth-rejected");
      }
      const errorMessage = errorData.error ?? "Failed to register agent";
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as { sessionId: string; profileId: string };
    sessionId = data.sessionId;
    profileId = data.profileId;
    emitConnectEvent({ event: "status", status: "online", sessionId, versions: Object.fromEntries(availableClis.map(cli => [cli.type, cli.version])) });
    console.log(chalk.green("✓") + " Agent registered");
    console.log(chalk.dim(`[Registered] Instance: ${instanceId.slice(0, 8)}..., Profile: ${profileId.slice(0, 8)}...`));

    if (availableClis.length > 0) {
      console.log(chalk.dim(`[CLIs] ${availableClis.map(formatDetectedCli).join(", ")}`));
    } else {
      console.log(chalk.dim("[CLIs] none detected"));
    }
  }

  function reportHeartbeatRetry(message: string): void {
    if (!running) return;
    emitConnectEvent({ event: "status", status: "retrying", message });
    console.log(chalk.dim(`[Heartbeat] ${message}, will retry...`));
  }

  function exitReplaced(): void {
    // Exit code 3 tells supervisors not to respawn (another CLI took over).
    emitConnectEvent({
      event: "status",
      status: "failed",
      message: "Session was replaced or its profile deleted",
    });
    console.log(chalk.yellow("\nSession was replaced or its profile deleted."));
    console.log(chalk.dim("Exiting..."));
    running = false;
    exitAfterFlush(EXIT_SESSION_REPLACED);
  }

  /** The sweep deleted a session that slept past VISIBLE_THRESHOLD_MS: register again unless the profile is gone or taken. */
  async function recoverLostSession(): Promise<void> {
    const profiles = await client!.query(api.cli.profiles.listByProject, { projectId: projectId as Id<"projects"> });
    if (!running) return;
    if (!profiles.some((profile: { _id: string }) => profile._id === profileId)) return exitReplaced();
    reportHeartbeatRetry("Session expired while offline, registering again");
    try {
      await registerAgent(false);
    } catch (error) {
      if (error instanceof SessionConflictError) return exitReplaced();
      throw error;
    }
    if (!running) return;
    stopSession();
    await messageHandler?.shutdown();
    stopSession = startSession();
  }

  async function handleHeartbeatResult(result: string): Promise<void> {
    if (!running) return;
    if (result === "ok") {
      emitConnectEvent({ event: "status", status: "online", sessionId: sessionId ?? undefined });
      const parts = [`[Heartbeat] ${new Date().toISOString()}`];
      if (profileKey) parts.push(`Profile: ${profileKey}`);
      parts.push(`Endpoint: ${convexUrl}`);
      console.log(chalk.dim(parts.join(" | ")));
    } else if (result === "session_not_found") {
      await recoverLostSession();
    } else if (result === "unauthorized") {
      // Auth is broken (revoked API key): fatal, but a supervisor may respawn.
      emitConnectEvent({
        event: "status",
        status: "failed",
        message: "Heartbeat authentication failed",
        reason: "auth-rejected",
      });
      console.log(chalk.red("\nHeartbeat authentication failed. Exiting."));
      running = false;
      exitAfterFlush(EXIT_FATAL);
    } else {
      // A status newer than this CLI: not a reason to exit.
      reportHeartbeatRetry(`Heartbeat status ${result}`);
    }
  }

  /**
   * Heartbeat over the Convex client: one function call (OS-2551). The client
   * queues a mutation while its WebSocket reconnects, so one stays in flight at
   * a time; a slow one reports `retrying` and its reply still counts when it lands.
   */
  function sendHeartbeat(): void {
    if (!sessionId || !client || heartbeatInFlight) return;

    const slow = setTimeout(() => reportHeartbeatRetry("Heartbeat timed out"), 5000);
    heartbeatInFlight = true;
    client
      .mutation(api.cli.sessions.heartbeatByKey, { sessionId: sessionId as Id<"cliSessions"> })
      .then(handleHeartbeatResult)
      .catch((error: unknown) => {
        // Transient trouble (network, server error, older backend): keep the session.
        reportHeartbeatRetry(`Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        clearTimeout(slow);
        heartbeatInFlight = false;
      });
  }

  /**
   * Disconnect the agent session
   */
  async function disconnectAgent(): Promise<void> {
    if (!sessionId) return;

    try {
      await postJsonWithTimeout(`${httpBaseUrl}/api/agent/disconnect`, apiKey, { sessionId }, 2000);
      console.log(chalk.dim("[Disconnected]"));
    } catch (error) {
      // Abort is expected during shutdown; keep it quiet.
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      // Ignore - session will expire naturally
    }
  }

  /**
   * Subscribe to pending threads for this profile
   */
  function subscribeToPendingChats(): () => void {
    if (!client || !profileId) {
      return () => {};
    }

    console.log(chalk.dim("[Subscribed] Listening for pending threads..."));

    return client.subscribe(
      api.cli.threads.lists.listPendingThreads,
      { profileId: profileId as Id<"cliProfiles"> },
      {
        onUpdate: (threads) => {
          messageHandler?.syncPendingChats(threads);
        },
        onError: (error) => {
          console.error(chalk.red(`[Subscription] ${error.message}`));
        },
      }
    );
  }

  /** Wire the subscriptions and message handler to the current session; returns their teardown. */
  function startSession(): () => void {
    // Fulfill web-requested worktree ops (rescan/remove) and push the
    // initial worktree scan so synced entries appear in the selector.
    const worktreeOps = createWorktreeOpProcessor(client!, sessionId!, profileId!);
    void worktreeOps.scanAndSync(paths).catch((error) => {
      console.error(chalk.red(`[Worktree] Initial scan failed: ${error instanceof Error ? error.message : String(error)}`));
    });
    // Repos in a multi-repo folder, refreshed before each run too (cli-multi-repo-projects.md#when-it-runs).
    const syncRepos = (folder: string, syncOptions?: { published?: boolean }) =>
      (paths.includes(folder) ? worktreeOps.syncRepos(folder, syncOptions) : Promise.resolve([]));

    for (const folder of paths) {
      void syncRepos(folder).catch((error: unknown) => {
        console.error(chalk.yellow(`[Repos] Scan of ${folder} failed: ${error instanceof Error ? error.message : String(error)}`));
      });
    }
    const unsubscribeWorktreeOps = client!.subscribe(
      api.cli.worktreeOps.listPending,
      { profileId: profileId! as Id<"cliProfiles"> },
      {
        onUpdate: (ops) => {
          worktreeOps.enqueue(ops);
        },
        onError: (error) => {
          console.error(chalk.red(`[Worktree] ${error.message}`));
        },
      }
    );

    // Route answered approval requests back to parked provider callbacks.
    const interactionRouter = createInteractionRouter();
    const unsubscribeInteractions = client!.subscribe(
      api.cli.interactionRequests.listAnsweredBySession,
      { sessionId: sessionId! as Id<"cliSessions"> },
      {
        onUpdate: (answered) => {
          interactionRouter.dispatch(
            answered.map((item: { requestId: string; responseJson?: string }) => ({
              requestId: item.requestId,
              responseJson: item.responseJson ?? "{}",
            }))
          );
        },
        onError: (error) => {
          console.error(chalk.red(`[Approvals] ${error.message}`));
        },
      }
    );

    // Create message handler (needs sessionId from registration)
    messageHandler = createMessageHandler(
      (cliType) =>
        createRunnerForCliType(cliType, {
          streamFile,
          streamDelayMs,
          partialStreaming,
          codexAppServer: effectiveCodexAppServer,
          codexAuth: options.codexAuth,
          codexProvider: options.codexProvider,
          claudeAuth: options.claudeAuth,
          cursorAuth: options.cursorAuth,
          antigravityAuth: options.antigravityAuth,
          opencodeAuth: options.opencodeAuth,
          sandbox,
        }),
      client!,
      sessionId!,
      {
        maxConcurrentChats,
        interactionRouter,
        syncRepos,
      }
    );

    const unsubscribe = subscribeToPendingChats();
    return () => {
      unsubscribe();
      unsubscribeInteractions();
      unsubscribeWorktreeOps();
    };
  }

  return {
    async run(): Promise<void> {
      running = true;

      // Create Convex client
      client = createConvexClient({
        url: convexUrl,
        apiKey,
        secrets: [
          // Isolated profiles take no provider_key, so at most one Claude token exists.
          options.claudeProviderToken ?? (options.claudeAuth?.mode === "disabled" ? undefined : options.claudeAuth?.secret),
          codexSecret(options.codexAuth, options.codexProvider),
          options.cursorAuth?.mode === "managed" ? options.cursorAuth.secret : undefined,
          options.antigravityAuth?.mode === "managed" ? options.antigravityAuth.secret : undefined,
          ...(options.opencodeAuth?.mode === "managed" ? Object.values(options.opencodeAuth.keys).map((key) => typeof key === "string" ? key : key.secret) : []),
        ],
      });

      // Register agent
      await registerAgent();

      stopSession = startSession();

      // Start heartbeat (every 30 seconds)
      heartbeatInterval = setInterval(sendHeartbeat, 30000);

      // Keep running until stopped
      await new Promise<void>((resolve) => {
        const checkRunning = setInterval(() => {
          if (!running) {
            clearInterval(checkRunning);
            stopSession();
            resolve();
          }
        }, 100);
      });
    },

    async stop(): Promise<void> {
      if (stopPromise) {
        await stopPromise;
        return;
      }

      stopPromise = (async () => {
        running = false;

        // Clear heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        if (messageHandler) {
          await messageHandler.shutdown();
          messageHandler = null;
        }

        // The shared opencode serve process outlives per-thread runners.
        await shutdownOpencodeServer().catch(() => {});

        // Disconnect agent session
        await disconnectAgent();

        // Close client
        if (client) {
          await client.close();
          client = null;
        }
      })();

      try {
        await stopPromise;
      } finally {
        stopPromise = null;
      }
    },
  };
}
