import { requireAttachedPullRequest, requireRuntimeCommandRunner } from "../../lib/messages/invariants";
import { attachedPullRequestName, attachedPullRequestUrl, GUIDE_PROMPT_MAX, type AttachedPullRequest } from "../../../lib/contracts/github";
import type { MutationCtx } from "../../../_generated/server";
import { ConvexError, type ObjectType } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import { requireAuthorizedProject, type AuthenticatedAccess } from "../../../lib/access/permissions";
import type { CliScriptRequest } from "../../../lib/contracts/validators";
import { ensure } from "../../../lib/shared/ensure";
import { resolveSlashCommandComposerContent } from "../../../lib/slashCommands/composer";
import { ProjectPermission } from "../../../../lib/authz/permissions";
import { isValidWorktreeBranchName } from "../../../../lib/threads/worktree-branches";
import { errors as agentErrors } from "../../../agents/errors";
import { getProjectAgentById } from "../../../agents/lib/projectAgentsRepo";
import { getActiveProjectById } from "../../../projects/lib/projectsRepo";
import { findLinkedPullRequest } from "../../../integrations/github/lib/integrationPullRequestsRepo";
import { listActiveRepositoryLinksForProject } from "../../../integrations/github/lib/integrationRepositoryLinksRepo";
import { getGuideById, insertGuide, restartGuide } from "../../../integrations/github/lib/integrationPullRequestGuidesRepo";
import { errors } from "../../errors";
import { assertValidMessageAttachments, createAttachmentRefs } from "../../lib/messages/attachments";
import { createUserMessage, normalizeMessageSelection } from "../../lib/messages/normalize";
import { requireAccessibleCliTask } from "../../lib/permissions";
import { copyMessageChunkRows, insertMessageChunkRows } from "../../lib/chunks/lifecycle";
import { insertAttachmentRef } from "../../lib/cliMessageAttachmentRefsRepo";
import { requireThreadOwnership } from "../../lib/permissions";
import { canForkReply, cliTypeSupportsFirstMessageRuntimeCommand, cliTypeSupportsFork } from "../../lib/runtimes/registry";
import { getCliProfileById } from "../../lib/cliProfilesRepo";
import {
  getMessageById,
  insertCliMessage,
  listRunMessages,
  scanStrandedTail,
  setMessageChunkOrder,
  type MessageInsert,
} from "../../lib/cliMessagesRepo";
import { MAX_GROUP_CHILDREN } from "../../../../lib/threads/constants";
import {
  addForkCopiesInFlight,
  countGroupRows,
  getThreadById,
  clearThreadPullRequestGuide,
  insertCliThread,
  insertGroupContainer,
  setThreadParent,
  unpinThread,
  unshareThread,
  type ThreadInsert,
} from "./cliThreadsRepo";
import { deriveForkTabTitle, deriveTitleFromSeed, normalizeChatTitle, normalizeExecutionBranch } from "./naming";
import type { createThreadArgs, threadSelectionArgs } from "./validators";

/**
 * A new thread's selection, validated the same way for every creation path:
 * profile ownership, path, worktree spec, project permission, Project agent
 * snapshot, task access. Nothing is written; `insert` is the row every path
 * spreads before adding its title and lineage.
 */
async function resolveThreadSelection(
  ctx: MutationCtx,
  access: { user: Doc<"users">; principal: AuthenticatedAccess },
  args: ObjectType<typeof threadSelectionArgs>
): Promise<{
  profile: Doc<"cliProfiles">;
  task: Doc<"tasks"> | null;
  pullRequest: AttachedPullRequest | undefined;
  insert: Omit<ThreadInsert, "title">;
}> {
  const { user, principal } = access;
  // Verify profile exists and user owns it
  const profile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
  ensure(profile.userId).eq(user._id, errors.THREAD_PROFILE_NOT_OWNED);

  // Validate pathId exists in the profile's paths
  const pathEntry = await ensure(profile.paths.find((p) => p.id === args.pathId)).notNull(errors.PATH_NOT_FOUND_IN_PROFILE);

  // A pending worktree spec targets the selected path as its parent repo;
  // the CLI creates the worktree on claim and repoints the thread.
  if (args.worktree) {
    ensure(args.worktree.parentPathId).eq(args.pathId, errors.WORKTREE_PARENT_PATH_MISMATCH);
    ensure(pathEntry.kind).notEq("worktree", errors.WORKTREE_PARENT_NOT_REPO_PATH);
    ensure(isValidWorktreeBranchName(args.worktree.branch)).isTrue(errors.WORKTREE_BRANCH_INVALID);
    if (args.worktree.baseRef !== undefined) {
      ensure(isValidWorktreeBranchName(args.worktree.baseRef)).isTrue(errors.WORKTREE_BRANCH_INVALID);
    }
  }

  await requireAuthorizedProject(ctx, principal, profile.projectId, ProjectPermission.CLI_THREAD);

  // Bind the Project agent (OS-1138) and snapshot its prompt; an agent without a
  // prompt is still bindable (attribution only).
  let agentPromptSnapshot: string | undefined;
  if (args.projectAgentId) {
    const projectAgent = await ensure(getProjectAgentById(ctx, args.projectAgentId)).notDeleted(agentErrors.PROJECT_AGENT_NOT_FOUND);
    ensure(projectAgent.projectId).eq(profile.projectId, agentErrors.PROJECT_AGENT_DIFFERENT_PROJECT);
    // Stored prompts are already normalized by the agents domain; trim
    // defensively and keep the snapshot unset when the prompt is empty.
    agentPromptSnapshot = projectAgent.prompt?.trim() || undefined;
  }

  const task = args.taskId ? await requireAccessibleCliTask(ctx, principal, args.taskId, profile.projectId) : null;
  const pullRequest = requireAttachedPullRequest(args.pullRequestUrl);
  const pullRequestChecks = args.pullRequestChecks
    ? await requirePullRequestChecksHead(ctx, profile.projectId, pullRequest, args.pullRequestChecks.headSha)
    : undefined;
  const parent = args.worktree ? pathEntry : profile.paths.find((path) => path.id === pathEntry.parentPathId);
  const worktree = args.worktree
    ? { ...args.worktree, status: "pending" as const }
    : pathEntry.kind === "worktree" && parent && pathEntry.branch
      ? { parentPathId: parent.id, branch: pathEntry.branch, status: "created" as const }
      : undefined;
  return {
    profile,
    task,
    pullRequest,
    insert: {
      userId: user._id,
      projectId: profile.projectId,
      profileId: args.profileId,
      pathId: args.pathId,
      path: pathEntry.path, // Snapshot for fallback display
      cliType: args.cliType,
      associatedTaskId: task?._id,
      attachedPullRequest: pullRequest,
      pullRequestChecks,
      agentWorkSource: args.agentWorkSource,
      projectAgentId: args.projectAgentId,
      agentPromptSnapshot,
      executionBranch: !args.worktree && pathEntry.kind !== "worktree" ? normalizeExecutionBranch(args.initialBranch) : undefined,
      worktree: worktree ? { ...worktree, parentPath: parent?.path, parentGitRemoteUrl: parent?.gitRemoteUrl } : undefined,
      // The creating selection, denormalized as the thread's last-used one (OS-1454).
      lastUsedCliSelection: normalizeMessageSelection({
        cliType: args.cliType,
        cliMode: args.cliMode,
        cliModel: args.cliModel,
        cliEffort: args.cliEffort,
      }),
    },
  };
}

/** The head a checks run reports on: the caller's, while it is still the stored PR's in a connected repository. */
async function requirePullRequestChecksHead(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  pullRequest: AttachedPullRequest | undefined,
  headSha: string
): Promise<{ headSha: string }> {
  await requireStoredPullRequestAtHead(ctx, projectId, pullRequest, headSha, {
    notConnected: errors.PULL_REQUEST_CHECKS_NEED_CONNECTED_PULL_REQUEST,
    moved: errors.PULL_REQUEST_CHECKS_HEAD_MOVED,
  });
  return { headSha };
}

/** Retry (OS-2413): the requester's own failed Guide of this PR in this project. */
async function requireRetryableGuide(
  ctx: MutationCtx,
  guideId: Id<"integrationPullRequestGuides">,
  userId: Id<"users">,
  projectId: Id<"projects">,
  pullRequest: Doc<"integrationPullRequests">
): Promise<Doc<"integrationPullRequestGuides">> {
  return ensure(getGuideById(ctx, guideId))
    .notNull(errors.GUIDE_RETRY_NOT_FOUND)
    .satisfies((guide) => guide.projectId === projectId, errors.GUIDE_RETRY_NOT_FOUND)
    .satisfies((guide) => guide.requesterId === userId, errors.GUIDE_RETRY_NOT_ALLOWED)
    .satisfies((guide) => guide.repositoryId === pullRequest.repositoryId && guide.number === pullRequest.number, errors.GUIDE_RETRY_OTHER_PULL_REQUEST)
    .satisfies((guide) => guide.status === "failed", errors.GUIDE_RETRY_NOT_FAILED);
}

/** The stored PR in a connected repository, still at the head the caller's prompt names, so the run and its output agree on the revision. */
async function requireStoredPullRequestAtHead(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  pullRequest: AttachedPullRequest | undefined,
  headSha: string,
  messages: { notConnected: string; moved: string }
): Promise<Doc<"integrationPullRequests">> {
  const links = await listActiveRepositoryLinksForProject(ctx, projectId);
  const row = await ensure(pullRequest ? findLinkedPullRequest(ctx, links, pullRequest) : null).notNull(messages.notConnected);
  ensure(row.headSha).eq(headSha, messages.moved);
  return row;
}

/**
 * A workflow lane thread born with no message (OS-1920, docs/specs/workflows.md
 * → Bash steps): the approval gate held the lane's first script, so the thread
 * opens idle and `completed` for the engine to wait-park. Its title is the
 * caller's; there is no seed to derive one from.
 */
export async function createEmptyThreadCore(
  ctx: MutationCtx,
  access: { user: Doc<"users">; principal: AuthenticatedAccess },
  args: ObjectType<typeof threadSelectionArgs> & { title: string },
  lineage: { parentThreadId: Id<"cliThreads">; workflowRunId: Id<"workflowRuns">; workflowLaneId: string }
): Promise<Id<"cliThreads">> {
  const { insert } = await resolveThreadSelection(ctx, access, args);
  return insertCliThread(ctx, { ...insert, title: normalizeChatTitle(args.title), ...lineage, awaitsFirstMessage: true }, Date.now());
}

/**
 * Shared create pipeline for `core.create` and `groups.addThreadToGroup` (OS-1474):
 * validates the selection, inserts the thread, writes its initial user message.
 * `lineage.parentThreadId` births it as a group child; `spawnedByThreadId` is
 * agent-driven spawn lineage (OS-1162).
 *
 * Takes `{ user, principal }` rather than a user doc: ownership wants `user._id`,
 * but project authorization must see `principal` or an API key's scope is resolved
 * and then ignored.
 */
export async function createThreadCore(
  ctx: MutationCtx,
  access: { user: Doc<"users">; principal: AuthenticatedAccess },
  args: ObjectType<typeof createThreadArgs>,
  lineage?: {
    parentThreadId?: Id<"cliThreads">;
    spawnedByThreadId?: Id<"cliThreads">;
    /**
     * Run + lane a workflow lane thread executes for (OS-1868); the step
     * stamps the initial message, and a parallel lane's one-shot thread
     * itself (OS-1885) — it serves exactly that step for its whole life.
     */
    workflowRunId?: Id<"workflowRuns">;
    workflowLaneId?: string;
    workflowLaneType?: "single" | "parallel";
    workflowRunStepId?: Id<"workflowRunSteps">;
    /** A Bash step opening its lane thread (OS-1886): the first message is a script request. */
    scriptRequest?: CliScriptRequest;
  }
): Promise<{ threadId: Id<"cliThreads">; userMessageId: Id<"cliMessages"> }> {
  const { user } = access;
  const { parentThreadId, spawnedByThreadId, workflowRunId, workflowLaneId, workflowLaneType, workflowRunStepId, scriptRequest } = lineage ?? {};
  const { profile, task, pullRequest, insert } = await resolveThreadSelection(ctx, access, args);
  const guidePullRequest = args.pullRequestGuide
    ? await requireStoredPullRequestAtHead(ctx, profile.projectId, pullRequest, args.pullRequestGuide.headSha, {
        notConnected: errors.GUIDE_NEEDS_CONNECTED_PULL_REQUEST,
        moved: errors.GUIDE_HEAD_MOVED,
      })
    : null;
  const retryGuideId = args.pullRequestGuide?.retryGuideId;
  const retried = guidePullRequest && retryGuideId ? await requireRetryableGuide(ctx, retryGuideId, user._id, profile.projectId, guidePullRequest) : null;

  const now = Date.now();
  const attachments = assertValidMessageAttachments(args.attachments);
  const trimmedContent = args.content.trim();
  if (trimmedContent.length === 0 && attachments.length === 0 && !task && !pullRequest) {
    throw new ConvexError(errors.MESSAGE_CONTENT_REQUIRED);
  }
  // Same invariants as `cli.messages.send`: the command is the whole message, so
  // attachments and org-command expansion don't apply.
  const runtimeCommand = args.runtimeCommand === true && attachments.length === 0 && trimmedContent.startsWith("/") ? true : undefined;
  await requireRuntimeCommandRunner(ctx, { profileId: profile._id, cliType: args.cliType, content: trimmedContent, runtimeCommand });
  if (runtimeCommand) {
    // A fresh session's first message carries the bootstrap on some runtimes, which a
    // raw command would displace (cursor) or skip for the thread's whole life
    // (opencode). Rejected rather than degraded: the caller asked for a command.
    ensure(cliTypeSupportsFirstMessageRuntimeCommand(args.cliType)).isTrue(errors.RUNTIME_COMMAND_FIRST_MESSAGE_UNSUPPORTED);
  }
  const hasSlashCommandRefs = !runtimeCommand && (args.composerDocument?.refs.length ?? 0) > 0;
  let processedContent: string | undefined;
  if (hasSlashCommandRefs) {
    const project = await ensure(getActiveProjectById(ctx, profile.projectId)).notNull(errors.PROJECT_NOT_FOUND);
    processedContent = await resolveSlashCommandComposerContent(ctx, {
      organizationId: project.organizationId,
      projectId: project._id,
      displayContent: trimmedContent,
      composerDocument: args.composerDocument,
    });
  }
  // Group children share one task, so the task name would title every tab identically
  // (OS-1559) — inside a group the prompt wins, elsewhere the task name does.
  const promptSeed = trimmedContent.length > 0 ? trimmedContent : attachments[0]?.fileName;
  const seed = parentThreadId ? (promptSeed ?? task?.name) : (task?.name ?? promptSeed);
  const fallback = pullRequest ? attachedPullRequestName(pullRequest) : "New thread";
  const title = args.title === undefined ? deriveTitleFromSeed(seed ?? fallback) : normalizeChatTitle(args.title);

  // Create the chat with pending status (waiting for CLI to pick up)
  const threadId = await insertCliThread(
    ctx,
    {
      ...insert,
      title,
      pullRequestGuide: guidePullRequest ? { headSha: guidePullRequest.headSha } : undefined,
      parentThreadId,
      spawnedByThreadId,
      workflowRunId,
      workflowLaneId,
      workflowRunStepId: workflowLaneType === "parallel" ? workflowRunStepId : undefined,
    },
    now
  );
  if (guidePullRequest) {
    // The Guide row is born with its run; `guides.submit` finds it by thread (docs/specs/github-integration.md → Guides).
    const run = { threadId, baseSha: guidePullRequest.baseSha, headSha: guidePullRequest.headSha, cliType: args.cliType, cliModel: args.cliModel, createdAt: now };
    // What the agent was given, not the setting now: an admin may change it while the composer is open.
    const guidePrompt = args.pullRequestGuide?.guidePrompt?.trim() || null;
    ensure((guidePrompt?.length ?? 0) <= GUIDE_PROMPT_MAX).isTrue(errors.GUIDE_PROMPT_TOO_LONG);
    if (retried) {
      // The old thread stops writing it, so its late submit can't land on the retry.
      await clearThreadPullRequestGuide(ctx, retried.threadId);
      await restartGuide(ctx, retried._id, run, guidePrompt);
    } else {
      await insertGuide(
        ctx,
        {
          ...run,
          projectId: profile.projectId,
          repositoryId: guidePullRequest.repositoryId,
          number: guidePullRequest.number,
          requesterId: user._id,
          status: "writing",
        },
        guidePrompt
      );
    }
  }

  // Create initial user message
  const userMessage = createUserMessage({
    threadId,
    profileId: args.profileId,
    cliType: args.cliType,
    cliMode: args.cliMode,
    cliModel: args.cliModel,
    cliEffort: args.cliEffort,
    taskId: task?._id,
    pullRequest,
    content: trimmedContent,
    processedContent,
    runtimeCommand,
    workflowRunStepId,
    scriptRequest,
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
    threadId,
    role: "user",
    owner: { userId: user._id, projectId: profile.projectId },
    attachments,
    now,
  });

  return { threadId, userMessageId };
}

/**
 * The container a new sibling of `source` joins, created lazily on the first
 * addition (OS-1474). Callers reject a plain container `source` first.
 * Spec: docs/specs/thread-groups.md.
 */
export async function resolveGroupContainer(
  ctx: MutationCtx,
  userId: Id<"users">,
  source: Doc<"cliThreads">
): Promise<Id<"cliThreads">> {
  if (source.kind === "group" || source.parentThreadId) {
    const container = source.kind === "group"
      ? source
      : await ensure(getThreadById(ctx, source.parentThreadId!)).notDeleted(errors.THREAD_NOT_FOUND);
    ensure(container.userId).eq(userId, errors.NOT_AUTHORIZED);
    // The container too: a foreign child must not seed the next spawn.
    ensure(container.projectId).eq(source.projectId, errors.ADD_TO_GROUP_CROSS_PROJECT);
    // Counts soft-deleted rows too, to bound physical fan-out (spec: Group
    // lifecycle). `childCount` excludes them and must not be used.
    ensure(await countGroupRows(ctx, container._id)).lt(MAX_GROUP_CHILDREN, errors.groupFull(MAX_GROUP_CHILDREN));
    return container._id;
  }
  // First addition: lazily create the container and reparent the source; the cap
  // is unreachable with one member. A pin and a share (OS-1579) transfer to the
  // container, because neither index is parent-aware and a pinned or shared child
  // would leak into them. The moved share keeps the owner's link alive.
  const containerId = await insertGroupContainer(ctx, source, Date.now());
  await setThreadParent(ctx, source._id, containerId);
  if (source.isPinned) {
    await unpinThread(ctx, source._id);
  }
  if (source.sharedAt !== undefined) {
    await unshareThread(ctx, source._id);
  }
  return containerId;
}

/** The copied row of a forked run (OS-1397): content and run identity, no claim or cost fields. */
function toForkedMessageInsert(message: Doc<"cliMessages">, threadId: Id<"cliThreads">, now: number): MessageInsert {
  return {
    threadId,
    role: message.role,
    profileId: message.profileId,
    cliType: message.cliType,
    cliMode: message.cliMode,
    cliModel: message.cliModel,
    cliEffort: message.cliEffort,
    cliVersion: message.cliVersion,
    cliContext: message.cliContext,
    taskId: message.taskId,
    pullRequest: message.pullRequest,
    attachments: message.attachments,
    nextChunkOrder: message.nextChunkOrder,
    content: message.content,
    processedContent: message.processedContent,
    sentBy: message.sentBy,
    status: message.status,
    errorMessage: message.errorMessage,
    runId: message.runId,
    processedAt: message.processedAt === undefined ? undefined : now,
    steeredAt: message.steeredAt,
    diffSummary: message.diffSummary,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Branch a thread at the run containing `messageId` (OS-1397): a new idle
 * thread owning a copy of that run, seeded with the parent's previous turn.
 * `groupWithThreadId` births it as that thread's Group child (a new tab).
 * Rules and the copied shape: docs/specs/cli-thread-fork.md.
 */
export async function forkThreadCore(
  ctx: MutationCtx,
  access: { user: Doc<"users">; principal: AuthenticatedAccess },
  messageId: Id<"cliMessages">,
  groupWithThreadId?: Id<"cliThreads">
): Promise<{ threadId: Id<"cliThreads">; containerId?: Id<"cliThreads"> }> {
  const picked = await ensure(getMessageById(ctx, messageId)).notNull(errors.MESSAGE_NOT_FOUND);
  const source = await requireThreadOwnership(ctx, access.user._id, picked.threadId);
  await requireAuthorizedProject(ctx, access.principal, source.projectId, ProjectPermission.CLI_THREAD);
  ensure(cliTypeSupportsFork(source.cliType)).isTrue(errors.FORK_RUNTIME_UNSUPPORTED);

  const runId = await ensure(picked.runId).notNull(errors.FORK_RUN_NOT_RESUMABLE);
  const run = await listRunMessages(ctx, source._id, runId);
  const users = run.filter((message) => message.role === "user");
  const reply = await ensure(run.find((message) => message.role === "assistant")).notNull(errors.FORK_RUN_NOT_RESUMABLE);
  const runStart = await ensure(users[0]).notNull(errors.FORK_RUN_NOT_RESUMABLE);
  // Codex forks through the reply's turn; replies recorded before OS-2073 have none.
  ensure(canForkReply(source.cliType, reply.cliContext)).isTrue(errors.FORK_RUNTIME_UNSUPPORTED);
  ensure(reply.status === "streaming").eq(false, errors.FORK_RUN_NOT_RESUMABLE);
  await ensure(reply.cliContext?.continuationId).notNull(errors.FORK_RUN_NOT_RESUMABLE);
  ensure(users.some((message) => message.scriptRequest)).eq(false, errors.FORK_RUN_IS_SCRIPT);
  // A fork's copy lands in batches after the mutation returns; copying a copy mid-flight would truncate it.
  ensure((source.forkedFrom?.copiesInFlight ?? 0) > 0).eq(false, errors.FORK_COPY_IN_PROGRESS);
  // Not always the source: a history row forks an ancestor, but the tab opens beside the viewed thread.
  const groupWith = groupWithThreadId ? await requireThreadOwnership(ctx, access.user._id, groupWithThreadId) : undefined;
  if (groupWith) {
    ensure(groupWith.kind).isNull(errors.FORK_GROUP_TARGET_IS_CONTAINER);
    ensure(groupWith.projectId).eq(source.projectId, errors.FORK_GROUP_CROSS_PROJECT);
  }

  const last = users[users.length - 1] ?? runStart;
  const { insert } = await resolveThreadSelection(ctx, access, {
    profileId: source.profileId,
    pathId: source.pathId,
    initialBranch: source.git?.executionBranch,
    cliType: source.cliType,
    cliMode: last.cliMode,
    cliModel: last.cliModel,
    cliEffort: last.cliEffort,
    taskId: source.associatedTaskId,
    pullRequestUrl: source.attachedPullRequest ? attachedPullRequestUrl(source.attachedPullRequest) : undefined,
    agentWorkSource: "manual_attachment",
  });
  // A fork of a fork has no earlier assistant of its own; its seed is the source's seed.
  const { continuationId, resumable } = await scanStrandedTail(ctx, source._id, reply.createdAt);
  const seedTurnId = continuationId !== null ? resumable?.turnId : source.forkedFrom?.turnId;
  // A Codex seed without a turn cannot be forked; the fork starts fresh after edit-last instead.
  const seed = source.cliType === "codex" && seedTurnId === undefined
    ? undefined
    : (continuationId ?? source.forkedFrom?.continuationId);

  const parentThreadId = groupWith ? await resolveGroupContainer(ctx, access.user._id, groupWith) : undefined;
  const now = Date.now();
  const forkId = await insertCliThread(
    ctx,
    {
      ...insert,
      parentThreadId,
      // The parent's binding and snapshot as they are, not the agent's current state.
      projectAgentId: source.projectAgentId,
      agentPromptSnapshot: source.agentPromptSnapshot,
      // Two tabs with one label would be indistinguishable (OS-1559).
      title: groupWith ? deriveForkTabTitle(source.title) : source.title,
      awaitsFirstMessage: true,
      forkedFrom: {
        threadId: source._id,
        runStart: { messageId: runStart._id, createdAt: runStart.createdAt },
        reply: { messageId: reply._id, createdAt: reply.createdAt },
        runId,
        continuationId: seed,
        turnId: seedTurnId,
      },
    },
    now
  );

  // One millisecond apart so the transcript keeps the run's order: prompts, then the reply.
  const messageIdMap: Record<Id<"cliMessages">, Id<"cliMessages">> = {};
  let copiesInFlight = 0;
  for (const [index, message] of users.entries()) {
    const stamp = now + index;
    const copyId = await insertCliMessage(ctx, toForkedMessageInsert(message, forkId, stamp));
    messageIdMap[message._id] = copyId;
    copiesInFlight += Number(await copyMessageChunkRows(ctx, {
      source: { threadId: source._id, messageId: message._id },
      target: { threadId: forkId, messageId: copyId, profileId: message.profileId },
      afterChunkOrder: -1,
      createdAt: stamp,
    }));
    for (const attachment of message.attachments ?? []) {
      await insertAttachmentRef(ctx, { messageId: copyId, threadId: forkId, storageId: attachment.storageId, role: message.role }, now);
    }
  }
  const replyStamp = now + users.length;
  const replyCopyId = await insertCliMessage(ctx, toForkedMessageInsert(reply, forkId, replyStamp));
  copiesInFlight += Number(await copyMessageChunkRows(ctx, {
    source: { threadId: source._id, messageId: reply._id },
    target: { threadId: forkId, messageId: replyCopyId, profileId: reply.profileId },
    afterChunkOrder: -1,
    createdAt: replyStamp,
    messageIdMap,
  }));
  for (const attachment of reply.attachments ?? []) {
    await insertAttachmentRef(ctx, { messageId: replyCopyId, threadId: forkId, storageId: attachment.storageId, role: reply.role }, now);
  }
  if (copiesInFlight > 0) {
    const fork = await getThreadById(ctx, forkId);
    if (fork) await addForkCopiesInFlight(ctx, fork, copiesInFlight);
  }

  return { threadId: forkId, containerId: parentThreadId };
}
