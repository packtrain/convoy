import { mutation, query, internalMutation, type MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import {
  getAuthenticatedAccess,
  getAuthenticatedUser,
  getOptionalAuthenticatedAccess,
} from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import {
  assertThreadOwnedByUser,
  requireSessionOwnership,
  requireThreadOwnership,
} from "../lib/permissions";
import {
  cancelPendingInteractionRequestsForThread,
  extendPendingInteractionRequestExpiry,
} from "../interactionRequests";
import { cancelStreamWatchdog } from "../lib/messages/streamWatchdog";
import { settleAssistantStreamHead } from "../lib/chunks/lifecycle";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { cliThreadPullRequestValidator } from "../../lib/contracts/validators";
import { isThreadClaimExpired } from "../lib/claims";
import {
  STREAM_CANCELLED_BY_USER_REASON,
  STREAM_CLAIM_LEASE_EXPIRED_REASON,
  STREAM_CLAIM_RELEASED_REASON,
  STREAM_DISCONNECT_REASON,
  STREAM_WATCHDOG_INTERVAL_MS,
} from "../lib/constants";
import { isParkedWindDown, resolveRunWindDown } from "../lib/parkedWindDown";
import { emitEvent } from "../../lib/events";
import {
  getMessageById,
  hasUnprocessedUserMessages,
  insertCliMessage,
  listUnprocessedUserMessages,
  updateCliMessage,
} from "../lib/cliMessagesRepo";
import { isSessionLive } from "../lib/cliSessionsRepo";
import { MAX_EXTERNAL_LINK_TEXT_LENGTH } from "@/lib/tasks/external-links";
import { formatThreadPullRequestRef } from "@/lib/threads/pull-request";
import {
  applyThreadClaim,
  extendThreadClaimLease,
  getThreadById,
  listThreadsClaimedBySession,
  markThreadPending,
  mergeThreadStreamMetadata,
  resetThreadClaim,
  setThreadExecutionBranch,
  setThreadPendingUserMessages,
  setThreadPullRequest,
  setThreadWatchdog,
} from "./lib/cliThreadsRepo";
import { normalizeExecutionBranch } from "./lib/naming";
import type { Doc, Id } from "../../_generated/dataModel";
import { isContainerThread } from "../lib/watchStatus";

/**
 * `actorUserId` is set only for browser-initiated wind-downs (thread delete):
 * the lifecycle event then self-suppresses in the notifications fan-out.
 * CLI/system callers (claim release, watchdog, session disconnect) leave it
 * unset so the owner is notified (OS-1243).
 */
export async function failStreamingChat(
  ctx: MutationCtx,
  chat: Doc<"cliThreads">,
  reason: string,
  now: number,
  actorUserId?: Id<"users">
): Promise<void> {
  const hasUnprocessed = chat.hasPendingUserMessages;

  // No agent is waiting on these anymore; the web renders cancelled requests
  // as inactive ("agent disconnected").
  const cancelledPendingInteractions = await cancelPendingInteractionRequestsForThread(
    ctx,
    chat._id,
    "agent disconnected",
    now
  );

  // A run parked on an approval/question was the user's turn, not work in progress —
  // losing the CLI there is not an error (OS-1463).
  const windDown = resolveRunWindDown(cancelledPendingInteractions, hasUnprocessed);
  const parked = windDown.parked;

  if (chat.activeAssistantMessageId) {
    const assistantMessage = await getMessageById(ctx, chat.activeAssistantMessageId);
    if (
      assistantMessage &&
      assistantMessage.threadId === chat._id &&
      assistantMessage.role === "assistant" &&
      assistantMessage.status !== "completed"
    ) {
      await updateCliMessage(
        ctx,
        assistantMessage._id,
        parked
          ? {
              status: "completed",
              claimedBySessionId: undefined,
              claimedAt: undefined,
            }
          : {
              status: "failed",
              errorMessage: reason,
              claimedBySessionId: undefined,
              claimedAt: undefined,
            },
        now
      );
      await settleAssistantStreamHead(ctx, assistantMessage._id);
    }
  }

  await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

  await resetThreadClaim(ctx, chat._id, {
    status: windDown.threadStatus,
    hasPendingUserMessages: hasUnprocessed,
    queueHeldAt: chat.queueHeldAt,
    now,
    runError: reason,
  });

  if (windDown.emitFailedEvent) {
    await emitEvent(ctx, {
      type: "thread.failed",
      actorUserId,
      projectId: chat.projectId,
      subject: { kind: "thread", id: chat._id },
      payload: chat.activeAssistantMessageId ? { messageId: chat.activeAssistantMessageId } : {},
    });
  }
}

export async function requeueClaimedNonStreamingChat(ctx: MutationCtx, chat: Doc<"cliThreads">, now: number): Promise<void> {
  const hasUnprocessed = await hasUnprocessedUserMessages(ctx, chat._id);
  await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

  await resetThreadClaim(ctx, chat._id, {
    status: hasUnprocessed ? "pending" : chat.status,
    hasPendingUserMessages: hasUnprocessed,
    queueHeldAt: chat.queueHeldAt,
    now,
  });
}

function getNextProcessingState(chat: Doc<"cliThreads">): "claimed" | "streaming" {
  return chat.activeAssistantMessageId ? "streaming" : "claimed";
}

async function canSessionMutateChatClaim(
  ctx: MutationCtx,
  chat: Doc<"cliThreads">,
  sessionId: Id<"cliSessions">,
  now: number
): Promise<boolean> {
  return !chat.claimedBySessionId || chat.claimedBySessionId === sessionId || (await isThreadClaimExpired(ctx, chat, now));
}

/**
 * Claim a chat for processing using a lease.
 * Returns false when another active session owns the claim.
 */
export const claimThread = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    leaseMs: v.number(),
    apiKey: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);

    ensure(chat.profileId).eq(session.profileId, errors.THREAD_CLAIM_PROFILE_MISMATCH);
    // A container has no run of its own to claim (OS-1556). `send` rejects it so the
    // queue never offers one, but this is the invariant, not that coincidence.
    // Louder than the `false` returns below: those are ordinary runtime states, while a
    // container arriving here means two upstream guards already failed.
    ensure(isContainerThread(chat)).isFalse(errors.CLI_ON_CONTAINER);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    const now = Date.now();
    if (!chat.hasPendingUserMessages && !chat.activeAssistantMessageId && chat.processingState === "idle") {
      return false;
    }

    // A held queue (Stop kept the messages, OS-1374) waits for the user's next
    // send/retry — never claimable, even if a race put it back into a pending list.
    if (chat.queueHeldAt !== undefined) {
      return false;
    }

    if (!(await canSessionMutateChatClaim(ctx, chat, args.sessionId, now))) {
      return false;
    }

    await applyThreadClaim(ctx, args.threadId, {
      sessionId: args.sessionId,
      claimLeaseExpiresAt: now + args.leaseMs,
      processingState: getNextProcessingState(chat),
      now,
    });

    return true;
  },
});

/**
 * Extend an active chat claim lease.
 */
export const heartbeatClaim = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    leaseMs: v.number(),
    apiKey: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);

    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    assertThreadOwnedByUser(chat, user._id);

    // Intentionally skipped: the claim heartbeat is a high-frequency renewal for a thread
    // already claimed through an authorized entry point. Project/scope enforcement stays on
    // the claim/start gates rather than re-reading permissions every heartbeat. To re-enable,
    // destructure `principal` above and call `requireAuthorizedProject(ctx, principal,
    // chat.projectId, ProjectPermission.CLI_THREAD)`.

    const now = Date.now();
    if (chat.claimedBySessionId !== args.sessionId || (await isThreadClaimExpired(ctx, chat, now))) {
      return false;
    }

    await extendThreadClaimLease(ctx, args.threadId, now + args.leaseMs);

    // Pending approval requests live exactly as long as the claim lease.
    await extendPendingInteractionRequestExpiry(ctx, args.threadId, now + args.leaseMs, now);

    return true;
  },
});

/** A run still finishing in the checkout the agent moved the thread away from (OS-2622). */
function isFromMovedAwayCheckout(chat: Doc<"cliThreads">, path: string | undefined): boolean {
  return path !== undefined && chat.git?.movedByAgent === true && path === chat.git.previousWorkingDirectory;
}

/**
 * Record the branch actually checked out when a run starts (OS-1247).
 * Called by the CLI on every execution start; an absent branch clears the
 * snapshot (detached HEAD / non-Git path). Display metadata only, so a report
 * from a session that no longer holds the claim is ignored, not an error.
 */
export const reportExecutionBranch = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    branch: v.optional(v.string()),
    // The checkout the report was read from (OS-2622).
    path: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(chat.profileId).eq(session.profileId, errors.THREAD_CLAIM_PROFILE_MISMATCH);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    if (chat.claimedBySessionId !== args.sessionId || isFromMovedAwayCheckout(chat, args.path)) {
      return null;
    }

    const branch = normalizeExecutionBranch(args.branch);
    await setThreadExecutionBranch(ctx, args.threadId, branch);
    return null;
  },
});

/**
 * Store the last-known PR snapshot for the thread's branch (OS-1370). Called only
 * after a *successful* forge lookup, so last-known snapshots survive transient
 * errors: present overwrites, absent clears. Display metadata only, so a report
 * from a session that no longer holds the claim is ignored, not an error.
 */
export const reportPullRequest = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    pullRequest: v.optional(cliThreadPullRequestValidator),
    // The checkout the report was read from (OS-2622).
    path: v.optional(v.string()),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(chat.profileId).eq(session.profileId, errors.THREAD_CLAIM_PROFILE_MISMATCH);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    if (chat.claimedBySessionId !== args.sessionId || isFromMovedAwayCheckout(chat, args.path)) {
      return null;
    }

    await setThreadPullRequest(ctx, args.threadId, args.pullRequest);

    // Mirror onto the associated task's external links (OS-1455). A cleared snapshot
    // never removes the link: "lookup found no PR" must not erase a merged PR from task
    // history. `originTaskId` is deliberately not used — those threads never run.
    // The task write rides on this handler's CLI_THREAD authorization; if the roles
    // granting CLI_THREAD and TASK_UPDATE ever diverge, this needs its own check.
    if (args.pullRequest && chat.associatedTaskId) {
      await ctx.scheduler.runAfter(0, internal.tasks.core.upsertExternalLink, {
        taskId: chat.associatedTaskId,
        userId: user._id,
        // Deterministic id: repeated captures and refresh sweeps upsert in
        // place instead of accumulating one link per report.
        id: `pr:${args.pullRequest.provider}:${args.pullRequest.number}`,
        link: {
          kind: "pull_request",
          url: args.pullRequest.url,
          // Forge titles are unbounded; links cap text fields. Truncate here
          // rather than let an oversized title drop the link entirely.
          title: args.pullRequest.title.slice(0, MAX_EXTERNAL_LINK_TEXT_LENGTH),
          identifier: formatThreadPullRequestRef(args.pullRequest),
          branch: args.pullRequest.headBranch,
        },
      });
    }
    return null;
  },
});

/**
 * Release a claimed chat.
 */
export const releaseClaim = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    await requireSessionOwnership(ctx, user._id, args.sessionId);

    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    if (chat.claimedBySessionId !== args.sessionId) {
      return false;
    }

    const now = Date.now();

    if (chat.processingState === "streaming" && chat.activeAssistantMessageId) {
      await failStreamingChat(ctx, chat, STREAM_CLAIM_RELEASED_REASON, now);
      return true;
    }

    await cancelStreamWatchdog(ctx, chat.streamWatchdogId);
    await cancelPendingInteractionRequestsForThread(ctx, args.threadId, "claim released", now);

    await resetThreadClaim(ctx, args.threadId, {
      status: chat.hasPendingUserMessages ? "pending" : chat.status,
      hasPendingUserMessages: chat.hasPendingUserMessages,
      queueHeldAt: chat.queueHeldAt,
      now,
    });

    return true;
  },
});

/**
 * Cancel active or queued thread processing.
 * Stops streaming responses and marks queued user messages as cancelled in a retryable run.
 */
export const cancelProcessing = mutation({
  args: {
    threadId: v.id("cliThreads"),
    apiKey: v.optional(v.string()),
    expectedRunId: v.optional(v.string()),
    /**
     * The user is taking the turn over, not stopping it (OS-1461): "Keep
     * planning" and sending a message while parked on a prompt end the parked
     * run only so the next one can start. The run still ends, but the turn it
     * leaves behind reads as finished instead of as a stopped/errored one.
     */
    superseded: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    if (args.apiKey !== undefined) ensure(args.expectedRunId).notNull(errors.SELECTED_RUN_REQUIRED);
    if (args.expectedRunId !== undefined) {
      const active = chat.activeAssistantMessageId ? await getMessageById(ctx, chat.activeAssistantMessageId) : null;
      ensure(active?.runId).eq(args.expectedRunId, errors.SELECTED_RUN_CHANGED);
      ensure(active?.status).eq("streaming", errors.SELECTED_RUN_CHANGED);
    }

    await cancelThreadProcessing(ctx, chat, user._id, args.superseded === true);
    return null;
  },
});

/**
 * A workflow run cancel stops each lane thread with the Stop button's
 * treatment (docs/specs/workflows.md → Cancel). The runs domain verified the
 * caller may cancel; `userId` is the acting user (the deleter on a workflow
 * soft delete), stamped on the `thread.failed` event. Idle threads no-op.
 */
export const cancelProcessingForWorkflowRun = internalMutation({
  args: { threadId: v.id("cliThreads"), userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await getThreadById(ctx, args.threadId);
    if (!thread || thread.isDeleted) {
      return null;
    }
    await cancelThreadProcessing(ctx, thread, args.userId, false);
    return null;
  },
});

/** `cancelProcessing`'s core, shared with the workflow boundary above; the caller resolves auth. */
async function cancelThreadProcessing(
  ctx: MutationCtx,
  chat: Doc<"cliThreads">,
  actorUserId: Id<"users">,
  superseded: boolean
): Promise<void> {
  const now = Date.now();
  const pendingUserMessages = await listUnprocessedUserMessages(ctx, chat._id);

  let activeAssistant: Doc<"cliMessages"> | null = null;
  if (chat.activeAssistantMessageId) {
    const current = await getMessageById(ctx, chat.activeAssistantMessageId);
    if (current && current.threadId === chat._id && current.role === "assistant" && current.status !== "completed") {
      activeAssistant = current;
    }
  }

  // An already-held thread is already stopped — a second stop must not recompute
  // status back to pending or re-stamp the hold.
  if (!activeAssistant && chat.queueHeldAt !== undefined) {
    return;
  }

  if (!activeAssistant && pendingUserMessages.length === 0 && chat.processingState === "idle") {
    return;
  }

  const hasQueuedMessages = pendingUserMessages.length > 0;
  const stoppedActiveRun = activeAssistant !== null;

  // The run is over, so nothing is left to answer a prompt the user was parked on —
  // leaving it pending would keep live prompt UI on screen (OS-1458).
  //
  // The cancelled count is also the "was parked" signal the other wind-downs read
  // (OS-1463): taking that turn back with Stop ends the run without failing it, like
  // answering with a message does. Queued work behind the stop still reads interrupted.
  const cancelledPendingInteractions = await cancelPendingInteractionRequestsForThread(
    ctx,
    chat._id,
    "response stopped by user",
    now
  );
  // A lane thread of a workflow run never parks: the engine owns the turn
  // there, and a stopped step must read failed so Retry/Skip and in-thread
  // recovery apply (docs/specs/workflows.md → Step / run lifecycle).
  const parked = isParkedWindDown(cancelledPendingInteractions, hasQueuedMessages) && chat.workflowRunId === undefined;
  const endsAsFinishedTurn = superseded || parked;
  // Superseded hands straight to the next run, so its turn reads finished. A parked
  // run handed back keeps the bucket it already had, so the row doesn't change colour.
  const endStatus = superseded ? "completed" : parked ? "waiting_input" : "failed";

  if (activeAssistant) {
    const runId = activeAssistant.runId ?? crypto.randomUUID();
    if (!superseded && (chat.cliType === "claude-code" || chat.cliType === "codex")) {
      await mergeThreadStreamMetadata(ctx, chat, { stopConfirmation: {
        runId, messageId: activeAssistant._id, sessionId: chat.claimedBySessionId,
        requestedAt: now, status: "stopping",
        jobs: chat.metadata?.backgroundTasks?.messageId === activeAssistant._id
          ? chat.metadata.backgroundTasks : undefined,
      } });
      await ctx.scheduler.runAfter(15_000, internal.cli.threads.runControl.expireStopConfirmation, {
        threadId: chat._id, runId, requestedAt: now,
      });
    }
    await updateCliMessage(
      ctx,
      activeAssistant._id,
      {
        status: endsAsFinishedTurn ? "completed" : "failed",
        errorMessage: endsAsFinishedTurn ? undefined : STREAM_CANCELLED_BY_USER_REASON,
        claimedBySessionId: undefined,
        claimedAt: undefined,
        runId,
      },
      now
    );
    await settleAssistantStreamHead(ctx, activeAssistant._id);
  }

  if (stoppedActiveRun) {
    // Messages queued behind the stopped run survive (OS-1374) until the user's next
    // send/retry. Only stale steer intent is cleared — no run left to steer into.
    await Promise.all(
      pendingUserMessages
        .filter((message) => message.steerRequestedAt !== undefined)
        .map((message) => updateCliMessage(ctx, message._id, { steerRequestedAt: undefined }, now))
    );
  } else if (hasQueuedMessages) {
    // No run exists, so the pending messages are the sent run awaiting pickup.
    // Holding them re-queued the user's sent message (OS-1459) — instead the turn
    // fails in place, staying retryable through the normal path.
    const runId = crypto.randomUUID();
    await Promise.all(
      pendingUserMessages.map((message) =>
        updateCliMessage(
          ctx,
          message._id,
          { processedAt: now, runId, steerRequestedAt: undefined },
          now
        )
      )
    );
    const latestMessage = pendingUserMessages.reduce((latest, message) =>
      message.createdAt > latest.createdAt ? message : latest
    );
    await insertCliMessage(ctx, {
      threadId: chat._id,
      role: "assistant",
      profileId: chat.profileId,
      cliType: chat.cliType,
      cliMode: latestMessage.cliMode,
      cliModel: latestMessage.cliModel,
      cliEffort: latestMessage.cliEffort,
      nextChunkOrder: 0,
      content: [],
      status: "failed",
      errorMessage: STREAM_CANCELLED_BY_USER_REASON,
      runId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

  // A hold only survives behind a stopped run (OS-1374); a no-run stop
  // stamped its run above, so nothing stays pending (OS-1459).
  const holdsSurvivingQueue = stoppedActiveRun && hasQueuedMessages;
  await resetThreadClaim(ctx, chat._id, {
    status: endStatus,
    hasPendingUserMessages: holdsSurvivingQueue,
    queueHeldAt: holdsSurvivingQueue ? now : undefined,
    now,
    runError: STREAM_CANCELLED_BY_USER_REASON,
  });

  // Neither a superseded nor a parked run is a failure, and each is already announced
  // elsewhere (the replacing turn's events; the request that parked it, OS-1463).
  if (!endsAsFinishedTurn) {
    // Lifecycle event with the cancelling user as actor: the owner cancelled
    // their own run, so the notifications fan-out self-suppresses it (OS-1243).
    await emitEvent(ctx, {
      type: "thread.failed",
      actorUserId,
      projectId: chat.projectId,
      subject: { kind: "thread", id: chat._id },
      payload: {},
    });
  }
}

/**
 * Release a held queue without composing a new message (OS-1374): the user
 * stopped, reread the queued prompts, and wants them to run as-is. Clears the
 * hold and requeues the thread for CLI pickup. Idempotent when nothing is
 * held; self-corrects a stale hold with no messages behind it.
 */
export const releaseQueueHold = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    if (chat.queueHeldAt === undefined) {
      return null;
    }

    const now = Date.now();
    const hasUnprocessed = await hasUnprocessedUserMessages(ctx, chat._id);
    if (!hasUnprocessed) {
      await setThreadPendingUserMessages(ctx, chat._id, false, now);
      return null;
    }

    await markThreadPending(ctx, chat._id, { now, flipToPending: true });
    return null;
  },
});

/**
 * Check whether a thread is still actively claimed by the given session.
 * Used by CLI workers to detect user-initiated cancellation promptly.
 */
export const isClaimActiveForSession = query({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    messageId: v.optional(v.id("cliMessages")),
    apiKey: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return false;
    }
    const { user } = auth;

    try {
      await requireSessionOwnership(ctx, user._id, args.sessionId);
    } catch {
      return false;
    }

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat || chat.isDeleted || chat.userId !== user._id) {
      return false;
    }

    const now = Date.now();
    return chat.claimedBySessionId === args.sessionId &&
      (args.messageId === undefined || chat.activeAssistantMessageId === args.messageId) &&
      !(await isThreadClaimExpired(ctx, chat, now));
  },
});

/**
 * Reconcile all threads claimed by a session when that session disconnects/replaced.
 * Streaming threads are failed; claimed-but-not-streaming threads are requeued.
 */
export const reconcileClaimsForSessionDisconnect = internalMutation({
  args: {
    sessionId: v.id("cliSessions"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimedChats = await listThreadsClaimedBySession(ctx, args.sessionId);

    const now = Date.now();
    for (const chat of claimedChats) {
      if (chat.isDeleted) continue;

      if (chat.processingState === "streaming" && chat.activeAssistantMessageId) {
        await failStreamingChat(ctx, chat, args.reason, now);
      } else {
        await requeueClaimedNonStreamingChat(ctx, chat, now);
      }
    }

    return null;
  },
});

/**
 * Watchdog for active streaming threads: fails streaming when the claiming session
 * goes stale.
 *
 * A healthy tick writes nothing — restamping `streamWatchdogId` collided with the
 * streaming hot path (OCC retries of `appendRunContent`). Instead the chain
 * identifies itself by the run's assistant message and self-terminates once that
 * run ends, so `streamWatchdogId` only ever holds a run's first tick.
 */
export const streamingWatchdogTick = internalMutation({
  args: {
    threadId: v.id("cliThreads"),
    intervalMs: v.number(),
    // Optional: ticks scheduled before this shipped carry no message id. They
    // run their health check once and let the chain die.
    messageId: v.optional(v.id("cliMessages")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const chat = await getThreadById(ctx, args.threadId);
    if (!chat || chat.isDeleted) {
      return null;
    }

    const now = Date.now();

    if (chat.processingState !== "streaming" || !chat.activeAssistantMessageId) {
      if (chat.streamWatchdogId) {
        await setThreadWatchdog(ctx, chat._id, undefined);
      }
      return null;
    }

    // A newer run owns the thread: this chain belongs to a finished one.
    if (args.messageId && chat.activeAssistantMessageId !== args.messageId) {
      return null;
    }

    if (!chat.claimedBySessionId) {
      await failStreamingChat(ctx, chat, STREAM_DISCONNECT_REASON, now);
      return null;
    }

    if (await isThreadClaimExpired(ctx, chat, now)) {
      await failStreamingChat(ctx, chat, STREAM_CLAIM_LEASE_EXPIRED_REASON, now);
      return null;
    }

    if (!(await isSessionLive(ctx, chat.claimedBySessionId, now))) {
      await failStreamingChat(ctx, chat, STREAM_DISCONNECT_REASON, now);
      return null;
    }

    if (!args.messageId) {
      return null;
    }

    const intervalMs = args.intervalMs > 0 ? args.intervalMs : STREAM_WATCHDOG_INTERVAL_MS;
    await ctx.scheduler.runAfter(intervalMs, internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: chat._id,
      intervalMs,
      messageId: args.messageId,
    });

    return null;
  },
});

export const expireStopConfirmation = internalMutation({
  args: { threadId: v.id("cliThreads"), runId: v.string(), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await getThreadById(ctx, args.threadId);
    const stop = thread?.metadata?.stopConfirmation;
    if (thread && stop?.runId === args.runId && stop.requestedAt === args.requestedAt && stop.status === "stopping") {
      await mergeThreadStreamMetadata(ctx, thread, { stopConfirmation: { ...stop, status: "unconfirmed" } });
    }
    return null;
  },
});

export const acknowledgeStop = mutation({
  args: {
    threadId: v.id("cliThreads"), sessionId: v.id("cliSessions"), runId: v.string(),
    messageId: v.id("cliMessages"), apiKey: v.optional(v.string()),
    // Codex confirmed the goal pause sent on Stop (OS-2277); chunks can no longer be appended.
    goalPaused: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, user._id, args.threadId);
    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
    await requireSessionOwnership(ctx, user._id, args.sessionId);
    const stop = thread.metadata?.stopConfirmation;
    if (!stop || stop.runId !== args.runId || stop.messageId !== args.messageId ||
      stop.sessionId !== args.sessionId || stop.status === "stopped") return null;
    const goal = thread.metadata?.goal;
    await mergeThreadStreamMetadata(ctx, thread, {
      stopConfirmation: { ...stop, status: "stopped", acknowledgedAt: Date.now() },
      ...(args.goalPaused && goal?.status === "active" ? { goal: { ...goal, status: "paused" as const } } : {}),
    });
    return null;
  },
});
