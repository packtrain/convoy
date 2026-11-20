import { toRawRunLogRow } from "./lib/chunks/formatters";
import { requireAttachedPullRequest, requireRuntimeCommandRunner } from "./lib/messages/invariants";
import { attachedPullRequestValidator } from "../lib/contracts/github";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { listStoredRunChunksAfter, listStoredRunChunksBefore } from "./lib/cliMessageChunksRepo";
import { paginateAssistantMessages } from "./lib/cliMessagesRepo";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { getAuthenticatedAccess, getAuthenticatedUser, getOptionalAuthenticatedAccess, getOptionalAuthenticatedUser } from "../lib/access/auth";
import {
  assertStoredAttachmentSize,
  assertValidMessageAttachments,
  createAttachmentRefs,
  deleteMessageAttachmentRefs,
} from "./lib/messages/attachments";
import { createUserMessage, normalizeMessageSelection } from "./lib/messages/normalize";
import { enrichMessageSummaries } from "./lib/messageSummaries";
import { serviceRunValidator, toServiceRun, cliExecutionWorkspaceValidator, cliMessageSummaryValidator, cliResumeHandleValidator, cliWorkspaceNoticeValidator, toExecutionWorkspace } from "./lib/validators";
import { resolveTaskSummaries, taskSummaryValidator, type TaskSummary } from "../lib/contracts/taskSummaries";
import { hasProjectAccess, requireAuthorizedProject } from "../lib/access/permissions";
import {
  assertThreadOwnedByUser,
  getAccessibleThread,
  getViewableThread,
  requireMessageClaimedBySession,
  requireSessionOwnership,
  requireThreadClaimedBySession,
  requireThreadOwnership,
  requireAccessibleCliTask,
} from "./lib/permissions";
import { cancelStreamWatchdog } from "./lib/messages/streamWatchdog";
import { clampPageSize, EMPTY_PAGE } from "../lib/shared/pagination";
import { ensure } from "../lib/shared/ensure";
import { getCliMessageChunkById, listChunksByMessage } from "./lib/cliMessageChunksRepo";
import { errors } from "./errors";
import { ProjectPermission } from "../../lib/authz/permissions";
import {
  cliTypeValidator,
  cliProposedPlanSourceValidator,
  PLAN_APPROVAL_FALLBACK_MESSAGE,
  type CliProposedPlanSource,
  cliEffortValidator,
  cliModelValidator,
  cliMessageStatusValidator,
  cliMessageContextValidator,
  cliMessageAttachmentInputValidator,
  checkReportInputValidator,
  cliMessageAttachmentMetadataValidator,
  cliMessageAttachmentSummaryValidator,
  cliMessageSentByValidator,
  cliRunDiffSummaryPreviewValidator,
  cliRunDiffSummaryValidator,
  cliScriptRequestValidator,
  cliScriptResultValidator,
  hydrateAvailableClis,
  SCRIPT_OUTPUT_TAIL_MAX_CHARS,
  type CliMessageAttachmentInput,
  type CliMessageAttachmentMetadata,
  type CliMessageAttachmentSummary,
  type CliRunDiffSummary,
  type CliRunDiffSummaryPreview,
} from "../lib/contracts/validators";
import type { Doc, Id } from "../_generated/dataModel";
import { clampChars } from "../lib/shared/strings";
import { assertThreadClaimedBySession, isThreadClaimExpired } from "./lib/claims";
import { ENVELOPE_WINDOW_LIMIT, PENDING_UPLOAD_RETENTION_MS, PENDING_UPLOAD_SWEEP_BATCH, STREAM_WATCHDOG_INTERVAL_MS } from "./lib/constants";
import { hasAwaitingUserInputTool } from "./lib/waitingInput";
import { isContainerThread } from "./lib/watchStatus";
import { resolveRunWindDown } from "./lib/parkedWindDown";
import { emitEvent } from "../lib/events";
import {
  appendAssistantChunks,
  copyMessageChunkRows,
  FORK_COPY_INCOMPLETE_NOTICE,
  deleteAssistantChunkRows,
  deleteEphemeralChunkRows,
  getMessageContentForRead,
  insertMessageChunkRows,
  settleAssistantStreamHead,
} from "./lib/chunks/lifecycle";
import {
  hasEphemeralChunks,
  listAllChunksByMessage,
  listRecentChunksByMessageAsc,
} from "./lib/cliMessageChunksRepo";
import { expandCliNormalizedEvent, resolveChunkReadEvent } from "./lib/chunks/normalizedEvents";
import { cancelPendingInteractionRequestsForThread } from "./interactionRequests";
import { holdLaneForManualMessage } from "../workflows/runs/lib/runLanesRepo";
import { laneThreadStep, listStepsByRun } from "../workflows/runs/lib/runStepsRepo";
import {
  cliTypeAdvertisesModelCatalog,
  cliTypeSupportsSteering,
  getContinuationIdFromIncomingChunks,
  getCostUsageFromIncomingChunks,
  getSlashCommandsFromIncomingChunks,
  resolveCliRunEffort,
  resolveCliRunModel,
} from "./lib/runtimes/registry";
import { getCliProfileById } from "./lib/cliProfilesRepo";
import { getRuntimeCatalog } from "./lib/cliRuntimeCatalogsRepo";
import { RUNTIME_FACT_SLASH_COMMANDS, upsertRuntimeFact } from "./lib/cliRuntimeFactsRepo";
import { getSessionById, sessionSupportsSteeringForCliType } from "./lib/cliSessionsRepo";
import {
  deleteCliMessage,
  getLatestUserMessage,
  getMessageById,
  getMessagesByIds,
  hasUnprocessedUserMessages,
  insertAssistantStreamingMessage,
  insertCliMessage,
  listDeliverableUserMessages,
  listInterruptedUserMessages,
  listMessagesByThread,
  listNewestThreadMessagesDesc,
  listRunMessages,
  listThreadMessagesAsc,
  listUnprocessedUserMessages as listUnprocessedUserMessagesRepo,
  paginateThreadMessagesDesc,
  resolveResumeHandle,
  scanStrandedTail,
  setMessageChunkOrder,
  unstampRunUserMessages,
  updateCliMessage,
} from "./lib/cliMessagesRepo";
import {
  addForkCopiesInFlight,
  getThreadById,
  markThreadPending,
  markThreadStreamEnded,
  markThreadStreaming,
  normalizeThreadId,
  reopenThreadForUserTurn,
  requeueThreadForRetry,
  resetThreadClaim,
  setThreadCodexUsageCursor,
  setThreadLastUsedCliSelection,
  setThreadPendingUserMessages,
} from "./threads/lib/cliThreadsRepo";
import {
  deletePendingUpload,
  insertPendingUpload,
  listPendingUploadsByStorageId,
  listPendingUploadsOlderThan,
  touchPendingUpload,
} from "./lib/cliMessagePendingUploadsRepo";
import { deleteStorageIfOversized, deleteStorageIfUnreferenced, isStorageClaimed } from "../lib/storageRepo";
import {
  deleteAttachmentRef,
  listAttachmentRefsByMessage,
  listRecentAttachmentRefsByThreadAndRole,
} from "./lib/cliMessageAttachmentRefsRepo";
import { resolveSlashCommandComposerContent } from "../lib/slashCommands/composer";
import { slashCommandComposerDocumentValidator } from "../lib/contracts/slashCommands";
import { getActiveProjectById } from "../projects/lib/projectsRepo";

// Content block validator
const contentBlockValidator = v.object({
  type: v.string(),
  data: v.string(),
  timestamp: v.number(),
});

// Shared fields for message return validators
const cliMessageItemFields = {
  contextOnly: v.optional(v.boolean()),
  _id: v.id("cliMessages"),
  threadId: v.id("cliThreads"),
  role: v.union(v.literal("user"), v.literal("assistant")),
  profileId: v.id("cliProfiles"),
  cliType: cliTypeValidator,
  cliMode: v.optional(v.string()),
  cliModel: v.optional(cliModelValidator),
  resolvedCliModel: v.optional(v.string()),
  cliEffort: v.optional(cliEffortValidator),
  cliVersion: v.optional(v.string()),
  cliContext: v.optional(cliMessageContextValidator),
  task: v.optional(taskSummaryValidator),
  pullRequest: v.optional(attachedPullRequestValidator),
  attachments: v.array(cliMessageAttachmentSummaryValidator),
  content: v.array(contentBlockValidator),
  status: cliMessageStatusValidator,
  claimedBySessionId: v.optional(v.id("cliSessions")),
  claimedAt: v.optional(v.number()),
  processedAt: v.optional(v.number()),
  processedBySessionId: v.optional(v.id("cliSessions")),
  runId: v.optional(v.string()),
  steerRequestedAt: v.optional(v.number()),
  steeredAt: v.optional(v.number()),
  runtimeCommand: v.optional(v.boolean()),
  queueFirst: v.optional(v.boolean()),
  scriptRequest: v.optional(cliScriptRequestValidator),
  scriptResult: v.optional(cliScriptResultValidator),
  sentBy: v.optional(cliMessageSentByValidator),
  errorMessage: v.optional(v.string()),
  diffSummary: v.optional(cliRunDiffSummaryValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};

// Return validator for a single message
const cliMessageItemValidator = v.object(cliMessageItemFields);

const cliMessageEnvelopeFields = {
  _id: v.id("cliMessages"),
  threadId: v.id("cliThreads"),
  role: v.union(v.literal("user"), v.literal("assistant")),
  profileId: v.id("cliProfiles"),
  cliType: cliTypeValidator,
  cliMode: v.optional(v.string()),
  cliModel: v.optional(cliModelValidator),
  resolvedCliModel: v.optional(v.string()),
  cliEffort: v.optional(cliEffortValidator),
  cliVersion: v.optional(v.string()),
  cliContext: v.optional(cliMessageContextValidator),
  task: v.optional(taskSummaryValidator),
  pullRequest: v.optional(attachedPullRequestValidator),
  // Metadata only — signed URLs resolve lazily (OS-1600).
  attachments: v.array(cliMessageAttachmentMetadataValidator),
  status: cliMessageStatusValidator,
  claimedBySessionId: v.optional(v.id("cliSessions")),
  claimedAt: v.optional(v.number()),
  processedAt: v.optional(v.number()),
  processedBySessionId: v.optional(v.id("cliSessions")),
  runId: v.optional(v.string()),
  steerRequestedAt: v.optional(v.number()),
  steeredAt: v.optional(v.number()),
  runtimeCommand: v.optional(v.boolean()),
  queueFirst: v.optional(v.boolean()),
  scriptRequest: v.optional(cliScriptRequestValidator),
  scriptResult: v.optional(cliScriptResultValidator),
  sentBy: v.optional(cliMessageSentByValidator),
  errorMessage: v.optional(v.string()),
  // Compact preview — the full file list loads on demand (OS-1600).
  diffSummary: v.optional(cliRunDiffSummaryPreviewValidator),
  chunkCount: v.number(),
  hasLegacyContent: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const cliMessageEnvelopeValidator = v.object(cliMessageEnvelopeFields);

async function resolveMessageAttachments(ctx: MutationCtx | QueryCtx, message: Doc<"cliMessages">): Promise<CliMessageAttachmentSummary[]> {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return [];
  }

  return await Promise.all(
    attachments.map(async (attachment) => ({
      storageId: attachment.storageId,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      contentType: attachment.contentType,
      uploadedAt: attachment.uploadedAt,
      dimensions: attachment.dimensions,
      display: attachment.display,
      url: await ctx.storage.getUrl(attachment.storageId),
    }))
  );
}

async function toMessageItem(
  ctx: MutationCtx | QueryCtx,
  msg: Doc<"cliMessages">,
  task?: TaskSummary,
  options?: { preferProcessedContent?: boolean }
) {
  const attachments = await resolveMessageAttachments(ctx, msg);
  const content =
    msg.role === "assistant"
      ? []
      : options?.preferProcessedContent && msg.processedContent !== undefined
        ? [
            {
              type: "text",
              data: msg.processedContent,
              timestamp: msg.createdAt,
            },
          ]
        : await getMessageContentForRead(ctx, msg);
  return {
    _id: msg._id,
    threadId: msg.threadId,
    role: msg.role,
    profileId: msg.profileId,
    cliType: msg.cliType,
    cliMode: msg.cliMode,
    cliModel: msg.cliModel,
    resolvedCliModel: msg.role === "assistant" ? msg.codexModelState?.model : undefined,
    cliEffort: msg.cliEffort,
    cliVersion: msg.cliVersion,
    cliContext: msg.cliContext,
    ...(task ? { task } : {}),
    ...(msg.pullRequest ? { pullRequest: msg.pullRequest } : {}),
    attachments,
    content,
    status: msg.status,
    claimedBySessionId: msg.claimedBySessionId,
    claimedAt: msg.claimedAt,
    processedAt: msg.processedAt,
    processedBySessionId: msg.processedBySessionId,
    runId: msg.runId,
    steerRequestedAt: msg.steerRequestedAt,
    steeredAt: msg.steeredAt,
    runtimeCommand: msg.runtimeCommand,
    queueFirst: msg.queueFirst,
    scriptRequest: msg.scriptRequest,
    scriptResult: msg.scriptResult,
    sentBy: msg.sentBy,
    errorMessage: msg.errorMessage,
    diffSummary: msg.diffSummary,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

/**
 * Number of file rows the envelope's compact diff summary carries. The
 * collapsed Changes card renders 3 (`COLLAPSED_FILE_COUNT` in
 * `run-changes-card.tsx`); a small margin keeps the common case free of a
 * follow-up fetch without shipping 200-file lists on every envelope re-send.
 */
const DIFF_SUMMARY_PREVIEW_FILES = 5;

/** Compact the stored summary down to the envelope-sized preview (OS-1600). */
function toDiffSummaryPreview(summary: CliRunDiffSummary): CliRunDiffSummaryPreview {
  let additions = 0;
  let deletions = 0;
  for (const file of summary.files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return {
    preRef: summary.preRef,
    postRef: summary.postRef,
    files: summary.files.slice(0, DIFF_SUMMARY_PREVIEW_FILES),
    fileCount: summary.files.length,
    additions,
    deletions,
    ...(summary.truncated !== undefined ? { truncated: summary.truncated } : {}),
  };
}

/**
 * The envelope shape — deliberately free of storage I/O and of the full diff
 * file list. `listEnvelopesByThread` is subscribed for as long as a thread view
 * is open and re-runs on every message write in the thread, so per-message cost
 * here is paid over and over (OS-1600).
 */
function toMessageEnvelope(msg: Doc<"cliMessages">, task?: TaskSummary) {
  const attachments = (msg.attachments ?? []).map((attachment): CliMessageAttachmentMetadata => ({
    storageId: attachment.storageId,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    contentType: attachment.contentType,
    uploadedAt: attachment.uploadedAt,
    dimensions: attachment.dimensions,
    display: attachment.display,
  }));
  return {
    _id: msg._id,
    threadId: msg.threadId,
    role: msg.role,
    profileId: msg.profileId,
    cliType: msg.cliType,
    cliMode: msg.cliMode,
    cliModel: msg.cliModel,
    resolvedCliModel: msg.role === "assistant" ? msg.codexModelState?.model : undefined,
    cliEffort: msg.cliEffort,
    cliVersion: msg.cliVersion,
    cliContext: msg.cliContext,
    ...(task ? { task } : {}),
    ...(msg.pullRequest ? { pullRequest: msg.pullRequest } : {}),
    attachments,
    status: msg.status,
    claimedBySessionId: msg.claimedBySessionId,
    claimedAt: msg.claimedAt,
    processedAt: msg.processedAt,
    processedBySessionId: msg.processedBySessionId,
    runId: msg.runId,
    steerRequestedAt: msg.steerRequestedAt,
    steeredAt: msg.steeredAt,
    runtimeCommand: msg.runtimeCommand,
    queueFirst: msg.queueFirst,
    scriptRequest: msg.scriptRequest,
    scriptResult: msg.scriptResult,
    sentBy: msg.sentBy,
    errorMessage: msg.errorMessage,
    diffSummary: msg.diffSummary ? toDiffSummaryPreview(msg.diffSummary) : undefined,
    chunkCount: msg.nextChunkOrder ?? 0,
    hasLegacyContent: msg.content.length > 0,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

// The CLI already caps the summary; this is a belt against oversized payloads
// from older/foreign CLI builds so the message document stays small.
const MAX_DIFF_SUMMARY_FILES = 200;

function capDiffSummary(summary: CliRunDiffSummary): CliRunDiffSummary {
  if (summary.files.length <= MAX_DIFF_SUMMARY_FILES) {
    return summary;
  }
  return {
    ...summary,
    files: summary.files.slice(0, MAX_DIFF_SUMMARY_FILES),
    truncated: true,
  };
}

async function approvedPlanContent(
  ctx: MutationCtx,
  thread: Doc<"cliThreads">,
  source: CliProposedPlanSource
): Promise<string> {
  const error = errors.PROPOSED_PLAN_NOT_PENDING;
  ensure(thread.cliType).eq("codex", error);
  ensure(thread.status).eq("waiting_input", error);
  ensure(thread.processingState).eq("idle", error);
  ensure(thread.hasPendingUserMessages === true || thread.hasPendingInteraction === true).isFalse(
    error
  );

  const proposal = await ensure(thread.metadata?.proposedPlan).notNull(error);
  ensure(proposal.ready).isTrue(error);
  ensure(proposal.messageId).eq(source.messageId, error);
  ensure(proposal.itemId).eq(source.itemId, error);
  ensure(proposal.turnId).eq(source.turnId, error);

  const message = await ensure(getMessageById(ctx, source.messageId)).notNull(error);
  ensure(message.threadId).eq(thread._id, error);
  ensure(message.status).eq("completed", error);

  const chunk = await ensure(getCliMessageChunkById(ctx, proposal.chunkId)).notNull(error);
  // Verify the referenced rows as well as the pointer supplied for approval.
  ensure(chunk.messageId).eq(source.messageId, error);
  ensure(chunk.threadId).eq(thread._id, error);

  const event = await ensure(
    chunk.normalizedEvent?.kind === "proposed-plan" ? chunk.normalizedEvent : null
  ).notNull(error);
  ensure(event.phase).eq("completed", error);
  ensure(event.itemId).eq(source.itemId, error);
  ensure(event.turnId).eq(source.turnId, error);
  ensure(event.text.trim().length).gte(1, error);
  return `${PLAN_APPROVAL_FALLBACK_MESSAGE}\n\n${event.text}`;
}

/**
 * Send a message in a thread. Creator-only; creates the user message and marks the
 * thread pending.
 *
 * `apiKey` opens this to MCP/CLI callers (OS-1162), and `sentBy` records the thread
 * that spoke when the sender is another agent. The key resolves to its owning user,
 * so an agent can only post to its own threads.
 *
 * An idle thread flips to pending; a busy one keeps its status and is picked up by
 * its next run. Spec: `docs/specs/mcp-server.md`.
 */
export const send = mutation({
  args: {
    threadId: v.id("cliThreads"),
    content: v.string(),
    sourceProposedPlan: v.optional(cliProposedPlanSourceValidator),
    composerDocument: v.optional(slashCommandComposerDocumentValidator),
    cliMode: v.optional(v.string()),
    cliModel: v.optional(cliModelValidator),
    cliEffort: v.optional(cliEffortValidator),
    attachments: v.optional(v.array(cliMessageAttachmentInputValidator)),
    taskId: v.optional(v.id("tasks")),
    /** A github.com PR URL; the thread keeps the first one (docs/specs/github-integration.md). */
    pullRequestUrl: v.optional(v.string()),
    runtimeCommand: v.optional(v.boolean()),
    /** Deliver this runtime command before every queued message (OS-2339). */
    queueFirst: v.optional(v.boolean()),
    /** Best-effort (OS-1873): mark the message for injection into the target's
     * in-progress run. Ignored when the run cannot consume it — the message
     * just queues, the standard fallback. */
    steer: v.optional(v.boolean()),
    sentBy: v.optional(cliMessageSentByValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("cliMessages"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);

    // Containers carry a real profile/path/cliType snapshot, so a posted message would
    // let a connected CLI claim and run an agent on the group row itself. The shared
    // claim gate can't cover this: it needs a `sessionId` and only guards paths that
    // advance a claimed run, while `send` merely queues.
    ensure(isContainerThread(thread)).isFalse(errors.MESSAGE_TO_CONTAINER);

    // Self-reported, so which thread it names is cooperative — but referentially
    // validated, so the badge (OS-1631) names a live thread of this project. Its own
    // errors: over MCP both ids are arguments, so a shared message hides which failed.
    if (args.sentBy) {
      // Missing and not-yours share one message: both are unactionable, and splitting
      // them would answer "is this thread alive?" about a thread the caller can't read.
      const sender = await ensure(getThreadById(ctx, args.sentBy.threadId)).notDeleted(errors.SOURCE_THREAD_NOT_FOUND);
      ensure(sender.userId).eq(user._id, errors.SOURCE_THREAD_NOT_FOUND);
      // Same project as the target, so `principal`'s single authorization above covers
      // the source too and provenance stays where its reader can follow it.
      ensure(sender.projectId).eq(thread.projectId, errors.SOURCE_THREAD_CROSS_PROJECT);
      // A container never runs an agent, so it cannot be the thread that spoke.
      ensure(isContainerThread(sender)).isFalse(errors.SOURCE_THREAD_IS_CONTAINER);
      // A self-send is answered by the next run with another self-send (OS-1890).
      ensure(sender._id !== thread._id).isTrue(errors.SOURCE_THREAD_IS_TARGET);
    }

    const now = Date.now();
    const attachments = assertValidMessageAttachments(args.attachments);
    // `principal`, not `user._id`: this authorizes a second project permission
    // (`task:view` on the task's project), and a bare id would resolve the key's scope
    // and then ignore it.
    const task = args.taskId ? await requireAccessibleCliTask(ctx, principal, args.taskId, thread.projectId) : null;
    const pullRequest = requireAttachedPullRequest(args.pullRequestUrl);
    if (args.sourceProposedPlan) {
      ensure(args.cliMode === "auto" || args.cliMode === "default" || args.cliMode === "agent").isTrue(errors.PROPOSED_PLAN_APPROVAL_INVALID);
      ensure(Boolean(args.composerDocument || args.runtimeCommand || args.steer || args.sentBy || args.taskId || pullRequest) || attachments.length > 0).isFalse(errors.PROPOSED_PLAN_APPROVAL_INVALID);
    }
    const trimmedContent = args.sourceProposedPlan
      ? await approvedPlanContent(ctx, thread, args.sourceProposedPlan)
      : args.content.trim();
    ensure(trimmedContent.length > 0 || attachments.length > 0 || Boolean(task) || Boolean(pullRequest)).isTrue(errors.MESSAGE_CONTENT_REQUIRED);
    // A runtime command is the whole message ("/name args"), delivered raw as its own
    // run. Attachments and org-command expansion don't apply; the runtime itself is
    // the authority on unknown command names.
    const runtimeCommand = args.runtimeCommand === true && attachments.length === 0 && trimmedContent.startsWith("/") ? true : undefined;
    await requireRuntimeCommandRunner(ctx, { profileId: thread.profileId, cliType: thread.cliType, content: trimmedContent, runtimeCommand });
    const hasSlashCommandRefs = !runtimeCommand && (args.composerDocument?.refs.length ?? 0) > 0;
    let processedContent: string | undefined;
    if (hasSlashCommandRefs) {
      const project = await ensure(getActiveProjectById(ctx, thread.projectId)).notNull(errors.PROJECT_NOT_FOUND);
      processedContent = await resolveSlashCommandComposerContent(ctx, {
        organizationId: project.organizationId,
        projectId: project._id,
        displayContent: trimmedContent,
        composerDocument: args.composerDocument,
      });
    }

    // Runtime commands are never steered (they wait for their own run), and an
    // unavailable steer must not stamp: a `steerRequestedAt` no run can consume
    // shows "Steering..." in the queued strip and blocks its Edit/Delete.
    const steerRequestedAt =
      args.steer === true && !runtimeCommand && (await steerAvailable(ctx, thread, now)) ? now : undefined;

    // A message into a lane thread awaiting the agent's question answers the
    // step running in that thread (docs/specs/workflows.md → Lane hold): stamp
    // it with that step, and take no hold below.
    const threadStep =
      thread.workflowRunId !== undefined && thread.workflowLaneId !== undefined && thread.status === "waiting_input"
        ? laneThreadStep(await listStepsByRun(ctx, thread.workflowRunId), thread.workflowLaneId, thread)
        : undefined;
    const answeredStepId = threadStep?.status === "running" && threadStep.threadId === thread._id ? threadStep._id : undefined;

    // Agent senders (MCP/CLI) name no selection, and the run resolves its model
    // from the latest user message — so an unspecified field inherits the
    // thread's remembered selection instead of the runtime's default (OS-1894).
    // Effort moves with the model: a caller naming a model keeps its own pair.
    const remembered = thread.metadata?.cli;
    const cliModel = args.cliModel ?? remembered?.lastUsedModel;
    const cliEffort = args.cliModel !== undefined ? args.cliEffort : (args.cliEffort ?? remembered?.lastUsedEffort);

    // Create user message (assistant message is created when processing starts)
    const userMessage = createUserMessage({
      threadId: args.threadId,
      profileId: thread.profileId,
      cliType: thread.cliType,
      cliMode: args.cliMode ?? remembered?.lastUsedMode,
      cliModel,
      cliEffort,
      taskId: task?._id,
      pullRequest,
      content: trimmedContent,
      processedContent,
      runtimeCommand,
      queueFirst: runtimeCommand && args.queueFirst === true ? true : undefined,
      steerRequestedAt,
      workflowRunStepId: answeredStepId,
      sentBy: args.sentBy,
      attachments: attachments.map((attachment) => ({
        storageId: attachment.storageId,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        contentType: attachment.contentType,
        dimensions: attachment.dimensions,
        uploadedAt: now,
      })),
      timestamp: now,
    });
    const userMessageId = await insertCliMessage(ctx, userMessage);
    const nextChunkOrder = await insertMessageChunkRows(ctx, {
      message: {
        _id: userMessageId,
        threadId: userMessage.threadId,
        profileId: userMessage.profileId,
        role: userMessage.role,
        cliType: userMessage.cliType,
      },
      chunks:
        trimmedContent.length > 0
          ? [
              {
                type: "text",
                data: trimmedContent,
                timestamp: now,
                createdAt: now,
              },
            ]
          : [],
      startChunkOrder: userMessage.nextChunkOrder ?? 0,
    });
    if (nextChunkOrder !== (userMessage.nextChunkOrder ?? 0)) {
      await setMessageChunkOrder(ctx, userMessageId, nextChunkOrder);
    }
    await createAttachmentRefs(ctx, {
      messageId: userMessageId,
      threadId: args.threadId,
      role: "user",
      owner: { userId: user._id, projectId: thread.projectId },
      attachments,
      now,
    });

    // Denormalize the (already normalized) selection so reopening the thread
    // renders the composer's pills from the thread doc (OS-1454).
    await setThreadLastUsedCliSelection(ctx, thread, {
      cliModel: userMessage.cliModel,
      cliEffort: userMessage.cliEffort,
      cliMode: userMessage.cliMode,
    });

    // User interference with a live workflow holds the lane (docs/specs/
    // workflows.md → Lane hold) — except an answer stamped onto the active
    // step above. Recovery prompts are exempted inside, by the lane's own
    // head step.
    if (thread.workflowRunId !== undefined && thread.workflowLaneId !== undefined && answeredStepId === undefined) {
      await holdLaneForManualMessage(ctx, {
        runId: thread.workflowRunId,
        laneId: thread.workflowLaneId,
        thread,
        triggeringMessageId: userMessageId,
        now,
      });
    }

    const associateTask = task && thread.associatedTaskId === undefined ? task._id : undefined;
    await markThreadPending(ctx, args.threadId, {
      now,
      flipToPending: thread.processingState === "idle",
      associatedTaskId: associateTask,
      attachedPullRequest: thread.attachedPullRequest === undefined ? pullRequest : undefined,
    });

    return userMessageId;
  },
});

/**
 * The workflow engine's follow-up dispatch boundary (OS-1868): queues a run
 * step's prompt into its lane's existing thread, stamped with the step. The
 * engine dispatches as the starting user (`userId`), whose project permission
 * is re-checked here on every dispatch — revoked access must park the run,
 * not queue a message the CLI can never claim.
 */
export const sendForWorkflowStep = internalMutation({
  args: {
    threadId: v.id("cliThreads"),
    userId: v.id("users"),
    content: v.string(),
    composerDocument: v.optional(slashCommandComposerDocumentValidator),
    cliMode: v.optional(v.string()),
    cliModel: v.optional(cliModelValidator),
    cliEffort: v.optional(cliEffortValidator),
    workflowRunStepId: v.id("workflowRunSteps"),
    scriptRequest: v.optional(cliScriptRequestValidator),
  },
  returns: v.id("cliMessages"),
  handler: async (ctx, args) => {
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    // A removed profile has no CLI to claim the message; refuse so the engine
    // fails the step instead of stranding the run on a `running` step (OS-1920).
    await ensure(getCliProfileById(ctx, thread.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
    await requireAuthorizedProject(ctx, { userId: args.userId, apiKeyScope: null }, thread.projectId, ProjectPermission.CLI_THREAD);
    const now = Date.now();
    const trimmedContent = args.content.trim();
    ensure(trimmedContent.length).gte(1, errors.MESSAGE_CONTENT_REQUIRED);
    let processedContent: string | undefined;
    if ((args.composerDocument?.refs.length ?? 0) > 0) {
      const project = await ensure(getActiveProjectById(ctx, thread.projectId)).notNull(errors.PROJECT_NOT_FOUND);
      processedContent = await resolveSlashCommandComposerContent(ctx, {
        organizationId: project.organizationId,
        projectId: project._id,
        displayContent: trimmedContent,
        composerDocument: args.composerDocument,
      });
    }
    const userMessage = createUserMessage({
      threadId: args.threadId,
      profileId: thread.profileId,
      cliType: thread.cliType,
      cliMode: args.cliMode,
      cliModel: args.cliModel,
      cliEffort: args.cliEffort,
      taskId: thread.associatedTaskId,
      pullRequest: thread.attachedPullRequest,
      content: trimmedContent,
      processedContent,
      workflowRunStepId: args.workflowRunStepId,
      scriptRequest: args.scriptRequest,
      timestamp: now,
    });
    const userMessageId = await insertCliMessage(ctx, userMessage);
    const nextChunkOrder = await insertMessageChunkRows(ctx, {
      message: {
        _id: userMessageId,
        threadId: userMessage.threadId,
        profileId: userMessage.profileId,
        role: userMessage.role,
        cliType: userMessage.cliType,
      },
      chunks: [{ type: "text", data: trimmedContent, timestamp: now, createdAt: now }],
      startChunkOrder: userMessage.nextChunkOrder ?? 0,
    });
    if (nextChunkOrder !== (userMessage.nextChunkOrder ?? 0)) {
      await setMessageChunkOrder(ctx, userMessageId, nextChunkOrder);
    }
    // Same composer-pill denorm as `send` (OS-1454): a later step may dispatch
    // with a different mode/model than the one the thread started with.
    await setThreadLastUsedCliSelection(ctx, thread, {
      cliModel: userMessage.cliModel,
      cliEffort: userMessage.cliEffort,
      cliMode: userMessage.cliMode,
    });
    await markThreadPending(ctx, args.threadId, {
      now,
      flipToPending: thread.processingState === "idle",
    });
    return userMessageId;
  },
});

/**
 * Step 1 of thread-attachment upload flow (web composer):
 * - Client requests a short-lived storage upload URL before uploading binary bytes.
 * - Used by useThreadMessageAttachmentUpload -> useStorageUploadQueue.getUploadUrl().
 *
 * `apiKey` opens all three upload steps to CLI callers (OS-1632) — see
 * `docs/specs/cli-message-attachments.md`.
 */
export const generateMessageAttachmentUploadUrl = mutation({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.CLI_THREAD);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2 of the attachment upload flow: record ownership in
 * `cliMessagePendingUploads` after a successful storage upload, so only the uploader
 * can clean up abandoned blobs. The row goes away once the attachment is referenced
 * by a message or discarded. Returns the blob URL for the caller's own row, which
 * composer drafts persist (OS-2141); null otherwise.
 */
export const registerPendingUploadedAttachment = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.CLI_THREAD);

    const now = Date.now();
    const existingRows = await listPendingUploadsByStorageId(ctx, args.storageId);

    const existingOwnedRow = existingRows.find((row) => row.userId === user._id && row.projectId === args.projectId);

    if (existingOwnedRow) {
      await touchPendingUpload(ctx, existingOwnedRow._id, now);
      return await ctx.storage.getUrl(args.storageId);
    }

    // Referenced or pending anywhere, in either family, means "not yours" (OS-1901).
    // Silent, so storage ownership stays opaque across users/projects.
    if (await isStorageClaimed(ctx, args.storageId)) {
      return null;
    }

    // Silent too: a throw would roll back the delete and leak the blob (OS-1676).
    if (await deleteStorageIfOversized(ctx, args.storageId)) {
      return null;
    }

    await insertPendingUpload(
      ctx,
      {
        projectId: args.projectId,
        userId: user._id,
        storageId: args.storageId,
      },
      now
    );

    return await ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Step 3 of the attachment upload flow: cleanup when an upload is abandoned before
 * send. Owned pending-upload rows always go; storage is deleted only when the blob
 * has no attachment record in any family (OS-1901, `lib/storageRepo.ts`).
 */
export const deletePendingUploadedAttachment = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.CLI_THREAD);

    const pendingRows = await listPendingUploadsByStorageId(ctx, args.storageId);

    const ownedPendingRows = pendingRows.filter((row) => row.userId === user._id && row.projectId === args.projectId);

    if (ownedPendingRows.length === 0) {
      return null;
    }

    await deleteStorageIfUnreferenced(ctx, args.storageId);

    await Promise.all(ownedPendingRows.map((row) => deletePendingUpload(ctx, row._id)));

    return null;
  },
});

/**
 * Daily cron target (convex/crons.ts): drop pending uploads older than the
 * retention window, deleting blobs no message references. Composer drafts keep
 * uploads past unmount (OS-2141), so this is what reclaims abandoned ones.
 */
export const pendingUploadRetentionSweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await listPendingUploadsOlderThan(ctx, Date.now() - PENDING_UPLOAD_RETENTION_MS, PENDING_UPLOAD_SWEEP_BATCH);
    for (const row of expired) {
      await deletePendingUpload(ctx, row._id);
      await deleteStorageIfUnreferenced(ctx, row.storageId);
    }
    if (expired.length === PENDING_UPLOAD_SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cli.messages.pendingUploadRetentionSweep, {});
    }
    return null;
  },
});

/**
 * Attach the agent's uploaded files to its live reply (OS-2091). The explicit
 * reply id makes an old run's slow upload fail instead of landing on a newer
 * run. Re-sending an attached id with identical metadata is a no-op. `check`
 * also records a Check result on the thread's task, or the thread, that points at these files.
 * Specs: `docs/specs/cli-message-attachments.md`, `docs/specs/task-checks.md`.
 */
export const attachToResponse = mutation({
  args: {
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
    sessionId: v.id("cliSessions"),
    attachments: v.array(cliMessageAttachmentInputValidator),
    check: v.optional(checkReportInputValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    messageId: v.id("cliMessages"),
    storageIds: v.array(v.id("_storage")),
    checkResultId: v.optional(v.id("checkResults")),
  }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const { thread } = await requireThreadClaimedBySession(ctx, principal, args.threadId, args.sessionId);
    const message = await requireMessageClaimedBySession(ctx, args.messageId, args.sessionId);
    const isLiveReply =
      message.threadId === thread._id &&
      message.role === "assistant" &&
      message.status === "streaming" &&
      thread.activeAssistantMessageId === message._id;
    ensure(isLiveReply).isTrue(errors.SELECTED_RUN_CHANGED);

    const existing = message.attachments ?? [];
    const sameFile = (a: CliMessageAttachmentInput, b: CliMessageAttachmentInput) =>
      a.storageId === b.storageId &&
      a.fileName === b.fileName &&
      a.fileSize === b.fileSize &&
      a.contentType === b.contentType &&
      a.display === b.display;
    const incoming = args.attachments.filter((attachment, index) => args.attachments.findIndex((other) => sameFile(attachment, other)) === index);
    const added = incoming.filter((attachment) => !existing.some((previous) => sameFile(previous, attachment)));
    // Whatever survives exact dedupe must be a fresh blob: a second name for an attached
    // or in-batch id has no pending claim left to spend.
    const claimedIds = new Set(existing.map((attachment) => attachment.storageId));
    for (const attachment of added) {
      ensure(claimedIds.has(attachment.storageId)).isFalse(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
      claimedIds.add(attachment.storageId);
    }
    assertValidMessageAttachments([...existing, ...added]);

    const now = Date.now();
    await createAttachmentRefs(ctx, {
      messageId: message._id,
      threadId: thread._id,
      role: "assistant",
      owner: { userId: user._id, projectId: thread.projectId },
      attachments: added,
      now,
    });
    const attachments = [...existing, ...added.map((attachment) => ({ ...attachment, uploadedAt: now }))];
    if (added.length > 0) {
      await updateCliMessage(ctx, message._id, { attachments }, now);
    }

    const storageIds = incoming.map((attachment) => attachment.storageId);
    if (!args.check) {
      return { messageId: message._id, storageIds };
    }
    // A Pull request checks run reports on its PR's head, whatever task it gains later (OS-2400).
    const pullRequest =
      thread.pullRequestChecks && thread.attachedPullRequest
        ? { ref: thread.attachedPullRequest.ref, headSha: thread.pullRequestChecks.headSha }
        : undefined;
    // Otherwise a thread with no task owns the result until a task is attached (OS-2293).
    const taskId = pullRequest ? undefined : thread.associatedTaskId;
    if (taskId) {
      await requireAccessibleCliTask(ctx, principal, taskId, thread.projectId);
    }
    const checkResultId: Id<"checkResults"> = await ctx.runMutation(internal.checks.results.report, {
      projectId: thread.projectId,
      taskId,
      pullRequest,
      threadId: thread._id,
      messageId: message._id,
      threadTitle: thread.title,
      threadOwnerId: thread.userId,
      check: args.check,
      files: attachments.filter((attachment) => storageIds.includes(attachment.storageId)),
    });
    return { messageId: message._id, storageIds, checkResultId };
  },
});

/**
 * List messages for a chat with pagination.
 * Only the chat creator can view messages.
 * Returns messages sorted by createdAt ascending (oldest first).
 */
export const listByThread = query({
  args: {
    threadId: v.id("cliThreads"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(cliMessageItemValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return EMPTY_PAGE;
    }

    const viewable = await getViewableThread(ctx, user._id, args.threadId);
    if (!viewable) {
      return EMPTY_PAGE;
    }

    // Descending so the first page holds the newest messages (the bottom of the chat);
    // the client reverses each page for display.
    const results = await paginateThreadMessagesDesc(ctx, args.threadId, args.paginationOpts);
    const taskSummaries = await resolveTaskSummaries(
      ctx,
      results.page.map((message) => message.taskId)
    );

    const page = await Promise.all(
      results.page.map(async (message) => {
        const task = taskSummaries.get(message.taskId);
        return await toMessageItem(ctx, message, task);
      })
    );

    return {
      ...results,
      page,
    };
  },
});

export const listEnvelopesByThread = query({
  args: {
    threadId: v.id("cliThreads"),
    /** Only messages created before this (exclusive); the fork prefix (cli-thread-fork.md). */
    before: v.optional(v.number()),
  },
  returns: v.object({
    /** Newest-first, capped at `ENVELOPE_WINDOW_LIMIT`. */
    envelopes: v.array(cliMessageEnvelopeValidator),
    /** Older messages exist above the window (drives the top cut). */
    hasOlderEnvelopes: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return { envelopes: [], hasOlderEnvelopes: false };
    }

    const viewable = await getViewableThread(ctx, user._id, args.threadId);
    if (!viewable) {
      return { envelopes: [], hasOlderEnvelopes: false };
    }

    const { messages, hasOlder } = await listNewestThreadMessagesDesc(ctx, args.threadId, ENVELOPE_WINDOW_LIMIT, args.before);
    const taskSummaries = await resolveTaskSummaries(
      ctx,
      messages.map((message) => message.taskId)
    );

    return {
      envelopes: messages.map((message) => toMessageEnvelope(message, taskSummaries.get(message.taskId))),
      hasOlderEnvelopes: hasOlder,
    };
  },
});

/** Messages one call may read. Clamped, never rejected — see the query. */
const RECENT_SUMMARY_LIMIT = { min: 1, max: 20, default: 10 };

/**
* A thread's recent messages as summaries (OS-1627), oldest of the window first — the transcript
* read beside `threads.getSummary`, same contract and callers. Named for the shape it returns.
*
* The window comes off the newest end, then reverses into conversation order — reversed text
* means something else to a model. Unpaginated: `limit` is the whole contract. Cost: `limit`
* message rows plus one bounded chunk scan each, capped by `AGENT_TEXT_CHUNK_BUDGET`.
*/
export const listRecentSummaries = query({
  args: {
    // `v.string()` + `normalizeThreadId`, never `v.id(...)`, for the reason
    // `threads.getSummary` documents: an argument-level `v.id` rejects another table's
    // well-formed id before the handler can answer.
    threadId: v.string(),
    limit: v.optional(v.number()),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliMessageSummaryValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }

    const threadId = normalizeThreadId(ctx, args.threadId);
    if (!threadId) {
      return [];
    }

    // `auth.principal`, never `auth.user._id`: a bare id carries no `apiKeyScope`,
    // so a scoped key's boundary would be resolved and then ignored.
    const viewable = await getViewableThread(ctx, auth.principal, threadId);
    if (!viewable) {
      return [];
    }

    // The one readable id that throws: every case above is an access answer where
    // "nothing here" is true, but a group has no transcript and never will, so `[]`
    // would invite the same call again instead of `list_threads(groupId)`.
    ensure(isContainerThread(viewable.thread)).isFalse(errors.MESSAGES_OF_CONTAINER);

    // The domain's own floor and ceiling, which the CLI command will need too —
    // the MCP boundary only validates the schema type.
    const limit = clampPageSize(args.limit, RECENT_SUMMARY_LIMIT);
    const { messages } = await listNewestThreadMessagesDesc(ctx, threadId, limit);
    return enrichMessageSummaries(ctx, messages.reverse());
  },
});

/**
 * The full stored change summary for one run (OS-1600). Envelopes carry only a
 * compact preview; this fetches the complete file list on demand — expanding a
 * Changes card, or opening the run-diff viewer.
 */
export const getRunDiffSummary = query({
  args: {
    messageId: v.id("cliMessages"),
  },
  returns: v.union(cliRunDiffSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const message = await getMessageById(ctx, args.messageId);
    if (!message) {
      return null;
    }

    const viewable = await getViewableThread(ctx, user._id, message.threadId);
    if (!viewable) {
      return null;
    }

    return message.diffSummary ?? null;
  },
});

/**
 * Signed download URLs for one message's attachments (OS-1600). Resolving a
 * storage URL is I/O for data that changes only when the message is created, so
 * the envelope query ships metadata and the render path resolves URLs here —
 * per message, only where attachments actually render.
 */
export const getMessageAttachmentUrls = query({
  args: {
    messageId: v.id("cliMessages"),
  },
  returns: v.array(cliMessageAttachmentSummaryValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    const message = await getMessageById(ctx, args.messageId);
    if (!message) {
      return [];
    }

    const viewable = await getViewableThread(ctx, user._id, message.threadId);
    if (!viewable) {
      return [];
    }

    return await resolveMessageAttachments(ctx, message);
  },
});

// ponytail: agent files past the newest 500 drop off the Evidence tab; paginate if a thread gets there.
const AGENT_ATTACHMENT_REF_LIMIT = 500;

/**
 * The Evidence tab's files (OS-2289): each agent reply's attachments, newest reply first.
 * Metadata only; URLs resolve per reply through `getMessageAttachmentUrls`.
 */
export const listAgentAttachmentsByThread = query({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.array(v.object({ messageId: v.id("cliMessages"), attachments: v.array(cliMessageAttachmentMetadataValidator) })),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth || !(await getViewableThread(ctx, auth.principal, args.threadId))) {
      return [];
    }

    const refs = await listRecentAttachmentRefsByThreadAndRole(ctx, args.threadId, "assistant", AGENT_ATTACHMENT_REF_LIMIT);
    const messageIds = [...new Set(refs.map((ref) => ref.messageId))];
    const messages = await Promise.all(messageIds.map((messageId) => getMessageById(ctx, messageId)));
    return messages.flatMap((message) =>
      message?.attachments?.length
        ? [{ messageId: message._id, attachments: message.attachments }]
        : []
    );
  },
});

export const backfillLegacyContentForThread = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.object({
    migratedMessageCount: v.number(),
    migratedChunkCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    const messages = await listThreadMessagesAsc(ctx, args.threadId);

    let migratedMessageCount = 0;
    let migratedChunkCount = 0;

    for (const message of messages) {
      if (message.content.length === 0 || message.nextChunkOrder !== undefined) {
        continue;
      }

      const existingChunks = await listAllChunksByMessage(ctx, message.threadId, message._id);
      const nextChunkOrder =
        existingChunks.length > 0
          ? existingChunks.length
          : await insertMessageChunkRows(ctx, {
              message,
              chunks: message.content.map((chunk) => ({
                type: chunk.type,
                data: chunk.data,
                timestamp: chunk.timestamp,
                createdAt: chunk.timestamp || message.createdAt,
              })),
              startChunkOrder: 0,
            });

      await updateCliMessage(ctx, message._id, { nextChunkOrder }, Date.now());

      migratedMessageCount += 1;
      migratedChunkCount += Math.max(existingChunks.length, nextChunkOrder);
    }

    return {
      migratedMessageCount,
      migratedChunkCount,
    };
  },
});

async function readThreadForResume(
  ctx: QueryCtx,
  args: { threadId: Id<"cliThreads">; apiKey?: string }
): Promise<Doc<"cliThreads"> | null> {
  const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
  if (!auth) return null;
  const chat = await getAccessibleThread(ctx, auth.user._id, args.threadId);
  if (!chat) return null;
  const hasAccess = await hasProjectAccess(ctx, auth.principal, chat.projectId, ProjectPermission.CLI_THREAD);
  return hasAccess ? chat : null;
}

/**
 * The session the next run resumes, and the Codex turn to fork it through when
 * it belongs to another thread (OS-2073). Spec: cli-message-context.md.
 */
export const getResumeHandleForThread = query({
  args: {
    threadId: v.id("cliThreads"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(v.null(), cliResumeHandleValidator),
  handler: async (ctx, args) => {
    const chat = await readThreadForResume(ctx, args);
    return chat ? resolveResumeHandle(ctx, chat) : null;
  },
});

/**
 * The resumable session id, for CLIs predating `getResumeHandleForThread` and
 * the local resume command. Null when the session must be forked instead.
 */
export const getLatestContinuationForThread = query({
  args: {
    threadId: v.id("cliThreads"),
    apiKey: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const chat = await readThreadForResume(ctx, args);
    const handle = chat ? await resolveResumeHandle(ctx, chat) : null;
    return handle && handle.forkTurnId === undefined ? handle.continuationId : null;
  },
});

/**
 * List the user messages a claiming CLI must deliver, oldest first: the queue
 * plus any stranded tail (OS-1672). See `docs/specs/cli-message-context.md`.
 */
export const listUnprocessedUserMessages = query({
  args: {
    threadId: v.id("cliThreads"),
    includeInterruptedContext: v.optional(v.boolean()),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliMessageItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const chat = await getAccessibleThread(ctx, user._id, args.threadId);
    if (!chat) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const queued = await listDeliverableUserMessages(ctx, args.threadId);
    const history = args.includeInterruptedContext && queued.length > 0
      ? await listInterruptedUserMessages(ctx, args.threadId) : [];
    const queuedIds = new Set(queued.map((message) => message._id));
    const contextIds = new Set(history.filter((message) => !queuedIds.has(message._id)).map((message) => message._id));
    const messages = [...history.filter((message) => contextIds.has(message._id)), ...queued];
    const taskSummaries = await resolveTaskSummaries(
      ctx,
      messages.map((message) => message.taskId)
    );

    return await Promise.all(
      messages.map(async (message) => ({
        ...(await toMessageItem(ctx, message, taskSummaries.get(message.taskId), { preferProcessedContent: true })),
        ...(contextIds.has(message._id) ? { contextOnly: true } : {}),
      }))
    );
  },
});

/**
 * Can the thread's in-progress run consume a steered message right now?
 * Runtime capability, streaming state, live claim, and the claiming session's
 * advertised steering — shared by `requestSteer` and `send`'s steer flag.
 */
async function steerAvailable(ctx: QueryCtx, thread: Doc<"cliThreads">, now: number): Promise<boolean> {
  if (!cliTypeSupportsSteering(thread.cliType)) return false;
  if (thread.processingState !== "streaming") return false;
  if (!thread.claimedBySessionId || isThreadClaimExpired(thread, now)) return false;
  const session = await getSessionById(ctx, thread.claimedBySessionId);
  return session !== null && sessionSupportsSteeringForCliType(session, thread.cliType);
}

/**
 * Ask the running CLI to inject a queued user message into the in-progress
 * run (steering, OS-1111). Only marks intent; the CLI consumes the message
 * via `consumeSteeredMessages`. If the run ends first, the message simply
 * stays queued and is absorbed by the next run.
 */
export const requestSteer = mutation({
  args: {
    messageId: v.id("cliMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const message = await ensure(getMessageById(ctx, args.messageId)).notNull(errors.MESSAGE_NOT_FOUND);
    const chat = await requireThreadOwnership(ctx, user._id, message.threadId);
    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    ensure(message.role).eq("user", errors.MESSAGE_NOT_QUEUED);
    ensure(message.processedAt).isNull(errors.MESSAGE_NOT_QUEUED);
    // Runtime commands are never steered: injecting e.g. "/compact" into a
    // running turn is semantically undefined; they wait for their own run.
    ensure(message.runtimeCommand !== true).isTrue(errors.STEER_NOT_AVAILABLE);

    // Before the availability checks on purpose: re-requesting an already-marked steer
    // is a no-op, never an error — even once the run has ended.
    if (message.steerRequestedAt !== undefined) {
      return null;
    }

    const now = Date.now();
    ensure(await steerAvailable(ctx, chat, now)).isTrue(errors.STEER_NOT_AVAILABLE);

    await updateCliMessage(ctx, args.messageId, { steerRequestedAt: now }, now);

    return null;
  },
});

/** A user message is one text row from `send`; the cap only bounds the read. */
const QUEUED_TEXT_CHUNK_LIMIT = 100;

/**
 * Delete a queued user message so its content can be edited and re-sent. Rejected
 * once processed or while a steer is in flight — the run may already have it.
 *
 * By default refs are removed and unreferenced blobs deleted. With
 * `preserveAttachments` (the Edit action) the blobs stay: refs become pending-upload
 * rows — the same lifecycle as a freshly uploaded attachment — and their summaries
 * come back with the message text so the composer can restore both without re-uploading.
 */
export const removeQueued = mutation({
  args: {
    messageId: v.id("cliMessages"),
    preserveAttachments: v.optional(v.boolean()),
  },
  returns: v.object({
    /** The message's text, read before deletion so Edit never restores a partial client copy (OS-2422). */
    text: v.string(),
    attachments: v.array(cliMessageAttachmentSummaryValidator),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const message = await ensure(getMessageById(ctx, args.messageId)).notNull(errors.MESSAGE_NOT_FOUND);
    const chat = await requireThreadOwnership(ctx, user._id, message.threadId);
    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    ensure(message.role).eq("user", errors.MESSAGE_NOT_QUEUED);
    ensure(message.processedAt).isNull(errors.MESSAGE_NOT_QUEUED);
    ensure(message.steerRequestedAt).isNull(errors.MESSAGE_NOT_QUEUED);

    const now = Date.now();
    const chunks = await listChunksByMessage(ctx, message.threadId, message._id, QUEUED_TEXT_CHUNK_LIMIT);
    const text = chunks
      .flatMap((chunk) => expandCliNormalizedEvent(chunk.normalizedEvent))
      .flatMap((event) => (event.kind === "text" ? [event.text] : []))
      .join("");

    const attachments = await deleteUserMessageWithAttachments(ctx, {
      message,
      chat,
      userId: user._id,
      preserveAttachments: args.preserveAttachments === true,
      now,
    });

    const hasRemainingUnprocessed = await hasUnprocessedUserMessages(ctx, message.threadId);
    await setThreadPendingUserMessages(ctx, message.threadId, hasRemainingUnprocessed, now);

    return { text, attachments };
  },
});

/**
 * Delete a user message outright: chunk rows, attachment refs, and the doc.
 * With `preserveAttachments` the blobs are kept — refs convert into
 * pending-upload rows (the freshly-uploaded-not-yet-sent lifecycle) and their
 * summaries are returned so the composer can re-attach the storage ids
 * without re-uploading. Thread queue-state recompute stays with callers.
 */
async function deleteUserMessageWithAttachments(
  ctx: MutationCtx,
  args: {
    message: Doc<"cliMessages">;
    chat: Doc<"cliThreads">;
    userId: Id<"users">;
    preserveAttachments: boolean;
    now: number;
  }
): Promise<CliMessageAttachmentSummary[]> {
  const { message, chat, userId, preserveAttachments, now } = args;

  let restored: CliMessageAttachmentSummary[] = [];
  if (preserveAttachments) {
    restored = await resolveMessageAttachments(ctx, message);
    for (const ref of await listAttachmentRefsByMessage(ctx, message._id)) {
      await deleteAttachmentRef(ctx, ref._id);
      const pendingRows = await listPendingUploadsByStorageId(ctx, ref.storageId);
      const ownedRow = pendingRows.find((row) => row.userId === userId && row.projectId === chat.projectId);
      if (ownedRow) {
        await touchPendingUpload(ctx, ownedRow._id, now);
      } else if (pendingRows.length === 0) {
        await insertPendingUpload(ctx, { projectId: chat.projectId, userId, storageId: ref.storageId }, now);
      }
    }
  } else {
    await deleteMessageAttachmentRefs(ctx, message._id);
  }

  // Generic per-message chunk-row cleanup (works for user messages too).
  await deleteAssistantChunkRows(ctx, message.threadId, message._id);
  await deleteCliMessage(ctx, message._id);

  return restored;
}

/**
 * Rewind an idle thread and resend its latest user message with composer edits.
 * Spec: docs/specs/cli-thread-edit-last-message.md.
 */
export const editLastResend = mutation({
  args: {
    messageId: v.id("cliMessages"),
    content: v.string(),
    composerDocument: v.optional(slashCommandComposerDocumentValidator),
    cliMode: v.optional(v.union(v.string(), v.null())),
    cliModel: v.optional(v.union(cliModelValidator, v.null())),
    cliEffort: v.optional(v.union(cliEffortValidator, v.null())),
    taskId: v.optional(v.union(v.id("tasks"), v.null())),
    /** Unset keeps the message's PR, null removes it. The thread's Attached pull request never changes here. */
    pullRequestUrl: v.optional(v.union(v.string(), v.null())),
    attachments: v.optional(v.array(cliMessageAttachmentInputValidator)),
    runtimeCommand: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const message = await ensure(getMessageById(ctx, args.messageId)).notNull(errors.MESSAGE_NOT_FOUND);
    const chat = await requireThreadOwnership(ctx, user._id, message.threadId);
    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    ensure(message.role).eq("user", errors.EDIT_LAST_NOT_LAST_USER_MESSAGE);
    const latestUserMessage = await getLatestUserMessage(ctx, message.threadId);
    ensure(latestUserMessage?._id).eq(message._id, errors.EDIT_LAST_NOT_LAST_USER_MESSAGE);

    const trimmedContent = args.content.trim();
    const attachments = assertValidMessageAttachments(args.attachments ?? message.attachments);
    const taskId = args.taskId === undefined ? message.taskId : args.taskId ?? undefined;
    if (taskId) {
      await requireAccessibleCliTask(ctx, user._id, taskId, chat.projectId);
    }
    const pullRequest = args.pullRequestUrl === undefined ? message.pullRequest : requireAttachedPullRequest(args.pullRequestUrl ?? undefined);
    ensure(trimmedContent.length > 0 || attachments.length > 0 || Boolean(taskId) || Boolean(pullRequest)).isTrue(errors.MESSAGE_CONTENT_REQUIRED);
    const selection = normalizeMessageSelection({
      cliType: message.cliType,
      cliMode: args.cliMode === undefined ? message.cliMode : args.cliMode ?? undefined,
      cliModel: args.cliModel === undefined ? message.cliModel : args.cliModel ?? undefined,
      cliEffort: args.cliEffort === undefined ? message.cliEffort : args.cliEffort ?? undefined,
    });
    const runtimeCommand = (args.runtimeCommand ?? message.runtimeCommand) === true &&
      attachments.length === 0 && trimmedContent.startsWith("/") ? true : undefined;
    await requireRuntimeCommandRunner(ctx, { profileId: chat.profileId, cliType: message.cliType ?? chat.cliType, content: trimmedContent, runtimeCommand });
    let processedContent: string | undefined;
    if (!runtimeCommand && (args.composerDocument?.refs.length ?? 0) > 0) {
      const project = await ensure(getActiveProjectById(ctx, chat.projectId)).notNull(errors.PROJECT_NOT_FOUND);
      processedContent = await resolveSlashCommandComposerContent(ctx, {
        organizationId: project.organizationId,
        projectId: project._id,
        displayContent: trimmedContent,
        composerDocument: args.composerDocument,
      });
    }

    // Editing never interrupts a run: the user must explicitly Stop the
    // response first, so a claimed/streaming thread is rejected.
    ensure(chat.processingState ?? "idle").eq("idle", errors.EDIT_LAST_THREAD_PROCESSING);

    const now = Date.now();

    if (args.attachments !== undefined) {
      const refs = await listAttachmentRefsByMessage(ctx, message._id);
      const retainedIds = new Set(attachments.map((attachment) => attachment.storageId));
      const existingIds = new Set(refs.map((ref) => ref.storageId));
      await createAttachmentRefs(ctx, {
        messageId: message._id,
        threadId: message.threadId,
        role: message.role,
        owner: { userId: user._id, projectId: chat.projectId },
        attachments: attachments.filter((attachment) => !existingIds.has(attachment.storageId)),
        now,
      });
      // Retained metadata is rewritten from the caller, so it gets the same size check.
      for (const attachment of attachments.filter((item) => existingIds.has(item.storageId))) {
        await assertStoredAttachmentSize(ctx, attachment);
      }
      for (const ref of refs) {
        if (!retainedIds.has(ref.storageId)) {
          await deleteAttachmentRef(ctx, ref._id);
          await deleteStorageIfUnreferenced(ctx, ref.storageId);
        }
      }
    }

    if (message.processedAt !== undefined) {
      // A processed message with no run is a legacy row: nothing can find its response,
      // so a rewind would orphan the assistant reply and leave the continuation pointing at
      // the discarded turn.
      const runId = await ensure(message.runId).notNull(errors.EDIT_LAST_LEGACY_MESSAGE);

      const threadMessages = await listMessagesByThread(ctx, message.threadId);
      const runAssistants = threadMessages.filter(
        (candidate) => candidate.role === "assistant" && candidate.runId === runId
      );
      for (const assistant of runAssistants) {
        await deleteMessageAttachmentRefs(ctx, assistant._id);
        await deleteAssistantChunkRows(ctx, message.threadId, assistant._id);
        await deleteCliMessage(ctx, assistant._id);
      }

      await unstampRunUserMessages(ctx, message.threadId, runId, now, {
        excludeMessageId: message._id,
      });
    }

    // Replace the message text: chunk rows are the text source of truth;
    // slash-command expansion (`processedContent`) does not survive an edit.
    await deleteAssistantChunkRows(ctx, message.threadId, message._id);
    const nextChunkOrder = await insertMessageChunkRows(ctx, {
      message: {
        _id: message._id,
        threadId: message.threadId,
        profileId: message.profileId,
        role: message.role,
        cliType: message.cliType,
      },
      chunks:
        trimmedContent.length > 0
          ? [{ type: "text", data: trimmedContent, timestamp: now, createdAt: now }]
          : [],
      startChunkOrder: 0,
    });

    await updateCliMessage(
      ctx,
      message._id,
      {
        nextChunkOrder,
        processedAt: undefined,
        processedBySessionId: undefined,
        runId: undefined,
        steerRequestedAt: undefined,
        steeredAt: undefined,
        errorMessage: undefined,
        processedContent,
        runtimeCommand,
        queueFirst: runtimeCommand ? message.queueFirst : undefined,
        ...selection,
        taskId,
        pullRequest,
        attachments: attachments.map((attachment) => ({
          ...attachment,
          uploadedAt: message.attachments?.find((previous) => previous.storageId === attachment.storageId)?.uploadedAt ?? now,
        })),
      },
      now
    );

    await setThreadLastUsedCliSelection(ctx, chat, selection);

    // Resend is the "go" signal: claim cleared, hold released, whole queue
    // (edited message first, in original order) reruns as the next run.
    await reopenThreadForUserTurn(ctx, chat);
    await resetThreadClaim(ctx, chat._id, {
      status: "pending",
      hasPendingUserMessages: true,
      queueHeldAt: undefined,
      now,
    });

    return null;
  },
});

/**
 * Steer-requested unprocessed user messages for a thread, oldest first.
 * Subscribed to by the claiming CLI session while a run is streaming; goes
 * quiet (returns []) once this session no longer holds the claim.
 */
export const listSteerRequestedUserMessages = query({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliMessageItemValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const chat = await getAccessibleThread(ctx, user._id, args.threadId);
    if (!chat) {
      return [];
    }

    if (chat.claimedBySessionId !== args.sessionId || isThreadClaimExpired(chat, Date.now())) {
      return [];
    }

    const hasAccess = await hasProjectAccess(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);
    if (!hasAccess) {
      return [];
    }

    const messages = (await listUnprocessedUserMessagesRepo(ctx, args.threadId)).filter(
      (message) => message.steerRequestedAt !== undefined
    );
    if (messages.length === 0) {
      return [];
    }

    const taskSummaries = await resolveTaskSummaries(
      ctx,
      messages.map((message) => message.taskId)
    );

    return await Promise.all(
      messages.map((message) =>
        toMessageItem(ctx, message, taskSummaries.get(message.taskId), {
          preferProcessedContent: true,
        })
      )
    );
  },
});

/**
 * Stamp steer-requested user messages into the active run after
 * the CLI injected them into the open run. Mirrors `startRunResponse`
 * consumption mechanics but targets the existing streaming assistant message.
 */
export const consumeSteeredMessages = mutation({
  args: {
    threadId: v.id("cliThreads"),
    sessionId: v.id("cliSessions"),
    assistantMessageId: v.id("cliMessages"),
    userMessageIds: v.array(v.id("cliMessages")),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    ensure(args.userMessageIds.length).gte(1, errors.RUN_REQUIRES_USER_MESSAGE);

    const session = await requireSessionOwnership(ctx, user._id, args.sessionId);
    const chat = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(chat.profileId).eq(session.profileId, errors.SESSION_PROFILE_MISMATCH);
    assertThreadClaimedBySession(chat, args.sessionId);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    const assistantMessage = await requireMessageClaimedBySession(ctx, args.assistantMessageId, args.sessionId);
    ensure(assistantMessage.threadId).eq(args.threadId, errors.STEER_NOT_AVAILABLE);
    ensure(assistantMessage.role).eq("assistant", errors.STEER_NOT_AVAILABLE);
    ensure(assistantMessage.status).eq("streaming", errors.STEER_NOT_AVAILABLE);
    const runId = await ensure(assistantMessage.runId).notNull(errors.STEER_NOT_AVAILABLE);

    const userMessages = await getMessagesByIds(ctx, args.userMessageIds);
    const validMessages: Doc<"cliMessages">[] = [];
    for (const message of userMessages) {
      // Runtime/session steering capability is deliberately not re-checked:
      // `steerRequestedAt` can only be set by `requestSteer`, which gates on both, and a
      // message already pushed into the live run must stay consumable.
      const isSteerPending =
        message !== null &&
        message.threadId === args.threadId &&
        message.role === "user" &&
        message.processedAt === undefined &&
        message.steerRequestedAt !== undefined;
      ensure(isSteerPending).isTrue(errors.STEERED_MESSAGES_NOT_PENDING);
      // `isSteerPending` being true implies a non-null message.
      if (message) {
        validMessages.push(message);
      }
    }

    const now = Date.now();
    const cliVersion = session.availableClis.find((available) => available.type === chat.cliType)?.version;

    // Snapshot text before stamping; the marker chunk renders the steered
    // message inline in the assistant stream at the injection position.
    const steeredTexts = await Promise.all(
      validMessages.map(async (message) => {
        if (message.processedContent !== undefined) {
          return message.processedContent;
        }
        const content = await getMessageContentForRead(ctx, message);
        return content.map((chunk) => chunk.data).join("\n");
      })
    );

    await Promise.all(
      validMessages.map((message) =>
        updateCliMessage(
          ctx,
          message._id,
          {
            processedAt: now,
            processedBySessionId: args.sessionId,
            runId,
            steerRequestedAt: undefined,
            steeredAt: now,
            ...(cliVersion !== undefined ? { cliVersion } : {}),
          },
          now
        )
      )
    );

    await appendAssistantChunks(
      ctx,
      assistantMessage,
      steeredTexts.map((text, index) => ({
        type: "convoy_notice",
        data: JSON.stringify({
          code: "steered-message",
          title: "Steered",
          message: text,
          // Lets the steered inline bubble resolve the user message's
          // attachments (with fresh signed URLs) at render time.
          messageId: validMessages[index]._id,
        }),
      })),
      now
    );

    const hasRemainingUnprocessed = await hasUnprocessedUserMessages(ctx, args.threadId);
    await setThreadPendingUserMessages(ctx, args.threadId, hasRemainingUnprocessed, now);

    return null;
  },
});

/**
 * Snapshot unprocessed user messages for a run and create its assistant response target.
 * Requires the chat to be actively claimed by the calling session.
 */
const startRunResponseArgs = {
  threadId: v.id("cliThreads"),
  sessionId: v.id("cliSessions"),
  userMessageIds: v.array(v.id("cliMessages")),
  apiKey: v.optional(v.string()),
};

const startRunResponseReturns = {
  assistantMessageId: v.id("cliMessages"),
  runId: v.string(),
  workspace: v.optional(cliExecutionWorkspaceValidator),
  resolvedCliModel: v.optional(v.string()),
  resolvedCliEffort: v.optional(v.string()),
};

type StartRunResponseArgs = {
  threadId: Id<"cliThreads">;
  sessionId: Id<"cliSessions">;
  userMessageIds: Id<"cliMessages">[];
  apiKey?: string;
};

async function startRunResponseHandler(ctx: MutationCtx, args: StartRunResponseArgs) {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    ensure(args.userMessageIds.length).gte(1, errors.RUN_REQUIRES_USER_MESSAGE);

    const { thread: chat, session, profile } = await requireThreadClaimedBySession(
      ctx, principal, args.threadId, args.sessionId,
    );

    const userMessages = await getMessagesByIds(ctx, args.userMessageIds);
    // Stranded runs are re-deliverable (OS-1672), so the stamp predicate has
    // to admit exactly what `listUnprocessedUserMessages` returned.
    const { strandedRunIds } = await scanStrandedTail(ctx, args.threadId);

    const validMessages: Doc<"cliMessages">[] = [];
    for (const message of userMessages) {
      const isPendingUserMessage =
        message !== null &&
        message.threadId === args.threadId &&
        message.role === "user" &&
        (message.processedAt === undefined ||
          (message.runId !== undefined && strandedRunIds.has(message.runId)));
      ensure(isPendingUserMessage).isTrue(errors.USER_MESSAGES_NOT_PENDING);
      // `isPendingUserMessage` being true implies a non-null message.
      if (message) {
        validMessages.push(message);
      }
    }
    // The CLI may have read the queue before a queue-first command landed (OS-2339).
    if (validMessages.some((message) => message.processedAt === undefined && !message.queueFirst)) {
      const [head] = await listUnprocessedUserMessagesRepo(ctx, args.threadId);
      ensure(head?.queueFirst !== true || args.userMessageIds.includes(head._id)).isTrue(errors.USER_MESSAGES_NOT_PENDING);
    }

    const now = Date.now();
    const runId = crypto.randomUUID();
    const cliVersion = session.availableClis.find((available) => available.type === chat.cliType)?.version;

    // The CLI takes only a prefix of a run at a runtime-command boundary, so
    // un-stamp every stranded run being recovered: members it did not take
    // become ordinary queue entries instead of depending on this run staying
    // stranded to be offered again (OS-1672).
    const recoveredRunIds = new Set(
      validMessages
        .map((message) => message.runId)
        .filter((candidate): candidate is string => candidate !== undefined && strandedRunIds.has(candidate))
    );
    for (const recoveredRunId of recoveredRunIds) {
      await unstampRunUserMessages(ctx, args.threadId, recoveredRunId, now);
    }

    await Promise.all(
      validMessages.map((message) =>
        updateCliMessage(
          ctx,
          message._id,
          {
            processedAt: now,
            processedBySessionId: args.sessionId,
            runId,
            steerRequestedAt: undefined,
            // A re-delivered stranded message is a plain run member again, so
            // its standalone bubble must come back (OS-1672).
            steeredAt: undefined,
            ...(cliVersion !== undefined ? { cliVersion } : {}),
          },
          now
        )
      )
    );

    const hasRemainingUnprocessed = await hasUnprocessedUserMessages(ctx, args.threadId);

    const latestMessage = validMessages.reduce((latest, message) => (message.createdAt > latest.createdAt ? message : latest));
    // The advertised catalog lives off the session row (OS-1721). Only runtimes
    // that advertise one are looked up, so a Claude or Codex dispatch pays nothing.
    const catalog = cliTypeAdvertisesModelCatalog(chat.cliType)
      ? await getRuntimeCatalog(ctx, { profileId: chat.profileId, cliType: chat.cliType })
      : null;
    const availableClis = hydrateAvailableClis(session.availableClis, catalog ? [catalog] : [], chat.profileId);
    const resolvedCliModel = resolveCliRunModel({
      cliType: chat.cliType,
      cliModel: latestMessage?.cliModel,
      availableClis,
    });
    const resolvedCliEffort = resolveCliRunEffort({
      cliType: chat.cliType,
      cliEffort: latestMessage?.cliEffort,
      // Per-model efforts (OpenCode variants) validate against the selected
      // model's advertised variants.
      context: {
        cliModel: latestMessage?.cliModel,
        availableClis,
      },
    });

    const assistantMessageId = await insertAssistantStreamingMessage(ctx, {
      threadId: args.threadId,
      profileId: chat.profileId,
      cliType: chat.cliType,
      cliMode: latestMessage?.cliMode,
      cliModel: latestMessage?.cliModel,
      cliEffort: latestMessage?.cliEffort,
      cliVersion,
      claimedBySessionId: args.sessionId,
      runId,
      now,
    });

    await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

    const streamWatchdogId = await ctx.scheduler.runAfter(STREAM_WATCHDOG_INTERVAL_MS, internal.cli.threads.runControl.streamingWatchdogTick, {
      threadId: args.threadId,
      intervalMs: STREAM_WATCHDOG_INTERVAL_MS,
      messageId: assistantMessageId,
    });

    await markThreadStreaming(ctx, args.threadId, {
      hasPendingUserMessages: hasRemainingUnprocessed,
      activeAssistantMessageId: assistantMessageId,
      streamWatchdogId,
      lastActivityAt: now,
    });

    return {
      assistantMessageId,
      runId,
      workspace: toExecutionWorkspace(chat, profile),
      ...(resolvedCliModel !== undefined ? { resolvedCliModel } : {}),
      ...(resolvedCliEffort !== undefined ? { resolvedCliEffort } : {}),
    };
}

export const startRunResponse = mutation({
  args: startRunResponseArgs,
  returns: v.object(startRunResponseReturns),
  handler: startRunResponseHandler,
});

/**
 * Append content chunks to the active run's assistant message.
 * Only the session that claimed the message can append content.
 * Supports API key authentication for CLI access.
 */
const appendRunContentArgs = {
  messageId: v.id("cliMessages"),
  sessionId: v.id("cliSessions"),
  chunks: v.array(
    v.object({
      type: v.string(),
      data: v.string(),
      // Agent-side emit time. Optional: older CLIs do not send it, and the
      // server falls back to its own append time.
      timestamp: v.optional(v.number()),
    })
  ),
  apiKey: v.optional(v.string()),
};

type AppendRunContentArgs = {
  messageId: Id<"cliMessages">;
  sessionId: Id<"cliSessions">;
  chunks: Array<{ type: string; data: string; timestamp?: number }>;
  apiKey?: string;
};

async function appendRunContentHandler(ctx: MutationCtx, args: AppendRunContentArgs) {
    const { user } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Verify message is claimed by this session
    const message = await requireMessageClaimedBySession(ctx, args.messageId, args.sessionId);
    const chat = await ensure(getThreadById(ctx, message.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    assertThreadOwnedByUser(chat, user._id);
    assertThreadClaimedBySession(chat, args.sessionId);

    // Intentionally skipped: appending chunks is a high-frequency in-flight operation on a
    // message already created through an authorized `startRunResponse`. Project/scope
    // enforcement stays on the claim/start/complete/fail gates rather than re-reading
    // permissions per streamed chunk. To re-enable, destructure `principal` above and call
    // `requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD)`.

    const now = Date.now();
    if (message.role === "assistant") {
      await appendAssistantChunks(ctx, message, args.chunks, now);
      const newContinuationId =
        message.cliContext?.continuationId !== undefined
          ? undefined
          : getContinuationIdFromIncomingChunks({
              cliType: message.cliType,
              chunks: args.chunks,
            });

      // Record usage asynchronously; Codex snapshots share a thread cursor.
      // Spec: docs/specs/cost-tracking.md.
      const costExtraction = getCostUsageFromIncomingChunks({
        cliType: message.cliType,
        chunks: args.chunks,
        // Codex attribution needs the resolved invocation model, never an unknown slot.
        cliModel:
          resolveCliRunModel({
            cliType: message.cliType,
            cliModel: message.cliModel,
          }) ?? (message.cliType === "codex" ? undefined : message.cliModel),
        continuationId: message.cliContext?.continuationId ?? newContinuationId ?? undefined,
        usageCursor: chat.codexUsageCursor,
        modelState: message.codexModelState,
      });
      if (costExtraction && (costExtraction.usage.byModel.length || costExtraction.usage.reportedCost)) {
        // A run can stream usage across several batches (Codex app-server,
        // OpenCode); only its first cost event counts toward `runCount`.
        const isFirstCostEvent = message.costRecordedAt === undefined;
        await ctx.scheduler.runAfter(0, internal.costs.core.recordUsage, {
          projectId: chat.projectId,
          userId: chat.userId,
          taskId: chat.associatedTaskId,
          threadId: chat._id,
          cliType: message.cliType,
          atMs: now,
          costUsd: costExtraction.usage.costUsd,
          reportedCost: costExtraction.usage.reportedCost,
          byModel: costExtraction.usage.byModel,
          runCount: isFirstCostEvent ? 1 : 0,
        });
        if (isFirstCostEvent) {
          await updateCliMessage(ctx, args.messageId, { costRecordedAt: now }, now);
        }
      }
      if (costExtraction?.nextModelState) {
        await updateCliMessage(ctx, args.messageId, { codexModelState: costExtraction.nextModelState }, now);
      }
      if (costExtraction?.nextUsageCursor) {
        await setThreadCodexUsageCursor(ctx, chat._id, costExtraction.nextUsageCursor);
      }

      // Runtime facts capture: the init event (at most one per run) carries
      // the agent's slash-command inventory; unchanged payloads are a no-op.
      const slashCommands = getSlashCommandsFromIncomingChunks({
        cliType: message.cliType,
        chunks: args.chunks,
      });
      if (slashCommands !== null) {
        await upsertRuntimeFact(ctx, {
          profileId: chat.profileId,
          cliType: message.cliType,
          pathId: chat.pathId,
          key: RUNTIME_FACT_SLASH_COMMANDS,
          payload: JSON.stringify({ commands: slashCommands }),
          now,
        });
      }

      // The chunk cursor lives on the head row now, so a flush writes this doc
      // only for a real transition: the run's continuation id, once (OS-1729).
      if (newContinuationId || message.status !== "streaming") {
        await updateCliMessage(
          ctx,
          args.messageId,
          {
            ...(newContinuationId
              ? { cliContext: { ...(message.cliContext ?? {}), continuationId: newContinuationId } }
              : {}),
            status: "streaming",
          },
          now
        );
      }

      return null;
    }

    const nextChunkOrder = await ensure(message.nextChunkOrder).notNull(errors.USER_MESSAGE_MISSING_CHUNK_ORDER);
    ensure(message.content.length).eq(0, errors.LEGACY_USER_CONTENT_UNSUPPORTED);

    const nextUserChunkOrder = await insertMessageChunkRows(ctx, {
      message,
      chunks: args.chunks.map((chunk) => ({
        ...chunk,
        timestamp: now,
        createdAt: now,
      })),
      startChunkOrder: nextChunkOrder,
    });

    await updateCliMessage(
      ctx,
      args.messageId,
      {
        nextChunkOrder: nextUserChunkOrder,
        status: "streaming",
      },
      now
    );

    return null;
}

export const appendRunContent = mutation({
  args: appendRunContentArgs,
  returns: v.null(),
  handler: appendRunContentHandler,
});

/**
 * How much of the run's tail `complete` inspects to decide whether the agent
 * ended waiting on the user. The awaiting-input tool call and its pending
 * tool result are the last thing a run emits, so the whole stream is never
 * needed — and reading it would exceed the transaction read limits on long runs.
 */
const COMPLETION_TAIL_CHUNK_LIMIT = 50;

/**
 * Mark message as completed.
 * Only the session that claimed the message can mark it complete.
 * Supports API key authentication for CLI access.
 */
export const complete = mutation({
  args: {
    messageId: v.id("cliMessages"),
    sessionId: v.id("cliSessions"),
    cliContext: v.optional(cliMessageContextValidator),
    workspaceNotice: v.optional(cliWorkspaceNoticeValidator),
    diffSummary: v.optional(cliRunDiffSummaryValidator),
    // How a Bash step's script run ended (OS-1886); the run engine reads it.
    scriptResult: v.optional(cliScriptResultValidator),
    chatStatus: v.optional(v.literal("waiting_input")),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Verify message is claimed by this session
    const message = await requireMessageClaimedBySession(ctx, args.messageId, args.sessionId);
    const chat = await ensure(getThreadById(ctx, message.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    assertThreadOwnedByUser(chat, user._id);
    assertThreadClaimedBySession(chat, args.sessionId);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    const now = Date.now();
    await updateCliMessage(
      ctx,
      args.messageId,
      {
        status: "completed",
        cliContext: args.cliContext ?? message.cliContext,
        ...(args.diffSummary ? { diffSummary: capDiffSummary(args.diffSummary) } : {}),
        // The CLI already caps the tail; clamped again so a foreign build
        // cannot grow the message document.
        ...(args.scriptResult
          ? { scriptResult: { ...args.scriptResult, outputTail: clampChars(args.scriptResult.outputTail, SCRIPT_OUTPUT_TAIL_MAX_CHARS) } }
          : {}),
      },
      now
    );
    await settleAssistantStreamHead(ctx, args.messageId);

    await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

    const hasRemainingUnprocessed = await hasUnprocessedUserMessages(ctx, message.threadId);

    const tailChunkRows =
      message.role === "assistant"
        ? await listRecentChunksByMessageAsc(
            ctx,
            message.threadId,
            message._id,
            COMPLETION_TAIL_CHUNK_LIMIT
          )
        : [];
    const normalizedEvents = tailChunkRows.flatMap((chunk) =>
      expandCliNormalizedEvent(chunk.normalizedEvent)
    );

    const proposedPlan = chat.metadata?.proposedPlan;
    const hasReadyProposal = proposedPlan?.ready === true && proposedPlan.messageId === message._id;
    let nextStatus: "waiting_input" | "pending" | "completed";
    if (hasRemainingUnprocessed) {
      nextStatus = "pending";
    } else if (hasReadyProposal || hasAwaitingUserInputTool(normalizedEvents)) {
      nextStatus = "waiting_input";
    } else if (args.chatStatus === "waiting_input") {
      nextStatus = "waiting_input";
    } else {
      nextStatus = "completed";
    }

    // Partial-streaming rows are superseded by the final whole message chunks;
    // clean them up out-of-band so completion stays fast.
    if (
      message.role === "assistant" &&
      (await hasEphemeralChunks(ctx, message.threadId, message._id))
    ) {
      await ctx.scheduler.runAfter(0, internal.cli.messages.cleanupEphemeralChunks, {
        threadId: message.threadId,
        messageId: message._id,
      });
    }

    const cancelledPendingInteractions = await cancelPendingInteractionRequestsForThread(
      ctx,
      message.threadId,
      "run completed",
      now
    );

    // Totals come from the uncapped payload: capping drops files, not changes.
    const runDiffTotals = args.diffSummary?.files.reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    );

    await markThreadStreamEnded(ctx, message.threadId, {
      status: nextStatus,
      preserveProposedPlan: hasReadyProposal && !hasRemainingUnprocessed,
      hasPendingUserMessages: hasRemainingUnprocessed,
      processingState: hasRemainingUnprocessed ? "claimed" : "idle",
      lastActivityAt: now,
      git: {
        ...(runDiffTotals ? {
          linesAdded: (chat.git?.linesAdded ?? 0) + runDiffTotals.additions,
          linesRemoved: (chat.git?.linesRemoved ?? 0) + runDiffTotals.deletions,
        } : {}),
        ...(args.workspaceNotice?.previousPath === chat.git?.previousWorkingDirectory &&
          args.workspaceNotice?.path === chat.path
          ? { previousWorkingDirectory: undefined } : {}),
      },
    });

    // Thread lifecycle events (OS-1243). No actor: the CLI authenticates as the owner,
    // who is exactly who should be notified. A wait coming from an already-pending
    // interaction request was announced at its creation — re-emitting would coalesce into
    // a fresh row and toast the owner twice.
    const waitingAlreadyNotified = nextStatus === "waiting_input" && cancelledPendingInteractions > 0;
    if ((nextStatus === "completed" || nextStatus === "waiting_input") && !waitingAlreadyNotified) {
      await emitEvent(ctx, {
        type: nextStatus === "completed" ? "thread.completed" : "thread.waiting_input",
        projectId: chat.projectId,
        subject: { kind: "thread", id: chat._id },
        payload: { messageId: message._id },
      });
    }

    return null;
  },
});

const EPHEMERAL_CLEANUP_BATCH_SIZE = 500;

/**
 * Delete ephemeral (partial-streaming) chunk rows for a completed assistant
 * message in batches, rescheduling itself while rows remain. Not invoked for
 * failed messages: there the deltas are the only record of partial output.
 */
export const cleanupEphemeralChunks = internalMutation({
  args: {
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deletedCount = await deleteEphemeralChunkRows(
      ctx,
      args.threadId,
      args.messageId,
      EPHEMERAL_CLEANUP_BATCH_SIZE
    );

    if (deletedCount === EPHEMERAL_CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.cli.messages.cleanupEphemeralChunks, {
        threadId: args.threadId,
        messageId: args.messageId,
      });
    }

    return null;
  },
});

/**
 * Continue a batched chunk copy into a fork (OS-1397). A deleted target ends it;
 * a deleted source (the parent edited the run) ends it with a notice on the copy.
 */
export const copyMessageChunks = internalMutation({
  args: {
    sourceThreadId: v.id("cliThreads"),
    sourceMessageId: v.id("cliMessages"),
    targetThreadId: v.id("cliThreads"),
    targetMessageId: v.id("cliMessages"),
    afterChunkOrder: v.number(),
    createdAt: v.number(),
    messageIdMap: v.optional(v.record(v.id("cliMessages"), v.id("cliMessages"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await getMessageById(ctx, args.targetMessageId);
    if (!target) {
      return null;
    }
    const source = await getMessageById(ctx, args.sourceMessageId);
    const scheduledMore = source
      ? await copyMessageChunkRows(ctx, {
          source: { threadId: args.sourceThreadId, messageId: args.sourceMessageId },
          target: { threadId: args.targetThreadId, messageId: args.targetMessageId, profileId: target.profileId },
          afterChunkOrder: args.afterChunkOrder,
          createdAt: args.createdAt,
          messageIdMap: args.messageIdMap,
        })
      : false;
    if (!source) {
      await insertMessageChunkRows(ctx, {
        message: target,
        chunks: [{ type: "convoy_notice", data: JSON.stringify(FORK_COPY_INCOMPLETE_NOTICE), timestamp: args.createdAt, createdAt: args.createdAt }],
        startChunkOrder: args.afterChunkOrder + 1,
      });
    }
    if (!scheduledMore) {
      // This chain is done, whether it finished or gave up: release the fork's gate.
      const fork = await getThreadById(ctx, args.targetThreadId);
      if (fork) await addForkCopiesInFlight(ctx, fork, -1);
    }
    return null;
  },
});

/** Continue a batched chunk-row deletion started in another transaction. */
export const cleanupMessageChunks = internalMutation({
  args: {
    threadId: v.id("cliThreads"),
    messageId: v.id("cliMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteAssistantChunkRows(ctx, args.threadId, args.messageId);
    return null;
  },
});

/**
 * Mark message as failed.
 * Only the session that claimed the message can mark it failed.
 * Supports API key authentication for CLI access.
 */
export const fail = mutation({
  args: {
    messageId: v.id("cliMessages"),
    sessionId: v.id("cliSessions"),
    errorMessage: v.string(),
    cliContext: v.optional(cliMessageContextValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Verify message is claimed by this session
    const message = await requireMessageClaimedBySession(ctx, args.messageId, args.sessionId);
    const chat = await ensure(getThreadById(ctx, message.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    assertThreadOwnedByUser(chat, user._id);
    assertThreadClaimedBySession(chat, args.sessionId);

    await requireAuthorizedProject(ctx, principal, chat.projectId, ProjectPermission.CLI_THREAD);

    const now = Date.now();
    await updateCliMessage(
      ctx,
      args.messageId,
      {
        status: "failed",
        errorMessage: args.errorMessage,
        cliContext: args.cliContext ?? message.cliContext,
      },
      now
    );
    await settleAssistantStreamHead(ctx, args.messageId);

    await cancelStreamWatchdog(ctx, chat.streamWatchdogId);

    const hasRemainingUnprocessed = await hasUnprocessedUserMessages(ctx, message.threadId);

    const cancelledPendingInteractions = await cancelPendingInteractionRequestsForThread(
      ctx,
      message.threadId,
      "run failed",
      now
    );

    // A run that failed while parked on an approval/question was waiting on
    // the user, not working (OS-1463). The message keeps its failure and
    // error text (the CLI reported a real reason); only the thread softens.
    const windDown = resolveRunWindDown(cancelledPendingInteractions, hasRemainingUnprocessed);

    await markThreadStreamEnded(ctx, message.threadId, {
      status: windDown.threadStatus,
      hasPendingUserMessages: hasRemainingUnprocessed,
      processingState: hasRemainingUnprocessed ? "claimed" : "idle",
      lastActivityAt: now,
      runError: args.errorMessage,
    });

    // Thread lifecycle event (OS-1243); no actor — CLI acts as the owner.
    if (windDown.emitFailedEvent) {
      await emitEvent(ctx, {
        type: "thread.failed",
        projectId: chat.projectId,
        subject: { kind: "thread", id: chat._id },
        payload: { messageId: message._id },
      });
    }

    return null;
  },
});

/**
 * Retry a failed or stuck message.
 * Only the chat creator can retry messages.
 * Resets it to pending so CLI can pick it up again.
 * Supports both Clerk auth and API key.
 */
export const retry = mutation({
  args: {
    messageId: v.id("cliMessages"),
    apiKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Support both Clerk auth and API key
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    const message = await ensure(getMessageById(ctx, args.messageId)).notNull(errors.MESSAGE_NOT_FOUND);

    const thread = await ensure(getThreadById(ctx, message.threadId)).notDeleted(errors.THREAD_NOT_FOUND);

    // Only chat creator can retry
    ensure(thread.userId).eq(user._id, errors.NOT_AUTHORIZED);

    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);

    // Only allow retry on non-completed messages
    ensure(message.status).notEq("completed", errors.CANNOT_RETRY_COMPLETED);

    await retryMessageOnThread(ctx, thread, message, Date.now());

    return null;
  },
});

/**
 * The retry itself, shared by `retry` and `retryForWorkflowStep`: a failed
 * assistant message is deleted and its run's user messages requeued; a user
 * message is reset to pending. Either way the thread requeues for a fresh run.
 */
async function retryMessageOnThread(ctx: MutationCtx, thread: Doc<"cliThreads">, message: Doc<"cliMessages">, now: number): Promise<void> {
  await cancelStreamWatchdog(ctx, thread.streamWatchdogId);

  const runId = message.runId;
  if (message.role === "assistant" && runId) {
    // Failed assistant reply: delete it and return its run's user messages to the queue.
    await unstampRunUserMessages(ctx, message.threadId, runId, now);

    await deleteMessageAttachmentRefs(ctx, message._id);
    await deleteAssistantChunkRows(ctx, message.threadId, message._id);
    await deleteCliMessage(ctx, message._id);
  } else if (message.role === "user") {
    // User message: un-process it back to a fresh queue entry (claim, run stamp, and steer marks cleared).
    await updateCliMessage(
      ctx,
      message._id,
      {
        status: "pending",
        claimedBySessionId: undefined,
        claimedAt: undefined,
        errorMessage: undefined,
        processedAt: undefined,
        processedBySessionId: undefined,
        runId: undefined,
        steerRequestedAt: undefined,
        steeredAt: undefined,
      },
      now
    );
  } else {
    // Assistant message that never got a run: nothing to unstamp, just release the claim.
    await updateCliMessage(
      ctx,
      message._id,
      {
        status: "pending",
        claimedBySessionId: undefined,
        claimedAt: undefined,
        errorMessage: undefined,
      },
      now
    );
  }

  await cancelPendingInteractionRequestsForThread(
    ctx,
    thread._id,
    "message retried",
    now
  );

  await requeueThreadForRetry(ctx, thread._id, message._id, now);
}

/**
 * The Run view's step-level Retry for a thread-failed step (OS-1870): the
 * same requeue as the in-thread retry button, through the cli domain's
 * internal boundary. Retries the failed run's assistant message when one
 * exists (deleting it requeues the prompt), else the step's own prompt
 * message. A thread that already left `failed` needs nothing — the engine's
 * recovery pass revives the step.
 */
export const retryForWorkflowStep = internalMutation({
  args: {
    threadId: v.id("cliThreads"),
    userMessageId: v.id("cliMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(errors.THREAD_NOT_FOUND);
    if (thread.status !== "failed") {
      return null;
    }
    const userMessage = await getMessageById(ctx, args.userMessageId);
    if (!userMessage) {
      return null;
    }
    const failedAssistant = userMessage.runId
      ? (await listRunMessages(ctx, args.threadId, userMessage.runId)).find((message) => message.role === "assistant")
      : undefined;
    await retryMessageOnThread(ctx, thread, failedAssistant ?? userMessage, Date.now());
    return null;
  },
});

/** Authorized execution history for the service client; no transcript stored by the daemon. */
export const listServiceRuns = query({
  args: { threadId: v.id("cliThreads"), projectId: v.id("projects"), apiKey: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(serviceRunValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const view = await ensure(getViewableThread(ctx, principal, args.threadId)).notNull(errors.THREAD_NOT_FOUND);
    ensure(view.thread.projectId).eq(args.projectId, errors.SERVICE_PROFILE_MISMATCH);
    const page = await paginateAssistantMessages(ctx, args.threadId, { ...args.paginationOpts, numItems: clampPageSize(args.paginationOpts.numItems, { min: 1, max: 50, default: 20 }) });
    return { ...page, page: page.page.map(toServiceRun) };
  },
});

export const getServiceRunLogs = query({
  args: { threadId: v.id("cliThreads"), projectId: v.id("projects"), messageId: v.id("cliMessages"), apiKey: v.optional(v.string()), after: v.optional(v.number()), raw: v.optional(v.boolean()), before: v.optional(v.number()), eventOrder: v.optional(v.number()), offset: v.optional(v.number()) },
  returns: v.object({ run: serviceRunValidator, page: v.array(v.object({ order: v.number(), eventJson: v.string(), truncated: v.boolean(), bytes: v.optional(v.number()), length: v.optional(v.number()), nextOffset: v.optional(v.number()), fidelity: v.optional(v.string()) })), cursor: v.number(), hasMore: v.boolean(), raw: v.optional(v.boolean()), latest: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const view = await ensure(getViewableThread(ctx, principal, args.threadId)).notNull(errors.THREAD_NOT_FOUND);
    ensure(view.thread.projectId).eq(args.projectId, errors.SERVICE_PROFILE_MISMATCH);
    const message = await ensure(getMessageById(ctx, args.messageId)).notNull(errors.MESSAGE_NOT_FOUND);
    ensure(message.threadId).eq(args.threadId, errors.MESSAGE_NOT_FOUND);
    ensure(message.role).eq("assistant", errors.MESSAGE_NOT_FOUND);
    const after = args.after ?? -1;
    ensure(Number.isSafeInteger(after) && after >= -1).isTrue(errors.SERVICE_LOG_CURSOR_INVALID);
    if (args.raw) {
      for (const value of [args.before, args.eventOrder, args.offset]) {
        if (value !== undefined) ensure(Number.isSafeInteger(value) && value >= 0).isTrue(errors.SERVICE_LOG_CURSOR_INVALID);
      }
      const latestRows = args.eventOrder === undefined ? await listStoredRunChunksBefore(ctx, args.threadId, args.messageId, Number.MAX_SAFE_INTEGER, 1) : [];
      const latest = args.eventOrder ?? latestRows[0]?.chunkOrder ?? -1;
      const rows = args.eventOrder !== undefined
        ? await listStoredRunChunksAfter(ctx, args.threadId, args.messageId, args.eventOrder - 1, 1)
        : args.before !== undefined
          ? await listStoredRunChunksBefore(ctx, args.threadId, args.messageId, args.before, 11)
          : await listStoredRunChunksAfter(ctx, args.threadId, args.messageId, after, 11);
      if (args.eventOrder !== undefined) ensure(rows[0]?.chunkOrder).eq(args.eventOrder, errors.SERVICE_LOG_CURSOR_INVALID);
      const page = rows.slice(0, 10).map(row => toRawRunLogRow(row, args.eventOrder !== undefined, args.offset));
      if (args.before !== undefined && args.eventOrder === undefined) page.reverse();
      return { run: toServiceRun(message), page, cursor: page.at(-1)?.order ?? after,
        hasMore: rows.length > 10, raw: true, latest };
    }
    const rows = await listStoredRunChunksAfter(ctx, args.threadId, args.messageId, after, 11);
    const page = rows.slice(0, 10).map(row => {
      const event = resolveChunkReadEvent(row, message.cliType);
      const json = JSON.stringify(event ?? { kind: "unknown" });
      const truncated = json.length > 2000;
      return { order: row.chunkOrder, eventJson: truncated ? JSON.stringify({ kind: "truncated", preview: json.slice(0, 1000) }) : json, truncated };
    });
    return { run: toServiceRun(message), page, cursor: page.at(-1)?.order ?? after, hasMore: rows.length > 10 };
  },
});
