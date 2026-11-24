import { internalMutation, mutation, query, type MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { getAuthenticatedAccess, getAuthenticatedUser, getOptionalAuthenticatedUser } from "../../lib/access/auth";
import { getUserById } from "../../users/lib/usersRepo";
import { resolveTaskSummaries } from "../../lib/contracts/taskSummaries";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { getViewableThread, requireAccessibleCliTask, requireThreadOwnership } from "../lib/permissions";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { cliScriptRequestValidator, cliThreadKindValidator, cliThreadMetadataValidator } from "../../lib/contracts/validators";
import { workflowLaneTypeValidator } from "../../lib/contracts/workflowDefinition";
import { STREAM_THREAD_DELETED_REASON } from "../lib/constants";
import { resolvePathInfo } from "../lib/paths";
import { getCliProfileById } from "../lib/cliProfilesRepo";
import {
  isContainerThread,
  isThreadDone,
  requiresThreadAttention,
  threadNeedsAttentionAck,
  threadDisplayTaskId,
  threadNeedsReadPatch,
} from "../lib/watchStatus";
import { failStreamingChat, requeueClaimedNonStreamingChat } from "./runControl";
import { resolveCliThreadAgents } from "./lib/threadAgents";
import {
  getThreadById,
  listGroupRows,
  markThreadDone,
  markThreadNotDone,
  markThreadRead,
  markThreadUnread,
  normalizeThreadId,
  pinThread,
  setThreadAssociatedTask,
  setThreadAttachedPullRequest,
  setThreadChecklist,
  setThreadTitle,
  shareThread,
  softDeleteThread,
  unpinThread,
  unshareThread,
} from "./lib/cliThreadsRepo";
import { cliThreadItemValidator, createThreadArgs, threadSelectionArgs, toThreadItem } from "./lib/validators";
import { parseAttachedPullRequest } from "../../lib/contracts/github";
import { createEmptyThreadCore, createThreadCore, forkThreadCore } from "./lib/lifecycle";
import { normalizeChatTitle } from "./lib/naming";
import { assertChecklistInProject } from "../../checks/lib/checklistsRepo";

/**
 * Create a new chat for a profile with an initial message.
 * Only the profile owner can create threads for their profile.
 *
 * `apiKey` opens this to MCP/CLI callers (OS-1162): the no-source
 * `create_thread` case, spawning into a profile/path with no source thread.
 */
export const create = mutation({
  args: {
    ...createThreadArgs,
    apiKey: v.optional(v.string()),
  },
  returns: v.id("cliThreads"),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx, args.apiKey);
    const { threadId } = await createThreadCore(ctx, access, args);
    return threadId;
  },
});

/** Branch a thread at the run containing `messageId` (OS-1397). Spec: docs/specs/cli-thread-fork.md. */
export const fork = mutation({
  args: { messageId: v.id("cliMessages"), groupWithThreadId: v.optional(v.id("cliThreads")) },
  returns: v.object({ threadId: v.id("cliThreads"), containerId: v.optional(v.id("cliThreads")) }),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx);
    return forkThreadCore(ctx, access, args.messageId, args.groupWithThreadId);
  },
});

/**
 * The workflow engine's thread-creation boundary (OS-1868): lazily creates a
 * lane thread as a child of the run's container, on behalf of the starting
 * user. Same pipeline as `create` — `createThreadCore` re-checks the user's
 * profile ownership and project permission at dispatch time.
 */
export const createForWorkflowLane = internalMutation({
  args: {
    ...createThreadArgs,
    userId: v.id("users"),
    parentThreadId: v.id("cliThreads"),
    workflowRunId: v.id("workflowRuns"),
    workflowLaneId: v.string(),
    workflowLaneType: workflowLaneTypeValidator,
    workflowRunStepId: v.id("workflowRunSteps"),
    scriptRequest: v.optional(cliScriptRequestValidator),
  },
  returns: v.object({ threadId: v.id("cliThreads"), userMessageId: v.id("cliMessages") }),
  handler: async (ctx, args) => {
    const { userId, parentThreadId, workflowRunId, workflowLaneId, workflowLaneType, workflowRunStepId, scriptRequest, ...threadArgs } = args;
    // Internal invariant, not a user-facing guard: the run's starter always exists.
    const user = await getUserById(ctx, userId);
    if (!user) {
      throw new Error(`Workflow run starter ${userId} not found`);
    }
    return createThreadCore(ctx, { user, principal: { userId: user._id, apiKeyScope: null } }, threadArgs, {
      parentThreadId,
      workflowRunId,
      workflowLaneId,
      workflowLaneType,
      workflowRunStepId,
      scriptRequest,
    });
  },
});

/**
 * The engine's message-less twin of `createForWorkflowLane` (OS-1920): a
 * single lane whose first script is held for approval gets its thread before
 * the hold, so Approve renders in a transcript. Same checks as `create`.
 */
export const createEmptyForWorkflowLane = internalMutation({
  args: {
    ...threadSelectionArgs,
    title: v.string(),
    userId: v.id("users"),
    parentThreadId: v.id("cliThreads"),
    workflowRunId: v.id("workflowRuns"),
    workflowLaneId: v.string(),
  },
  returns: v.id("cliThreads"),
  handler: async (ctx, args) => {
    const { userId, parentThreadId, workflowRunId, workflowLaneId, ...threadArgs } = args;
    const user = await getUserById(ctx, userId);
    if (!user) {
      throw new Error(`Workflow run starter ${userId} not found`);
    }
    return createEmptyThreadCore(ctx, { user, principal: { userId: user._id, apiKeyScope: null } }, threadArgs, {
      parentThreadId,
      workflowRunId,
      workflowLaneId,
    });
  },
});

// Thread detail only. `metadata` stays off the shared item validator so plan updates
// during a run don't invalidate list queries or ship plan text in every row.
const cliThreadDetailValidator = v.object({
  ...cliThreadItemValidator.fields,
  metadata: v.optional(cliThreadMetadataValidator),
  /** Sizes a child's tab placeholders before the container loads. Spec: docs/specs/thread-groups.md. */
  containerChildCount: v.optional(v.number()),
  /** Drives group sharing badges and menus. Spec: docs/specs/cli-thread-sharing.md. */
  containerSharedAt: v.optional(v.number()),
  /** Distinguishes group children from workflow-run children for sharing actions. */
  containerKind: v.optional(cliThreadKindValidator),
  /**
   * The container's `workflowRunId`, mirrored like `containerKind` (OS-1366):
   * a run child's tab must not offer group-only actions (share, move out).
   */
  containerWorkflowRunId: v.optional(v.id("workflowRuns")),
  /**
   * Whether the caller created the thread (OS-1574). A non-owner is reading a
   * shared thread and gets the read-only view. Detail-only: every list query
   * is `userId`-scoped, so list rows are always the caller's.
   */
  isOwner: v.boolean(),
});

/**
 * Get a single chat by ID with profile info.
 * The chat creator, or a project teammate once the creator shared it (OS-1574).
 */
export const get = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(cliThreadDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const threadId = normalizeThreadId(ctx, args.threadId);
    if (!threadId) {
      return null;
    }

    const viewable = await getViewableThread(ctx, user._id, threadId);
    if (!viewable) {
      return null;
    }
    const { thread: chat, isOwner } = viewable;

    // Get profile info
    const [profile, taskSummaries, threadAgents, container] = await Promise.all([
      getCliProfileById(ctx, chat.profileId),
      resolveTaskSummaries(ctx, [threadDisplayTaskId(chat)]),
      resolveCliThreadAgents(ctx, [chat.projectAgentId]),
      chat.parentThreadId ? getThreadById(ctx, chat.parentThreadId) : null,
    ]);
    const { pathLabel, pathString, gitRemoteUrl, branch } = resolvePathInfo(chat, profile);

    return {
      ...toThreadItem(chat, {
        profileName: profile?.name ?? "Unknown",
        pathLabel,
        pathString,
        gitRemoteUrl,
        branch,
        status: chat.status,
        hasUnread: !chat.readAt || chat.readAt < chat.lastActivityAt,
        requiresAttention: requiresThreadAttention(chat),
        isDone: isThreadDone(chat),
        associatedTask: taskSummaries.get(threadDisplayTaskId(chat)),
        agent: threadAgents.get(chat.projectAgentId),
      }),
      metadata: chat.metadata,
      ...(container?.childCount !== undefined ? { containerChildCount: container.childCount } : {}),
      ...(container?.sharedAt !== undefined ? { containerSharedAt: container.sharedAt } : {}),
      ...(container?.kind !== undefined ? { containerKind: container.kind } : {}),
      ...(container?.workflowRunId !== undefined ? { containerWorkflowRunId: container.workflowRunId } : {}),
      isOwner,
    };
  },
});

/**
 * Update chat title.
 * Only the chat creator can update the title.
 */
export const updateTitle = mutation({
  args: {
    threadId: v.id("cliThreads"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    const title = normalizeChatTitle(args.title);

    await setThreadTitle(ctx, args.threadId, title);
    return null;
  },
});

/**
 * Mark chat as read.
 * Only the chat creator can mark as read.
 */
export const markRead = mutation({
  args: {
    threadId: v.id("cliThreads"),
    acknowledgeAttention: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    const acknowledgeAttention = Boolean(args.acknowledgeAttention) && threadNeedsAttentionAck(chat);

    // Already read with nothing to acknowledge: skip the patch. Every write here
    // contends with the CLI's run-lifecycle writes, so a redundant mark-read is a pure
    // OCC-conflict source. `threadNeedsReadPatch` judges containers by child aggregate
    // (OS-1475) — an own-field check would skip a cascade the children still need.
    if (!threadNeedsReadPatch(chat, acknowledgeAttention)) {
      return null;
    }

    await markThreadRead(ctx, args.threadId, { now: Date.now(), acknowledgeAttention });
    return null;
  },
});

/** Mark an owned thread done, including read and attention acknowledgment. */
export const markDone = mutation({
  args: { threadId: v.id("cliThreads"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, user._id, args.threadId);
    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
    await markThreadDone(ctx, thread._id, {
      now: Date.now(),
      acknowledgeAttention: threadNeedsAttentionAck(thread),
    });
    return null;
  },
});

/** Clear an owned thread's done mark; a container's children follow (OS-2176). */
export const markNotDone = mutation({
  args: { threadId: v.id("cliThreads"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, user._id, args.threadId);
    await requireAuthorizedProject(ctx, principal, thread.projectId, ProjectPermission.CLI_THREAD);
    await markThreadNotDone(ctx, thread._id);
    return null;
  },
});

/** Attach a task to a thread started without one (OS-1713). Attach-once; spec: `docs/specs/cli-thread-task-attachments.md`. */
export const attachTask = mutation({
  args: { threadId: v.id("cliThreads"), taskId: v.id("tasks"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, access.user._id, args.threadId);
    await requireAuthorizedProject(ctx, access.principal, thread.projectId, ProjectPermission.CLI_THREAD);
    ensure(isContainerThread(thread)).isFalse(errors.ATTACH_TASK_TO_CONTAINER);
    // Before the task check: a retry stays a no-op even if the task was deleted since.
    if (thread.associatedTaskId === args.taskId) {
      return null;
    }
    ensure(thread.associatedTaskId).isNull(errors.THREAD_TASK_ALREADY_ATTACHED);
    await requireAccessibleCliTask(ctx, access.principal, args.taskId, thread.projectId);
    await setThreadAssociatedTask(ctx, thread._id, args.taskId);
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: access.user._id,
      eventType: "thread_attached",
      changeDetails: { type: "thread", threadId: thread._id, threadTitle: thread.title },
    });
    return null;
  },
});

/** Attach a PR to a thread, attach-once like `attachTask`. Spec: docs/specs/github-integration.md → Pull requests in threads. */
export const attachPullRequest = mutation({
  /** A github.com PR URL or `owner/name#number`. */
  args: { threadId: v.id("cliThreads"), pullRequest: v.string(), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, access.user._id, args.threadId);
    await requireAuthorizedProject(ctx, access.principal, thread.projectId, ProjectPermission.CLI_THREAD);
    ensure(isContainerThread(thread)).isFalse(errors.ATTACH_PULL_REQUEST_TO_CONTAINER);
    const pullRequest = await ensure(parseAttachedPullRequest(args.pullRequest)).notNull(errors.PULL_REQUEST_URL_INVALID);
    if (thread.attachedPullRequest?.ref === pullRequest.ref) {
      return null;
    }
    ensure(thread.attachedPullRequest).isNull(errors.THREAD_PULL_REQUEST_ALREADY_ATTACHED);
    await setThreadAttachedPullRequest(ctx, thread._id, pullRequest);
    return null;
  },
});

/** Pick a task-less thread's own Checklist; null picks none. Spec: docs/specs/task-checks.md → Ownership. */
export const setChecklist = mutation({
  args: { threadId: v.id("cliThreads"), checklistId: v.union(v.id("checklists"), v.null()), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await getAuthenticatedAccess(ctx, args.apiKey);
    const thread = await requireThreadOwnership(ctx, access.user._id, args.threadId);
    await requireAuthorizedProject(ctx, access.principal, thread.projectId, ProjectPermission.CLI_THREAD);
    if (args.checklistId !== null) {
      await assertChecklistInProject(ctx, thread.projectId, args.checklistId);
    }
    await setThreadChecklist(ctx, thread._id, args.checklistId ?? undefined);
    return null;
  },
});

/**
 * Mark chat as unread.
 * Only the chat creator can mark as unread.
 */
export const markUnread = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chat = await requireThreadOwnership(ctx, user._id, args.threadId);

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    await markThreadUnread(ctx, args.threadId);
    return null;
  },
});

/**
 * Soft delete a chat.
 * Only the chat creator can delete.
 */
export const remove = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat) {
      return null; // Idempotent
    }

    // Only chat creator can delete
    if (chat.userId !== user._id) {
      throw new ConvexError(errors.NOT_AUTHORIZED);
    }

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    await deleteThreadWithCleanup(ctx, chat, Date.now(), user._id);
    return null;
  },
});

/**
 * Soft-delete a thread, first winding down any live streaming/claim state.
 * Exported for `batch.batchRemove`. Lives here rather than in the module `lib/`:
 * it calls runControl's wind-down helpers, and lib must not import callable modules.
 */
export async function deleteThreadWithCleanup(
  ctx: MutationCtx,
  chat: Doc<"cliThreads">,
  now: number,
  actorUserId: Id<"users">,
  opts: { inCascade?: boolean } = {}
): Promise<void> {
  // Container: children follow (OS-1475), sequentially like batchRemove — each may need
  // its own streaming wind-down. Child deletes skip the per-child re-sync so no
  // auto-delete fires mid-loop; the container's own soft delete below is THE delete.
  if (isContainerThread(chat)) {
    for (const child of await listGroupRows(ctx, chat._id)) {
      await deleteThreadWithCleanup(ctx, child, now, actorUserId, { inCascade: true });
    }
  }
  if (chat.processingState === "streaming" && chat.activeAssistantMessageId) {
    await failStreamingChat(ctx, chat, STREAM_THREAD_DELETED_REASON, now, actorUserId);
  } else if (chat.claimedBySessionId || chat.processingState !== "idle" || chat.streamWatchdogId) {
    await requeueClaimedNonStreamingChat(ctx, chat, now);
  }
  await softDeleteThread(ctx, chat._id, now, opts);
}

/**
 * Pin a thread to the top of the thread list (OS-1173).
 * Only the thread creator can pin.
 */
export const pin = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat) {
      return null; // Idempotent
    }

    if (chat.userId !== user._id) {
      throw new ConvexError(errors.NOT_AUTHORIZED);
    }

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    // Pin is container-local (OS-1475): the pinned index doesn't discriminate on
    // parentThreadId, so a pinned child would leak into listPinnedByProject.
    ensure(chat.parentThreadId).isNull(errors.PIN_GROUP_CHILD);

    await pinThread(ctx, args.threadId);
    return null;
  },
});

/**
 * Unpin a thread (OS-1173).
 * Only the thread creator can unpin.
 */
export const unpin = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat) {
      return null; // Idempotent
    }

    if (chat.userId !== user._id) {
      throw new ConvexError(errors.NOT_AUTHORIZED);
    }

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    await unpinThread(ctx, args.threadId);
    return null;
  },
});

/**
 * Share a thread read-only with project teammates (OS-1574).
 * Only the thread creator can share; the flag grants reads only.
 */
export const share = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat) {
      return null; // Idempotent
    }

    if (chat.userId !== user._id) {
      throw new ConvexError(errors.NOT_AUTHORIZED);
    }

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    // A group is shared as a unit — the container is the shareable row (OS-1579).
    // A workflow run's container is not shareable: runs answer only to their
    // starting user (docs/specs/workflows.md → Who acts on a run).
    ensure(chat.workflowRunId).isNull(errors.SHARE_WORKFLOW_RUN);
    ensure(chat.parentThreadId).isNull(errors.SHARE_GROUP_CHILD);

    await shareThread(ctx, args.threadId);
    return null;
  },
});

/**
 * Stop sharing a thread (OS-1574).
 * Only the thread creator can unshare.
 */
export const unshare = mutation({
  args: {
    threadId: v.id("cliThreads"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const chat = await getThreadById(ctx, args.threadId);
    if (!chat) {
      return null; // Idempotent
    }

    if (chat.userId !== user._id) {
      throw new ConvexError(errors.NOT_AUTHORIZED);
    }

    await requireAuthorizedProject(ctx, user._id, chat.projectId, ProjectPermission.CLI_THREAD);

    await unshareThread(ctx, args.threadId);
    return null;
  },
});
