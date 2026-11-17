import { v, type Infer } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";
import { taskSummaryValidator, type TaskSummary } from "../../../lib/contracts/taskSummaries";
import { attachedPullRequestValidator } from "../../../lib/contracts/github";
import {
  type CliThreadWatchStatus,
  cliTypeValidator,
  cliEffortValidator,
  cliModelValidator,
  cliThreadStatusValidator,
  cliThreadProcessingStateValidator,
  cliThreadKindValidator,
  cliThreadAggregateStatusValidator,
  cliMessageAttachmentInputValidator,
  cliThreadWorktreeSpecValidator,
  cliThreadWorktreeValidator,
  cliThreadPullRequestValidator,
  cliThreadForkedFromValidator,
} from "../../../lib/contracts/validators";
import { slashCommandComposerDocumentValidator } from "../../../lib/contracts/slashCommands";
import { agentThreadWorkSourceValidator } from "../../../lib/contracts/agentThreadWork";
import { cliThreadAgentValidator, type CliThreadAgent } from "../../lib/validators";

/**
 * The bound run's workflow identity (OS-1875), list-enriched: tints and labels
 * the run row's glyph and links it to the workflow editor.
 */
export const cliThreadWorkflowValidator = v.object({
  _id: v.id("workflows"),
  name: v.string(),
  color: v.optional(v.string()),
});

export type CliThreadWorkflow = Infer<typeof cliThreadWorkflowValidator>;

/** Return validator for a single chat item, shared by `core.get` and the list queries. */
export const cliThreadItemValidator = v.object({
  _id: v.id("cliThreads"),
  userId: v.id("users"),
  projectId: v.id("projects"),
  profileId: v.id("cliProfiles"),
  pathId: v.string(),
  pathLabel: v.string(),
  pathString: v.string(),
  branch: v.optional(v.string()),
  cliType: cliTypeValidator,
  title: v.string(),
  status: cliThreadStatusValidator,
  // Mid-run approval/question parked on the thread; the list UI renders
  // streaming/pending + pending interaction as "waiting for input".
  hasPendingInteraction: v.boolean(),
  processingState: cliThreadProcessingStateValidator,
  hasPendingUserMessages: v.boolean(),
  // Queue held after a Stop (OS-1374): messages stay queued but the CLI
  // won't pick them up until the user's next send.
  queueHeldAt: v.optional(v.number()),
  claimedBySessionId: v.optional(v.id("cliSessions")),
  claimedAt: v.optional(v.number()),
  claimLeaseExpiresAt: v.optional(v.number()),
  activeAssistantMessageId: v.optional(v.id("cliMessages")),
  linesAdded: v.optional(v.number()),
  linesRemoved: v.optional(v.number()),
  // Last-known PR snapshot for the thread's branch (OS-1370).
  pullRequest: v.optional(cliThreadPullRequestValidator),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
  lastActivityAt: v.number(),
  isDeleted: v.boolean(),
  isPinned: v.boolean(),
  pinnedAt: v.optional(v.number()),
  // Set while the thread is shared read-only with project teammates (OS-1574).
  sharedAt: v.optional(v.number()),
  // Container fields (OS-1364): set only on group/workflowRun rows. The list card
  // has no consumer for `childCount`/`aggregateStatus` (projected into `status`
  // server-side) — they're for the tabs view / run navigator, don't wire cards to them.
  kind: v.optional(cliThreadKindValidator),
  // Set on group children; the detail route uses it to resolve
  // the container for the tabs view and sidebar highlight (OS-1477).
  parentThreadId: v.optional(v.id("cliThreads")),
  // Set on a Workflow run's container and its lane threads (OS-1366): gates
  // group-only actions (share, move out) and resolves the Run view.
  workflowRunId: v.optional(v.id("workflowRuns")),
  childCount: v.optional(v.number()),
  aggregateStatus: v.optional(cliThreadAggregateStatusValidator),
  worktree: v.optional(cliThreadWorktreeValidator),
  // Set on forked threads (OS-1397); drives the history above and the "Forked from" divider.
  forkedFrom: v.optional(cliThreadForkedFromValidator),
  // Enriched fields
  profileName: v.string(),
  gitRemoteUrl: v.optional(v.string()),
  hasUnread: v.boolean(),
  requiresAttention: v.boolean(),
  // Explicitly marked done after the latest activity (OS-1382).
  isDone: v.boolean(),
  associatedTask: v.optional(taskSummaryValidator),
  attachedPullRequest: v.optional(attachedPullRequestValidator),
  // Resolved Project agent binding display (OS-1138); deleted agents fail
  // soft to the placeholder inside the resolver.
  agent: v.optional(cliThreadAgentValidator),
  workflow: v.optional(cliThreadWorkflowValidator),
});

/** Watch Tower exposes only summary fields; execution details stay owner-only. */
export const watchTowerThreadItemValidator = v.object({
  _id: cliThreadItemValidator.fields._id,
  title: v.string(),
  cliType: cliTypeValidator,
  status: cliThreadStatusValidator,
  processingState: cliThreadProcessingStateValidator,
  hasPendingInteraction: v.boolean(),
  lastActivityAt: v.number(),
  hasUnread: v.boolean(),
  requiresAttention: v.boolean(),
  isDone: v.boolean(),
  kind: cliThreadItemValidator.fields.kind,
  workflowRunId: cliThreadItemValidator.fields.workflowRunId,
  childCount: cliThreadItemValidator.fields.childCount,
  branch: cliThreadItemValidator.fields.branch,
  linesAdded: cliThreadItemValidator.fields.linesAdded,
  linesRemoved: cliThreadItemValidator.fields.linesRemoved,
  pullRequest: cliThreadItemValidator.fields.pullRequest,
  associatedTask: cliThreadItemValidator.fields.associatedTask,
  agent: cliThreadItemValidator.fields.agent,
  workflow: cliThreadItemValidator.fields.workflow,
  isOwner: v.boolean(),
  ownerName: v.optional(v.string()),
  location: v.object({ projectAlias: v.string(), projectName: v.string() }),
});

export type WatchTowerThreadItem = Infer<typeof watchTowerThreadItemValidator>;

const WATCH_TOWER_ITEM_STATUS: Record<CliThreadWatchStatus, Doc<"cliThreads">["status"]> = {
  running: "streaming",
  waiting_input: "waiting_input",
  failed: "failed",
  needs_review: "completed",
  done: "completed",
};

export function toWatchTowerThreadItem(
  thread: Doc<"cliThreads">,
  location: WatchTowerThreadItem["location"],
  section: CliThreadWatchStatus,
  ownItem?: Infer<typeof cliThreadItemValidator>,
  ownerName?: string,
): WatchTowerThreadItem {
  const containerStatus = WATCH_TOWER_ITEM_STATUS[section];
  return {
    _id: thread._id,
    title: thread.title,
    cliType: thread.cliType,
    status: thread.kind === undefined ? thread.status : containerStatus,
    processingState: thread.processingState,
    hasPendingInteraction: thread.hasPendingInteraction ?? false,
    lastActivityAt: thread.lastActivityAt,
    hasUnread: ownItem?.hasUnread ?? false,
    requiresAttention: section === "failed" || section === "waiting_input",
    isDone: thread.kind === undefined ? ownItem?.isDone ?? section === "done" : section === "done",
    kind: thread.kind,
    workflowRunId: thread.workflowRunId,
    childCount: thread.childCount,
    isOwner: ownItem !== undefined,
    location,
    ...(ownerName !== undefined ? { ownerName } : {}),
    ...(ownItem ? {
      branch: ownItem.branch,
      linesAdded: ownItem.linesAdded,
      linesRemoved: ownItem.linesRemoved,
      pullRequest: ownItem.pullRequest,
      associatedTask: ownItem.associatedTask,
      agent: ownItem.agent,
      workflow: ownItem.workflow,
    } : {}),
  };
}

/** Pick only the fields the validator expects (strips _creationTime etc.) */
export function toThreadItem(
  chat: Doc<"cliThreads">,
  extra: {
    profileName: string;
    pathLabel: string;
    pathString: string;
    gitRemoteUrl?: string;
    branch?: string;
    /** Explicit per-caller: the list projects container status, `get` passes the raw one. */
    status: Doc<"cliThreads">["status"];
    hasUnread: boolean;
    requiresAttention: boolean;
    isDone: boolean;
    associatedTask?: TaskSummary;
    agent?: CliThreadAgent;
    workflow?: CliThreadWorkflow;
  }
) {
  return {
    _id: chat._id,
    userId: chat.userId,
    projectId: chat.projectId,
    profileId: chat.profileId,
    pathId: chat.pathId,
    pathLabel: extra.pathLabel,
    pathString: extra.pathString,
    branch: extra.branch,
    cliType: chat.cliType,
    title: chat.title,
    status: extra.status,
    hasPendingInteraction: chat.hasPendingInteraction ?? false,
    processingState: chat.processingState,
    hasPendingUserMessages: chat.hasPendingUserMessages,
    queueHeldAt: chat.queueHeldAt,
    claimedBySessionId: chat.claimedBySessionId,
    claimedAt: chat.claimedAt,
    claimLeaseExpiresAt: chat.claimLeaseExpiresAt,
    activeAssistantMessageId: chat.activeAssistantMessageId,
    linesAdded: chat.git?.linesAdded,
    linesRemoved: chat.git?.linesRemoved,
    pullRequest: chat.git?.pullRequest,
    attachedPullRequest: chat.attachedPullRequest,
    readAt: chat.readAt,
    createdAt: chat.createdAt,
    lastActivityAt: chat.lastActivityAt,
    isDeleted: chat.isDeleted,
    isPinned: chat.isPinned ?? false,
    pinnedAt: chat.pinnedAt,
    sharedAt: chat.sharedAt,
    kind: chat.kind,
    parentThreadId: chat.parentThreadId,
    workflowRunId: chat.workflowRunId,
    childCount: chat.childCount,
    aggregateStatus: chat.aggregateStatus,
    worktree: chat.git?.worktree,
    forkedFrom: chat.forkedFrom,
    profileName: extra.profileName,
    gitRemoteUrl: extra.gitRemoteUrl,
    hasUnread: extra.hasUnread,
    requiresAttention: extra.requiresAttention,
    isDone: extra.isDone,
    ...(extra.associatedTask ? { associatedTask: extra.associatedTask } : {}),
    ...(extra.agent ? { agent: extra.agent } : {}),
    ...(extra.workflow ? { workflow: extra.workflow } : {}),
  };
}

/** A new thread's selection — everything but its first message. Alone, it births an empty workflow lane thread (OS-1920). */
export const threadSelectionArgs = {
  profileId: v.id("cliProfiles"),
  pathId: v.string(),
  /** Display hint from the local checkout scan; the first execution report replaces or clears it. */
  initialBranch: v.optional(v.string()),
  cliType: cliTypeValidator,
  cliMode: v.optional(v.string()),
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  taskId: v.optional(v.id("tasks")),
  // How the task attachment was initiated (assignment automation vs manual);
  // recorded on the task's agentThreadWork entry. Only meaningful with taskId.
  agentWorkSource: v.optional(agentThreadWorkSourceValidator),
  /** A github.com PR URL: the message's and thread's Attached pull request. */
  pullRequestUrl: v.optional(v.string()),
  /** Run the project's Pull request checks on that PR at this head, which must still be its stored one (OS-2400). */
  pullRequestChecks: v.optional(v.object({ headSha: v.string() })),
  // Immutable Project agent binding (OS-1138). The agent's prompt is
  // snapshotted onto the thread at creation; no update path exists.
  projectAgentId: v.optional(v.id("projectAgents")),
  title: v.optional(v.string()),
  worktree: v.optional(cliThreadWorktreeSpecValidator),
};

/** Args shared by `core.create` and `groups.addThreadToGroup` (both spread extras on top). */
export const createThreadArgs = {
  ...threadSelectionArgs,
  content: v.string(),
  composerDocument: v.optional(slashCommandComposerDocumentValidator),
  // Open the thread on the target runtime's own command ("/security-review"),
  // delivered raw instead of as prose. Spec: `docs/specs/cli-runtime-commands.md`.
  runtimeCommand: v.optional(v.boolean()),
  attachments: v.optional(v.array(cliMessageAttachmentInputValidator)),
  /** Write a Guide of the attached PR at this head, which must still be its stored one (OS-2412). */
  pullRequestGuide: v.optional(v.object({ headSha: v.string() })),
};
