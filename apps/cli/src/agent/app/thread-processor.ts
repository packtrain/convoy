import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";
import {
  CLI_MODES,
  RunnerExecutionError,
  type CliMode,
  type CliRuntimeRunner,
  type ContentChunk,
  type InteractionBridge,
  type PreparedRuntimeExecution,
  type RunnerExecutionResult,
} from "../runtimes/contracts.js";
import { createScriptRunner } from "./script-runner.js";
import { prepareWorktree, unapprovedWorktreeSetupMessage, unapprovedWorktreeSetupNotice } from "./worktree-setup.js";
import { projectFolderInstruction, repositoryContextInstruction, withPromptLine, withRunAttachmentInstructions } from "../runtimes/agent-instructions.js";
import type { InteractionRouter } from "./interaction-router.js";
import { getDebugLevel } from "../runtimes/debug.js";
import { getChunkStreamPolicy, isInlineImageAttachment, normalizeCliRuntimeModel, prepareRunExecution, signalsVcsStateChange } from "../runtimes/registry.js";
import { createChunkFlushBuffer, type ChunkFlushBuffer } from "./chunk-flush-buffer.js";
import { createThreadAttachmentCache } from "./thread-attachment-cache.js";
import { captureRunBaseline, captureRunChanges, createWorktree, folderRepoPaths, getCurrentBranch, readRepoBranches, type RunBaseline, type RunDiffSummary } from "../../lib/git/index.js";
import { lookupRepoPullRequests, lookupThreadPullRequest } from "../../lib/pull-requests.js";
import { DEFAULT_MAX_CONCURRENT_CHATS, MESSAGE_HANDLER_SHUTDOWN_TIMEOUT_MS } from "./runtime-config.js";
import { emitConnectEvent } from "../../lib/connect-events.js";
import { formatWorkspaceNotice, resolveRunWorkspace } from "./workspace-resolution.js";
import { resolveExecutionWorkspace, workingDirectoryExists } from "../../lib/git/worktrees.js";

const CLAIM_LEASE_MS = 120_000;
const CLAIM_HEARTBEAT_MS = 30_000;
const ATTACHMENT_CACHE_GC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLI_SHUTDOWN_REASON = "CLI stopped during response generation";

/** A single pending chat from the listPendingThreads query */
export type PendingChat = FunctionReturnType<typeof api.cli.threads.lists.listPendingThreads>[number];

/** A single unprocessed user message in a claimed chat */
export type UnprocessedUserMessage = FunctionReturnType<typeof api.cli.messages.listUnprocessedUserMessages>[number];
/** A queued user message the user asked to inject into the active run */
export type SteerRequestedUserMessage = FunctionReturnType<typeof api.cli.messages.listSteerRequestedUserMessages>[number];
export type ThreadResumeHandle = FunctionReturnType<typeof api.cli.messages.getResumeHandleForThread>;

export interface MessageHandler {
  /** Add a pending chat to the processing queue */
  enqueueChat(chat: PendingChat): void;
  /** Apply a full `listPendingThreads` result: enqueue each chat, drop parked ones no longer pending (OS-2625). */
  syncPendingChats(chats: PendingChat[]): void;
  /** Whether a chat is currently being processed */
  isProcessing(): boolean;
  /** Cleanup background resources. */
  shutdown(): Promise<void>;
}

export interface MessageHandlerOptions {
  attachmentCacheDir?: string;
  attachmentCacheTtlMs?: number;
  attachmentCacheGcIntervalMs?: number;
  maxConcurrentChats?: number;
  interactionRouter?: InteractionRouter;
  /** The working directory's repos by relative path, [] unless it is a multi-repo folder; syncs them in the background, or before resolving with `published`. */
  syncRepos?: (folder: string, options?: { published?: boolean }) => Promise<string[]>;
  /** One per script run (OS-1886), so abort stays scoped to its chat; defaults to the real `bash -c` runner. */
  createScriptRunner?: () => CliRuntimeRunner;
}

function normalizeCliMode(mode: unknown): CliMode | undefined {
  return CLI_MODES.includes(mode as CliMode) ? (mode as CliMode) : undefined;
}

function extractMessageText(message: UnprocessedUserMessage): string {
  return message.content.map((chunk: { data: string }) => chunk.data).join("\n");
}

/**
 * Select messages for one run while honoring solo-run boundaries. A runtime
 * command ("/compact") is always its own run so runtimes can deliver it raw,
 * and so is a Workflow script request (OS-1886), which the script runner
 * executes; prose messages share a run up to the next boundary. Remaining
 * messages are picked up by the following loop iteration.
 */
export function sliceRunMessagesAtSoloRunBoundary(messages: UnprocessedUserMessage[]): UnprocessedUserMessage[] {
  const boundary = messages.findIndex((message) => message.runtimeCommand === true || message.scriptRequest !== undefined);
  if (boundary === 0) {
    return messages.slice(0, 1);
  }
  if (boundary > 0) {
    return messages.slice(0, boundary);
  }
  return messages;
}

type ResolvedAttachment = {
  storageId: string;
  fileName: string;
  contentType: string;
  localPath: string;
  inlineImage: boolean;
};

type ResolvedAttachmentMap = Map<string, ResolvedAttachment[]>;

async function resolveAttachmentsForMessages(
  cliType: string,
  threadId: string,
  messages: UnprocessedUserMessage[],
  cache: ReturnType<typeof createThreadAttachmentCache>
): Promise<ResolvedAttachmentMap> {
  const resolved = new Map<string, ResolvedAttachment[]>();

  for (const message of messages) {
    const messageAttachments: ResolvedAttachment[] = [];

    for (const attachment of message.attachments) {
      if (!attachment.url) {
        continue;
      }

      let localPath: string;
      try {
        localPath = await cache.ensureLocalPath({
          threadId,
          storageId: attachment.storageId,
          fileName: attachment.fileName,
          url: attachment.url,
        });
      } catch (error) {
        console.warn("[Attachment] Failed to resolve local attachment path", {
          storageId: attachment.storageId,
          fileName: attachment.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      messageAttachments.push({
        storageId: attachment.storageId,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        localPath,
        inlineImage: isInlineImageAttachment(cliType, attachment.contentType),
      });
    }

    resolved.set(message._id as string, messageAttachments);
  }

  return resolved;
}

function resolveRunCliMode(messages: UnprocessedUserMessage[]): CliMode | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const mode = normalizeCliMode(messages[index]?.cliMode);
    if (mode) {
      return mode;
    }
  }
  return undefined;
}

function resolveRunCliModel(cliType: string, messages: UnprocessedUserMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const model = normalizeCliRuntimeModel(cliType, messages[index]?.cliModel);
    if (model) {
      return model;
    }
  }
  return undefined;
}

function debugClaimEvent(kind: string, payload: unknown): void {
  if (getDebugLevel() < 1) {
    return;
  }

  let rendered = "";
  try {
    rendered =
      typeof payload === "string" ? payload : JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? String(value) : value));
  } catch {
    rendered = String(payload);
  }

  const compact = rendered.replace(/\s+/g, " ").trim();
  console.log(`[Claim:${kind}] ${compact}`);
}

function isStaleRunStartError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("One or more user messages are no longer pending");
}

/**
 * Create a handler that processes pending threads with bounded concurrency.
 *
 * Flow per chat: claimThread -> while(listUnprocessedUserMessages) startRunResponse -> stream -> complete/fail -> releaseClaim
 */
export function createMessageHandler(
  createRunner: (cliType: string) => CliRuntimeRunner | null,
  client: ConvoyClient,
  sessionId: string,
  options: MessageHandlerOptions = {}
): MessageHandler {
  const configuredMaxConcurrentChats = options.maxConcurrentChats;
  const maxConcurrentChats =
    configuredMaxConcurrentChats != null && Number.isInteger(configuredMaxConcurrentChats) && configuredMaxConcurrentChats > 0
      ? configuredMaxConcurrentChats
      : DEFAULT_MAX_CONCURRENT_CHATS;
  const newScriptRunner = options.createScriptRunner ?? createScriptRunner;
  const queue: PendingChat[] = [];
  const queuedChatIds = new Set<string>();
  const activeChatIds = new Set<string>();
  // Threads that flipped back to pending while their worker was still
  // running (edit-resend, OS-1374): the pending-list subscription fires once
  // at that moment and not again after the worker exits, so remember the
  // chat and re-enqueue it when the worker drains.
  const deferredChats = new Map<string, PendingChat>();
  const activeRunners = new Map<string, CliRuntimeRunner>();
  const typedSessionId = sessionId as Id<"cliSessions">;
  const attachmentCache = createThreadAttachmentCache({
    rootDir: options.attachmentCacheDir,
    ttlMs: options.attachmentCacheTtlMs,
  });
  void attachmentCache.runGc();
  const attachmentGcInterval = setInterval(() => {
    void attachmentCache.runGc();
  }, options.attachmentCacheGcIntervalMs ?? ATTACHMENT_CACHE_GC_INTERVAL_MS);
  attachmentGcInterval.unref?.();

  let shuttingDown = false;
  const idleWaiters: Array<() => void> = [];

  function resolveIdleWaitersIfIdle(): void {
    if (activeChatIds.size !== 0) {
      return;
    }
    while (idleWaiters.length > 0) {
      const resolve = idleWaiters.shift();
      resolve?.();
    }
  }

  async function waitForWorkersToDrain(timeoutMs: number): Promise<boolean> {
    if (activeChatIds.size === 0) {
      return true;
    }

    let idleResolver: (() => void) | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    const drainedPromise = new Promise<"drained">((resolve) => {
      idleResolver = () => {
        resolve("drained");
      };
      idleWaiters.push(idleResolver);
    });
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
      timeoutHandle.unref?.();
    });

    const result = await Promise.race([drainedPromise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (result === "timeout" && idleResolver) {
      const idleResolverIndex = idleWaiters.indexOf(idleResolver);
      if (idleResolverIndex >= 0) {
        idleWaiters.splice(idleResolverIndex, 1);
      }
    }

    return result === "drained";
  }

  async function ensureClaimHeartbeat(threadId: Id<"cliThreads">): Promise<void> {
    debugClaimEvent("heartbeat_request", {
      threadId: threadId as string,
      leaseMs: CLAIM_LEASE_MS,
    });

    let ok = false;
    try {
      ok = await client.mutation(api.cli.threads.runControl.heartbeatClaim, {
        threadId,
        sessionId: typedSessionId,
        leaseMs: CLAIM_LEASE_MS,
      });
    } catch (error) {
      debugClaimEvent("heartbeat_error", {
        threadId: threadId as string,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (!ok) {
      debugClaimEvent("lease_lost", {
        threadId: threadId as string,
      });
      throw new Error("Lost chat claim lease");
    }

    debugClaimEvent("heartbeat_ok", {
      threadId: threadId as string,
      leaseMs: CLAIM_LEASE_MS,
    });
  }

  async function processChat(chat: PendingChat, runner: CliRuntimeRunner): Promise<void> {
    const shortId = (chat._id as string).slice(0, 8);

    // While the worktree spec is pending, `workingDirectory` is the parent
    // repo; it is swapped for the created worktree before the first run.
    let workingDirectory = chat.workingDirectory;
    let pendingWorktree = chat.worktree?.status === "pending" ? chat.worktree : null;
    let executionWorktree = chat.worktree;
    // A repo or repo-worktree thread's folder, as the server resolves it (cli-multi-repo-projects.md#folder-access).
    let projectFolder = chat.projectFolder;
    let workspaceNotice = chat.previousWorkingDirectory
      ? { previousPath: chat.previousWorkingDirectory, path: workingDirectory }
      : undefined;

    // Branch snapshot (OS-1247), per repo in a multi-repo folder (OS-2523); null (detached HEAD / non-Git)
    // clears it. Display metadata only — fail soft, never block the run.
    const reportBranch = async (path: string, repoPaths: string[] | null): Promise<void> => {
      try {
        await client.mutation(api.cli.threads.runControl.reportExecutionBranch, {
          threadId: chat._id,
          sessionId: typedSessionId,
          ...(repoPaths ? { repos: await readRepoBranches(path, repoPaths) } : { branch: (await getCurrentBranch(path)) ?? undefined }),
          path,
        });
      } catch {
        // ignore: branch display must never interfere with execution
      }
    };

    // Branch + last-known PR (OS-1370) snapshot. Display metadata
    // only — strictly fail-soft, must never interfere with execution.
    const reportVcsSnapshot = async (): Promise<void> => {
      const repoPaths = await folderRepoPaths(workingDirectory);
      await reportBranch(workingDirectory, repoPaths);

      // A failed lookup reports nothing (last-known snapshot survives); only
      // a successful lookup writes — or clears — the snapshot.
      try {
        if (repoPaths) {
          const repos = await lookupRepoPullRequests(workingDirectory, repoPaths);
          if (repos.length > 0) {
            await client.mutation(api.cli.threads.runControl.reportPullRequest, {
              threadId: chat._id, sessionId: typedSessionId, repos, path: workingDirectory,
            });
          }
          return;
        }
        const lookup = await lookupThreadPullRequest(workingDirectory);
        if (lookup) {
          await client.mutation(api.cli.threads.runControl.reportPullRequest, {
            threadId: chat._id,
            sessionId: typedSessionId,
            pullRequest: lookup.pullRequest ?? undefined,
            path: workingDirectory,
          });
        }
      } catch {
        // ignore: PR display must never interfere with execution
      }
    };

    // Mid-run VCS signals (OS-1386 vcs_state_changed, OS-1387
    // code_change_published) coalesce into one in-flight refresh with a
    // trailing re-run, so a burst of commits spawns one forge-CLI lookup.
    let vcsRefreshRunning = false;
    let vcsRefreshQueued = false;
    const scheduleVcsSnapshotRefresh = (): void => {
      if (vcsRefreshRunning) {
        vcsRefreshQueued = true;
        return;
      }
      vcsRefreshRunning = true;
      void (async () => {
        do {
          vcsRefreshQueued = false;
          await reportVcsSnapshot();
        } while (vcsRefreshQueued);
        vcsRefreshRunning = false;
      })();
    };

    const claimed = await client.mutation(api.cli.threads.runControl.claimThread, {
      threadId: chat._id,
      sessionId: typedSessionId,
      leaseMs: CLAIM_LEASE_MS,
    });

    if (!claimed) {
      console.log(chalk.dim(`[Skip] chat ${shortId} already claimed`));
      return;
    }

    console.log(chalk.dim(`[Claimed] chat ${shortId}`));
    emitConnectEvent({ event: "thread", phase: "claimed", threadId: chat._id as string });

    try {
      while (true) {
        if (shuttingDown) {
          break;
        }

        // ConvoyClient injects the configured API key on every query.
        const allPendingMessages: UnprocessedUserMessage[] = await client.query(api.cli.messages.listUnprocessedUserMessages, {
          threadId: chat._id,
          includeInterruptedContext: chat.cliType === "claude-code" || chat.cliType === "codex",
        });

        const queuedMessages = allPendingMessages.filter((message) => !message.contextOnly);
        if (queuedMessages.length === 0) {
          break;
        }

        const pendingMessages = sliceRunMessagesAtSoloRunBoundary(queuedMessages);
        // A script request is always a solo run (the boundary above), executed
        // by the script runner in place of the agent runtime (OS-1886).
        const scriptRequest = pendingMessages[0]?.scriptRequest;
        // Script and runtime-command runs skip the agent-facing extras (interrupted context, attach line, notices).
        const isPlainRun = !scriptRequest && !pendingMessages[0]?.runtimeCommand;
        const runRunner = scriptRequest ? newScriptRunner() : runner;
        activeRunners.set(chat._id as string, runRunner);

        await ensureClaimHeartbeat(chat._id);

        const includesInterruptedContext = isPlainRun &&
          (chat.cliType === "claude-code" || chat.cliType === "codex");
        const inputMessages = includesInterruptedContext
          ? [...allPendingMessages.filter((message) => message.contextOnly), ...pendingMessages] : pendingMessages;
        const resolvedAttachments = await resolveAttachmentsForMessages(chat.cliType, chat._id as string, inputMessages, attachmentCache);
        const cliMode = resolveRunCliMode(pendingMessages);
        const cliModel = resolveRunCliModel(chat.cliType, pendingMessages);
        const runtimeExecution: PreparedRuntimeExecution = scriptRequest
          ? { prompt: scriptRequest.script, inputFormat: "prompt" }
          : await prepareRunExecution(chat.cliType, {
              messages: inputMessages.map((message) => ({
                contextOnly: message.contextOnly,
                id: message._id as string,
                createdAt: message.createdAt,
                cliMode: normalizeCliMode(message.cliMode),
                taskRef: message.task?.refId,
                pullRequest: message.pullRequest,
                contentText: extractMessageText(message),
                runtimeCommand: !message.contextOnly && message.runtimeCommand === true,
                attachments: resolvedAttachments.get(message._id as string) ?? [],
              })),
            });
        const resume: ThreadResumeHandle = await client.query(api.cli.messages.getResumeHandleForThread, {
          threadId: chat._id,
        });
        // A deleted repo leaves the server's list first, so the run starts in its folder (cli-multi-repo-projects.md#vanished-repo).
        if (projectFolder && !executionWorktree && !(await workingDirectoryExists(workingDirectory))) {
          await options.syncRepos?.(projectFolder, { published: true }).catch(() => []);
        }
        let started: FunctionReturnType<typeof api.cli.messages.startRunResponse> | undefined;
        try {
          started = await client.mutation(api.cli.messages.startRunResponse, {
            threadId: chat._id,
            sessionId: typedSessionId,
            userMessageIds: pendingMessages.map((message) => message._id),
          });
        } catch (error) {
          if (isStaleRunStartError(error)) {
            console.log(chalk.dim(`[Skip] chat ${shortId} stale pending message snapshot while starting run`));
            continue;
          }

          const isClaimActive = await client.query(api.cli.threads.runControl.isClaimActiveForSession, {
            threadId: chat._id,
            sessionId: typedSessionId,
          });
          if (!isClaimActive) {
            console.log(chalk.dim(`[Skip] chat ${shortId} claim no longer active`));
            break;
          }

          throw error;
        }

        if (!started) {
          console.log(chalk.dim(`[Skip] chat ${shortId} could not start a response run for pending messages`));
          continue;
        }

        emitConnectEvent({ event: "thread", phase: "streaming", threadId: chat._id as string, runId: started.runId });
        let runExecution = isPlainRun
          ? withRunAttachmentInstructions(runtimeExecution, {
              threadId: chat._id as string,
              messageId: started.assistantMessageId as string,
              sessionId: typedSessionId as string,
            })
          : runtimeExecution;

        let execution: AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> | undefined;
        let claimLost = false;
        let claimHeartbeatError: Error | null = null;
        let claimPollError: Error | null = null;
        // Latched: a Stop that lands before the worktree setup script spawns still stops it.
        const runAbort = new AbortController();
        const abortRun = () => {
          runRunner.abort();
          runAbort.abort();
        };
        let claimHeartbeatTimer: NodeJS.Timeout | null = null;
        let unsubscribeClaim: (() => void) | null = null;
        let flushBuffer: ChunkFlushBuffer | null = null;
        let unsubscribeSteer: (() => void) | null = null;
        // Serializes steer handling; every link catches, so awaiting it never throws.
        let steerChain: Promise<void> = Promise.resolve();
        let lastHeartbeatAt = Date.now();

        try {
          claimHeartbeatTimer = setInterval(() => {
            void ensureClaimHeartbeat(chat._id).catch((error) => {
              if (!claimHeartbeatError) {
                claimHeartbeatError = error instanceof Error ? error : new Error(String(error));
              }
              abortRun();
            });
          }, CLAIM_HEARTBEAT_MS);
          claimHeartbeatTimer.unref?.();

          // Watch the claim instead of polling it: a poll's cost scaled with run
          // duration (a 20-minute run re-read the thread 400×), and a
          // subscription reacts on the write rather than up to an interval later
          // (OS-1719).
          unsubscribeClaim = client.subscribe(
            api.cli.threads.runControl.isClaimActiveForSession,
            { threadId: chat._id, sessionId: typedSessionId, messageId: started.assistantMessageId },
            {
              onUpdate: (isClaimActive) => {
                if (isClaimActive || claimPollError) {
                  return;
                }
                claimPollError = new Error("Chat claim no longer active");
                abortRun();
              },
              onError: (error) => {
                if (claimPollError) {
                  return;
                }
                claimPollError = error instanceof Error ? error : new Error(String(error));
                abortRun();
              },
            }
          );

          const workspace = started.workspace ?? (pendingWorktree
            ? await client.query(api.cli.worktrees.getExecutionWorkspace, { threadId: chat._id, sessionId: typedSessionId })
            : undefined);
          if (workspace?.repoRemoved && workspace.previousPath) {
            const moved = { previousPath: workspace.previousPath, path: workspace.path };
            await client.mutation(api.cli.messages.appendRunContent, {
              messageId: started.assistantMessageId,
              sessionId: typedSessionId,
              chunks: [{ type: "convoy_notice", data: JSON.stringify({
                code: "workspace-recovered", title: "Working directory recovered", message: formatWorkspaceNotice(moved), change: "folder", ...moved,
              }) }],
            });
          }
          if (workspace) {
            projectFolder = workspace.projectFolder;
            workingDirectory = workspace.path;
            executionWorktree = workspace.worktree;
            pendingWorktree = workspace.worktree?.status === "pending" ? workspace.worktree : null;
          }
          let createdWorktreeThisRun = false;

          // One factory for the setup output and the run, so both stream under the runtime's policy.
          const newFlushBuffer = () => createChunkFlushBuffer({
            policy: getChunkStreamPolicy(chat.cliType),
            secrets: client.secrets,
            send: (chunks) =>
              client.mutation(api.cli.messages.appendRunContent, {
                messageId: started.assistantMessageId,
                sessionId: typedSessionId,
                chunks,
              }),
          });

          if (pendingWorktree) {
            const spec = pendingWorktree;
            const setup = started.worktreeSetup;
            if (setup?.status === "unapproved") {
              await client.mutation(api.cli.messages.appendRunContent, {
                messageId: started.assistantMessageId,
                sessionId: typedSessionId,
                chunks: [unapprovedWorktreeSetupNotice(setup.repoKey)],
              });
              throw new Error(unapprovedWorktreeSetupMessage(setup.repoKey));
            }
            await resolveExecutionWorkspace(workingDirectory);
            await client.mutation(api.cli.messages.appendRunContent, {
              messageId: started.assistantMessageId,
              sessionId: typedSessionId,
              chunks: [
                {
                  type: "convoy_notice",
                  data: JSON.stringify({
                    code: "worktree-create",
                    title: "Worktree",
                    message: `Creating worktree for branch \`${spec.branch}\`${spec.baseRef ? ` from \`${spec.baseRef}\`` : ""}…`,
                    previousPath: workingDirectory, branch: spec.branch, baseRef: spec.baseRef,
                  }),
                },
              ],
            });

            // Idempotent: an existing worktree on this branch (from a prior
            // failed attempt) is reused instead of erroring. The setup script
            // runs before `resolveCreated`, so a failure leaves the worktree pending.
            const setupFlush = newFlushBuffer();
            flushBuffer = setupFlush;
            const setupRunner = newScriptRunner();
            // CLI shutdown aborts `activeRunners`; route it to the latched abort.
            activeRunners.set(chat._id as string, { ...setupRunner, abort: abortRun });
            const prepared = await prepareWorktree({
              parentPath: workingDirectory,
              branch: spec.branch,
              create: () => createWorktree({
                parentPath: workingDirectory,
                branch: spec.branch,
                baseRef: spec.baseRef,
                startFromOrigin: spec.startFromOrigin,
              }),
              setup: setup?.status === "approved" ? setup : undefined,
              signal: runAbort.signal,
              threadId: chat._id as string,
              cliType: chat.cliType,
              runner: setupRunner,
              emit: (chunk) => {
                setupFlush.enqueue(chunk);
                if (setupFlush.failure) abortRun();
              },
            }).then((result) => ({ result }), (error: unknown) => ({ error }));
            activeRunners.set(chat._id as string, runRunner);
            // Drain first: the failure path stops the buffer, which would drop the script's last output.
            await setupFlush.drain();
            if (shuttingDown) throw new RunnerExecutionError(CLI_SHUTDOWN_REASON);
            if (claimHeartbeatError) throw claimHeartbeatError;
            if (claimPollError) throw claimPollError;
            if ("error" in prepared) throw prepared.error;
            const created = prepared.result;
            await client.mutation(api.cli.worktrees.resolveCreated, {
              threadId: chat._id,
              sessionId: typedSessionId,
              path: created.path,
              branch: spec.branch,
            });

            // Replaces the "Creating worktree…" divider (docs/specs/cli-worktrees.md#worktree-change-notices).
            await client.mutation(api.cli.messages.appendRunContent, {
              messageId: started.assistantMessageId,
              sessionId: typedSessionId,
              chunks: [{ type: "convoy_notice", data: JSON.stringify({
                code: "worktree-created", title: "Worktree",
                message: `Created worktree for branch \`${spec.branch}\` at ${created.path}.`,
                change: "created", previousPath: workingDirectory, path: created.path, branch: spec.branch, baseRef: spec.baseRef,
              }) }],
            });

            createdWorktreeThisRun = true;
            workingDirectory = created.path;
            executionWorktree = { ...spec, status: "created" };
            pendingWorktree = null;
            console.log(chalk.dim(`[Worktree] chat ${shortId} → ${created.path}${created.reused ? " (reused)" : ""}`));
          }

          let checkpointRunId = started.runId;
          const resolveWorkspace = async (snapshot?: FunctionReturnType<typeof api.cli.worktrees.getExecutionWorkspace>) => {
            const resolved = await resolveRunWorkspace(client, chat._id, typedSessionId, {
              workingDirectory, executionWorktree, workspaceNotice,
            }, snapshot);
            // The first run after `convoy threads move-worktree` shows the move (cli-worktrees.md#agent-driven-worktree-move).
            const movedByAgent = snapshot?.movedByAgent === true && resolved.workingDirectory === snapshot.path;
            if ((movedByAgent || resolved.workingDirectory !== workingDirectory) && resolved.workspaceNotice) {
              await client.mutation(api.cli.messages.appendRunContent, {
                messageId: started.assistantMessageId,
                sessionId: typedSessionId,
                chunks: [{ type: "convoy_notice", data: JSON.stringify({
                  code: movedByAgent ? "workspace-moved" : "workspace-recovered",
                  title: movedByAgent ? "Working directory moved" : "Working directory recovered",
                  message: formatWorkspaceNotice(resolved.workspaceNotice),
                  // Recovery keeps the worktree only when Git found it at a new path.
                  change: movedByAgent ? "agent" : resolved.executionWorktree ? "moved" : "parent",
                  ...resolved.workspaceNotice,
                  branch: await getCurrentBranch(resolved.workingDirectory).catch(() => null) ?? undefined,
                }) }],
              });
            }
            return resolved;
          };
          const snapshotRunStart = async (path: string, runId: string): Promise<RunBaseline | null> => {
            // Record the checkout actually used for this run.
            await reportBranch(path, await folderRepoPaths(path));

            // Pre-run git checkpoint (OS-1142), per repo in a multi-repo folder. Fail soft:
            // a checkpoint problem must never block the run; null also covers non-git directories.
            try {
              return await captureRunBaseline(path, chat._id as string, runId, { folder: projectFolder });
            } catch (error) {
              console.warn(
                chalk.yellow(
                  `[Checkpoint] chat ${shortId} pre-run capture failed: ${error instanceof Error ? error.message : String(error)}`
                )
              );
            }
            return null;
          };
          ({ workingDirectory, executionWorktree, workspaceNotice } = await resolveWorkspace(
            createdWorktreeThisRun ? undefined : workspace,
          ));
          let checkpointBaseline = await snapshotRunStart(workingDirectory, checkpointRunId);
          let additionalDirectories: string[] | undefined;
          if (isPlainRun) {
            const repos = await options.syncRepos?.(projectFolder ?? workingDirectory).catch((error: unknown) => {
              console.warn(chalk.yellow(`[Repos] chat ${shortId} scan failed: ${error instanceof Error ? error.message : String(error)}`));
              return [];
            }) ?? [];
            if (repos.length > 0) {
              runExecution = withPromptLine(runExecution, projectFolder
                ? projectFolderInstruction(projectFolder, workingDirectory, repos)
                : repositoryContextInstruction(repos));
            }
            additionalDirectories = projectFolder && repos.length > 0 ? [projectFolder] : undefined;
          }

          const interactionRouter = options.interactionRouter;
          const interactionCreates = new Map<string, Promise<unknown>>();
          const interactionBridge: InteractionBridge | undefined = interactionRouter
            ? {
                request(input, signal) {
                  return new Promise<string>((resolve, reject) => {
                    if (signal.aborted) {
                      reject(new Error("Approval request aborted"));
                      return;
                    }

                    const cleanup = () => {
                      interactionRouter.unregister(input.requestId);
                      signal.removeEventListener("abort", onAbort);
                    };
                    const onAbort = () => {
                      cleanup();
                      // Deliberately no server-side cancel (OS-1463): an abort is the CLI
                      // abandoning the run, and the pending row is the signal the wind-down
                      // mutations use to park the thread as waiting_input instead of failing
                      // it. They cancel the thread's pending rows themselves; racing a
                      // fire-and-forget cancel against them destroyed the signal.
                      reject(new Error("Approval request aborted"));
                    };

                    // Register before creating the row so an instant answer
                    // from the standing subscription cannot be missed.
                    interactionRouter.register(input.requestId, (responseJson) => {
                      cleanup();
                      resolve(responseJson);
                    });
                    signal.addEventListener("abort", onAbort);

                    const creation = client
                      .mutation(api.cli.interactionRequests.create, {
                        threadId: chat._id,
                        messageId: started.assistantMessageId,
                        sessionId: typedSessionId,
                        requestId: input.requestId,
                        kind: input.kind,
                        payloadJson: input.payloadJson,
                        expiresAt: Date.now() + CLAIM_LEASE_MS,
                      })
                      .catch((error) => {
                        cleanup();
                        reject(error instanceof Error ? error : new Error(String(error)));
                      });
                    interactionCreates.set(input.requestId, creation);
                    void creation.finally(() => interactionCreates.delete(input.requestId));
                  });
                },
                cancel(requestId, opts) {
                  interactionRouter.unregister(requestId);
                  // Abandonment (runner teardown/abort) keeps the server row pending (OS-1463):
                  // it is the signal the wind-down mutations use to park the thread as
                  // waiting_input, and they cancel the thread's rows themselves. Only a
                  // provider-withdrawn request — the run continues without it — cancels here.
                  if (opts.abandoned) {
                    return;
                  }
                  void (interactionCreates.get(requestId) ?? Promise.resolve())
                    .then(() => client.mutation(api.cli.interactionRequests.cancel, {
                      threadId: chat._id,
                      sessionId: typedSessionId,
                      requestId,
                      reason: opts.reason,
                    }))
                    .catch(() => {});
                },
              }
            : undefined;

          const steerRunner = runRunner.steer?.bind(runRunner);

          const deliversWorkspaceNotice = isPlainRun;
          const openExecution = () => {
            if (claimHeartbeatError) throw claimHeartbeatError;
            if (claimPollError) throw claimPollError;
            return runRunner.execute(workingDirectory, runExecution.prompt, {
              cliType: chat.cliType,
              threadId: chat._id as string,
              continuationId: resume?.continuationId,
              forkTurnId: resume?.forkTurnId,
              cliMode,
              cliModel,
              // Bound Project agent (OS-1138): the creation-time prompt
              // snapshot, never a live lookup. Attribution-only bindings carry
              // a name but no snapshot — runners then deliver nothing.
              agentPrompt: chat.agentPromptSnapshot,
              agentName: chat.agentName,
              workspaceNotice: deliversWorkspaceNotice && workspaceNotice
                ? formatWorkspaceNotice(workspaceNotice) : undefined,
              resolvedCliModel: started.resolvedCliModel,
              resolvedCliEffort: started.resolvedCliEffort,
              requireContinuation: resume !== null,
              inputFormat: runExecution.inputFormat,
              bootstrapInput: runExecution.bootstrapInput,
              runtimeCommand: runExecution.runtimeCommand,
              rawRuntimeCommand: runExecution.rawRuntimeCommand,
              scriptRequest,
              interactionBridge,
              steerEnabled: steerRunner !== undefined,
              additionalDirectories,
            });
          };

          execution = openExecution();

          if (steerRunner) {
            const startedRun = started;
            const handledSteerIds = new Set<string>();

            const handleSteeredMessages = async (messages: SteerRequestedUserMessage[]): Promise<void> => {
              const fresh = messages.filter((message) => !handledSteerIds.has(message._id as string));
              if (fresh.length === 0) {
                return;
              }
              for (const message of fresh) {
                handledSteerIds.add(message._id as string);
              }

              const steerAttachments = await resolveAttachmentsForMessages(
                chat.cliType,
                chat._id as string,
                fresh,
                attachmentCache
              );
              const injection = await prepareRunExecution(chat.cliType, {
                messages: fresh.map((message) => ({
                  id: message._id as string,
                  createdAt: message.createdAt,
                  cliMode: normalizeCliMode(message.cliMode),
                  taskRef: message.task?.refId,
                  pullRequest: message.pullRequest,
                  contentText: extractMessageText(message),
                  attachments: steerAttachments.get(message._id as string) ?? [],
                })),
              });

              // Push first, consume after: a run that already ended resolves
              // false and the messages stay queued for the next run; a
              // successful push is guaranteed a full turn, so a failed
              // consume degrades to a rare duplicate turn, never lost input.
              if (!(await steerRunner(injection, resolveRunCliMode(fresh)))) {
                for (const message of fresh) {
                  handledSteerIds.delete(message._id as string);
                }
                return;
              }

              await client.mutation(api.cli.messages.consumeSteeredMessages, {
                threadId: chat._id,
                sessionId: typedSessionId,
                assistantMessageId: startedRun.assistantMessageId,
                userMessageIds: fresh.map((message) => message._id),
              });
              console.log(chalk.dim(`[Steered] chat ${shortId} +${fresh.length} message(s)`));
            };

            unsubscribeSteer = client.subscribe(
              api.cli.messages.listSteerRequestedUserMessages,
              { threadId: chat._id, sessionId: typedSessionId },
              {
                onUpdate: (messages) => {
                  steerChain = steerChain
                    .then(() => handleSteeredMessages(messages))
                    .catch((error) => {
                      console.warn(
                        chalk.yellow(
                          `[Steer] chat ${shortId} failed to inject steered message: ${error instanceof Error ? error.message : String(error)}`
                        )
                      );
                    });
                },
              }
            );
          }

          // One in-flight append per message; deltas buffer while a send is in
          // flight and consecutive deltas coalesce per flush window (OS-991).
          flushBuffer = newFlushBuffer();

          let runResult: RunnerExecutionResult = {};
          let endedByShutdown = false;
          let producedOutput = false;
          let retriedLaunch = false;
          while (true) {
            let next: IteratorResult<ContentChunk, RunnerExecutionResult>;
            try {
              next = await execution.next();
            } catch (error) {
              const launchFailed = error instanceof RunnerExecutionError && error.launchFailed;
              if (
                producedOutput || retriedLaunch || !launchFailed || claimHeartbeatError || claimPollError ||
                await workingDirectoryExists(workingDirectory)
              ) throw error;
              await ensureClaimHeartbeat(chat._id);
              const previousDirectory = workingDirectory;
              checkpointRunId = `${started.runId}-recovered`;
              ({ workingDirectory, executionWorktree, workspaceNotice } = await resolveWorkspace());
              checkpointBaseline = await snapshotRunStart(workingDirectory, checkpointRunId);
              if (workingDirectory === previousDirectory) throw error;
              retriedLaunch = true;
              execution = openExecution();
              continue;
            }
            if (next.done) {
              runResult = next.value;
              endedByShutdown = shuttingDown;
              break;
            }

            producedOutput = true;
            flushBuffer.enqueue(next.value);

            if (signalsVcsStateChange(chat.cliType, next.value)) {
              scheduleVcsSnapshotRefresh();
            }

            if (flushBuffer.failure) {
              throw flushBuffer.failure;
            }
            if (claimHeartbeatError) {
              throw claimHeartbeatError;
            }
            if (claimPollError) {
              throw claimPollError;
            }

            if (Date.now() - lastHeartbeatAt >= CLAIM_HEARTBEAT_MS) {
              await ensureClaimHeartbeat(chat._id);
              lastHeartbeatAt = Date.now();
            }
          }

          await flushBuffer.drain();

          // Stop accepting steers and let any in-flight consume land before
          // completing, so it cannot race the next run snapshot.
          unsubscribeSteer?.();
          unsubscribeSteer = null;
          await steerChain;

          if (claimHeartbeatError) {
            throw claimHeartbeatError;
          }
          if (claimPollError) {
            throw claimPollError;
          }
          // A graceful interrupt returns normally; completing it would bury the prompt (OS-2098).
          if (endedByShutdown) {
            throw new RunnerExecutionError(CLI_SHUTDOWN_REASON, { continuationId: runResult.continuationId });
          }

          // Post-run checkpoint + change summary (OS-1142); null when nothing
          // changed. Same fail-soft rule as the pre-run capture.
          let diffSummary: RunDiffSummary | null = null;
          if (checkpointBaseline) {
            try {
              diffSummary = await captureRunChanges(workingDirectory, checkpointBaseline, chat._id as string, checkpointRunId);
            } catch (error) {
              console.warn(
                chalk.yellow(
                  `[Checkpoint] chat ${shortId} post-run capture failed: ${error instanceof Error ? error.message : String(error)}`
                )
              );
            }
          }

          await ensureClaimHeartbeat(chat._id);

          const completeArgs = {
            messageId: started.assistantMessageId,
            sessionId: typedSessionId,
            cliContext: runResult.continuationId ? {
              continuationId: runResult.continuationId,
              ...(runResult.turnId ? { turnId: runResult.turnId } : {}),
              ...(includesInterruptedContext ? { interruptedContextIncluded: true } : {}),
            } : undefined,
            diffSummary: diffSummary ?? undefined,
            scriptResult: runResult.scriptResult,
            workspaceNotice: deliversWorkspaceNotice ? workspaceNotice : undefined,
          };
          await client.mutation(api.cli.messages.complete, completeArgs).catch(async (error: unknown) => {
            // A backend older than CLI 0.187.0 rejects a multi-repo summary; the run still completes, without its card.
            if (!diffSummary?.repos || !String(error instanceof Error ? error.message : error).includes("ArgumentValidationError")) throw error;
            console.warn(chalk.yellow(`[Checkpoint] chat ${shortId}: the server is older than this CLI and can't store a multi-repo change summary`));
            await client.mutation(api.cli.messages.complete, { ...completeArgs, diffSummary: undefined });
          });

          if (deliversWorkspaceNotice) workspaceNotice = undefined;

          console.log(chalk.green(`[Completed] chat ${shortId} run ${started.runId}`));
          emitConnectEvent({ event: "thread", phase: "completed", threadId: chat._id as string, runId: started.runId });

          // Post-run branch + PR snapshot (OS-1247/OS-1370), after complete
          // so forge-CLI latency never delays the visible run completion. The
          // pre-run branch report goes stale when the agent switches or
          // creates a branch during the run.
          await reportVcsSnapshot();
        } catch (error) {
          // Prevent a stray buffered flush from landing after the fail
          // mutation and flipping the message back to "streaming".
          flushBuffer?.stop();

          const errorMessage = error instanceof Error ? error.message : String(error);

          let claimStillActive = true;
          try {
            claimStillActive = await client.query(api.cli.threads.runControl.isClaimActiveForSession, {
              threadId: chat._id,
              sessionId: typedSessionId,
              messageId: started.assistantMessageId,
            });
          } catch {
            // If we cannot verify claim state, keep default behavior and try fail mutation.
            claimStillActive = true;
          }

          if (!claimStillActive) {
            claimLost = true;
            console.log(chalk.dim(`[Stopped] chat ${shortId}: ${errorMessage}`));
            break;
          }

          console.error(chalk.red(`[Failed] chat ${shortId}: ${errorMessage}`));
          emitConnectEvent({ event: "thread", phase: "failed", threadId: chat._id as string, error: errorMessage });
          abortRun();

          try {
            await client.mutation(api.cli.messages.fail, {
              messageId: started.assistantMessageId,
              sessionId: typedSessionId,
              errorMessage,
              cliContext:
                error instanceof RunnerExecutionError && error.continuationId
                  ? { continuationId: error.continuationId, ...(error.turnId ? { turnId: error.turnId } : {}) }
                  : undefined,
            });
          } catch (markFailedError) {
            if (markFailedError instanceof Error && markFailedError.message.includes("Message not claimed by this session")) {
              console.log(chalk.dim(`[Stopped] chat ${shortId} lost message claim before fail mutation`));
            } else {
              console.error(chalk.red(`[Error] Could not mark chat ${shortId} run as failed`));
            }
          }
        } finally {
          flushBuffer?.stop();
          unsubscribeSteer?.();
          unsubscribeSteer = null;
          await steerChain;
          if (claimHeartbeatTimer) {
            clearInterval(claimHeartbeatTimer);
          }
          unsubscribeClaim?.();
          unsubscribeClaim = null;
          if (claimLost && (chat.cliType === "claude-code" || chat.cliType === "codex")) {
            runRunner.abort();
            try {
              await execution?.return({});
              await runRunner.shutdown();
              await client.mutation(api.cli.threads.runControl.acknowledgeStop, {
                threadId: chat._id, sessionId: typedSessionId,
                runId: started.runId, messageId: started.assistantMessageId,
                ...(runRunner.stopReport?.()?.goalPaused ? { goalPaused: true } : {}),
              });
            } catch (error) {
              console.warn(chalk.yellow(`[Stop] chat ${shortId} shutdown confirmation failed: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
          if (runRunner !== runner) {
            activeRunners.set(chat._id as string, runner);
            await runRunner.shutdown().catch(() => undefined);
          }
        }
      }
    } finally {
      await client.mutation(api.cli.threads.runControl.releaseClaim, {
        threadId: chat._id,
        sessionId: typedSessionId,
      });
      console.log(chalk.dim(`[Released] chat ${shortId}`));
      emitConnectEvent({ event: "thread", phase: "released", threadId: chat._id as string });
    }
  }

  function dispatchQueue(): void {
    if (shuttingDown) {
      return;
    }

    while (activeChatIds.size < maxConcurrentChats && queue.length > 0) {
      const chat = queue.shift();
      if (!chat) {
        break;
      }

      const threadId = chat._id as string;
      const runner = createRunner(chat.cliType);

      queuedChatIds.delete(threadId);
      if (!runner) {
        console.error(chalk.red(`[Failed] chat ${threadId.slice(0, 8)}: Unsupported cliType "${chat.cliType}" in this CLI build.`));
        resolveIdleWaitersIfIdle();
        continue;
      }

      activeChatIds.add(threadId);
      activeRunners.set(threadId, runner);

      // Spawn concurrent worker; each worker handles one claimed chat lifecycle.
      void (async () => {
        try {
          await processChat(chat, runner);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`[Error] chat ${threadId.slice(0, 8)}: ${errorMessage}`));
        } finally {
          activeChatIds.delete(threadId);
          activeRunners.delete(threadId);
          try {
            await runner.shutdown();
          } catch {
            // Ignore runner shutdown errors during queue teardown.
          }
          const deferred = deferredChats.get(threadId);
          if (deferred) {
            deferredChats.delete(threadId);
            enqueueChat(deferred);
          }
          resolveIdleWaitersIfIdle();
          queueMicrotask(dispatchQueue);
        }
      })();
    }
  }

  function enqueueChat(chat: PendingChat): void {
    if (shuttingDown) {
      return;
    }

    const threadId = chat._id as string;
    if (activeChatIds.has(threadId)) {
      deferredChats.set(threadId, chat);
      return;
    }
    if (queuedChatIds.has(threadId)) {
      return;
    }

    queuedChatIds.add(threadId);
    queue.push(chat);
    dispatchQueue();
  }

  return {
    enqueueChat,

    syncPendingChats(chats: PendingChat[]): void {
      const pendingIds = new Set(chats.map((chat) => chat._id as string));
      for (const threadId of deferredChats.keys()) {
        if (!pendingIds.has(threadId)) {
          deferredChats.delete(threadId);
        }
      }
      for (const chat of chats) {
        enqueueChat(chat);
      }
    },

    isProcessing(): boolean {
      return activeChatIds.size > 0 || queue.length > 0;
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      queue.length = 0;
      queuedChatIds.clear();
      deferredChats.clear();
      for (const runner of activeRunners.values()) {
        runner.abort();
      }
      const drained = await waitForWorkersToDrain(MESSAGE_HANDLER_SHUTDOWN_TIMEOUT_MS);
      if (!drained) {
        console.log(
          chalk.yellow(`[Warning] Message handler shutdown timed out after ${MESSAGE_HANDLER_SHUTDOWN_TIMEOUT_MS}ms; continuing cleanup`)
        );
      }
      clearInterval(attachmentGcInterval);
      await attachmentCache.runGc();
    },
  };
}
