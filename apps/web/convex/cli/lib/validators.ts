import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import {
  cliThreadWorktreeValidator,
  cliMessageSentByValidator,
  cliMessageStatusValidator,
  cliTypeValidator,
  cliThreadStatusValidator,
  cliThreadProcessingStateValidator,
  cliThreadKindValidator,
  cliThreadAggregateStatusValidator,
  cliCatalogModelValidator,
} from "../../lib/contracts/validators";
import { resolvePathInfo } from "./paths";
import { attachedPullRequestValidator } from "../../lib/contracts/github";
import { isThreadDone } from "./watchStatus";

/**
 * The `cli` domain's shared shapes: each `v.object`, its `Infer`-ed type, and its
 * `to*` projection, kept out of the loaders so importing a type pulls in no repo.
 *
 * The summary tier (threads and messages) is specified in
 * `docs/specs/mcp-server.md` under "The summary tier", which is authoritative;
 * the loaders live in `threadSummaries.ts` / `messageSummaries.ts`.
 */

/** What the next run resumes; `forkTurnId` when Codex must fork another thread's session (OS-2073). */
export const cliResumeHandleValidator = v.object({
  continuationId: v.string(),
  forkTurnId: v.optional(v.string()),
});
export type CliResumeHandle = Infer<typeof cliResumeHandleValidator>;

export const cliWorkspaceNoticeValidator = v.object({
  previousPath: v.string(),
  path: v.string(),
});
export type CliWorkspaceNotice = Infer<typeof cliWorkspaceNoticeValidator>;

export const cliExecutionWorkspaceValidator = v.object({
  pathId: v.string(),
  path: v.string(),
  worktree: v.optional(cliThreadWorktreeValidator),
  previousPath: v.optional(v.string()),
});
export type CliExecutionWorkspace = Infer<typeof cliExecutionWorkspaceValidator>;

/** Preserve parent snapshots after discovery prunes a worktree. Spec: cli-worktrees.md. */
export function toExecutionWorkspace(
  thread: Doc<"cliThreads">,
  profile: Doc<"cliProfiles">,
): CliExecutionWorkspace {
  const entry = profile.paths.find((path) => path.id === thread.pathId);
  const worktree = thread.git?.worktree ?? (entry?.kind === "worktree" && entry.parentPathId && entry.branch
    ? { parentPathId: entry.parentPathId, branch: entry.branch, status: "created" as const }
    : undefined);
  const parent = profile.paths.find((path) => path.id === worktree?.parentPathId && path.kind !== "worktree");
  return {
    pathId: thread.pathId,
    path: entry?.path ?? thread.path,
    worktree: worktree ? {
      ...worktree,
      parentPath: worktree.parentPath ?? parent?.path,
      parentGitRemoteUrl: worktree.parentGitRemoteUrl ?? parent?.gitRemoteUrl,
    } : undefined,
    previousPath: thread.git?.previousWorkingDirectory,
  };
}

/**
 * Two disjoint field sets discriminated by `kind`: a container has no transcript
 * and no runtime target, so every thread-only field is absent — a field is absent
 * for exactly one reason. Inventing a target would invite a caller to send it a
 * message, which the domain rejects.
 *
 * One validator, not a narrower list variant, so `targetOnline: undefined` can't
 * mean "not a thread" from one query and "we didn't look" from the other.
 */
export const cliThreadSummaryValidator = v.object({
  threadId: v.id("cliThreads"),
  // Both branches carry it: `--attach` uploads authorize on a project, and a
  // thread's own is the only right one (OS-1634).
  projectId: v.id("projects"),
  title: v.string(),
  isDone: v.boolean(),
  createdAt: v.number(),
  lastActivityAt: v.number(),
  associatedTaskId: v.optional(v.id("tasks")),
  // Service pages resolve the reference; other summary readers omit it.
  associatedTaskRef: v.optional(v.string()),
  attachedPullRequest: v.optional(attachedPullRequestValidator),
  // The thread whose agent spawned this one, and the container it belongs to.
  // `parentThreadId` lets an agent drill from a child up to its group; the
  // members come from `list_threads(containerId)`, not from here.
  spawnedByThreadId: v.optional(v.id("cliThreads")),
  parentThreadId: v.optional(v.id("cliThreads")),
  // Container-only, all read straight off the container doc — no group scan.
  kind: v.optional(cliThreadKindValidator),
  childCount: v.optional(v.number()),
  aggregateStatus: v.optional(cliThreadAggregateStatusValidator),
  originThreadId: v.optional(v.id("cliThreads")),
  // Identifies a workflow container, including before it has lane threads.
  workflowRunId: v.optional(v.id("workflowRuns")),
  // Thread-only: the runtime target, what its queue is doing, and `status` —
  // which a container omits.
  status: v.optional(cliThreadStatusValidator),
  profileId: v.optional(v.id("cliProfiles")),
  pathId: v.optional(v.string()),
  path: v.optional(v.string()),
  cliType: v.optional(cliTypeValidator),
  processingState: v.optional(cliThreadProcessingStateValidator),
  hasPendingUserMessages: v.optional(v.boolean()),
  hasPendingInteraction: v.optional(v.boolean()),
  queueHeldAt: v.optional(v.number()),
  profileName: v.optional(v.string()),
  // Whether the target machine has a live session right now. Informational: a
  // thread on an offline target stays pending until that CLI connects.
  targetOnline: v.optional(v.boolean()),
  lastHeartbeatAt: v.optional(v.number()),
});

export type CliThreadSummary = Infer<typeof cliThreadSummaryValidator>;

/** The fields both branches carry, container or not. */
function threadSummaryShared(thread: Doc<"cliThreads">) {
  return {
    threadId: thread._id,
    projectId: thread.projectId,
    title: thread.title,
    isDone: isThreadDone(thread),
    createdAt: thread.createdAt,
    lastActivityAt: thread.lastActivityAt,
    associatedTaskId: thread.associatedTaskId,
    attachedPullRequest: thread.attachedPullRequest,
    spawnedByThreadId: thread.spawnedByThreadId,
  };
}

/**
 * A container's summary: group metadata, and none of the target tuple.
 *
 * `aggregateStatus` goes out **raw**, never through `containerItemStatus`. And no
 * `status`: a container's is a stored constant, so emitting it would put a
 * permanent `"completed"` beside an `aggregateStatus` of `"running"`.
 */
export function toContainerSummary(thread: Doc<"cliThreads">): CliThreadSummary {
  return {
    ...threadSummaryShared(thread),
    kind: thread.kind,
    childCount: thread.childCount,
    aggregateStatus: thread.aggregateStatus,
    originThreadId: thread.originThreadId,
    workflowRunId: thread.workflowRunId,
  };
}

/**
 * An ordinary thread's summary: `status`, the runtime target, and queue state.
 *
 * The caller resolves `profile` and `session` — one at a time or batched — because
 * how they load is a cost decision and this only owns the shape. A missing profile
 * still yields a row via the thread's path snapshot.
 */
export function toThreadSummary(
  thread: Doc<"cliThreads">,
  profile: Doc<"cliProfiles"> | null,
  session: Doc<"cliSessions"> | null
): CliThreadSummary {
  const { pathString } = resolvePathInfo(thread, profile);
  return {
    ...threadSummaryShared(thread),
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    profileId: thread.profileId,
    pathId: thread.pathId,
    path: pathString,
    cliType: thread.cliType,
    processingState: thread.processingState,
    hasPendingUserMessages: thread.hasPendingUserMessages,
    hasPendingInteraction: thread.hasPendingInteraction ?? false,
    queueHeldAt: thread.queueHeldAt,
    profileName: profile?.name ?? "Unknown",
    targetOnline: session !== null,
    lastHeartbeatAt: session?.lastHeartbeatAt,
  };
}

/**
 * One validator, not one per role: a role variant would make `errorMessage:
 * undefined` mean "not an assistant" in one row and "ran clean" in another.
 */
export const cliMessageSummaryValidator = v.object({
  messageId: v.id("cliMessages"),
  role: v.union(v.literal("user"), v.literal("assistant")),
  // A user message is `completed` the moment it is stored — its status describes
  // the row, not a run. `streaming` on an assistant row means the text below is
  // whatever had arrived when the read ran.
  status: cliMessageStatusValidator,
  createdAt: v.number(),
  /** Composed from `text` chunks only — see `messages/agentText.ts`. */
  text: v.string(),
  /** Text was cut by a cap. Absent means the whole message is here. */
  truncated: v.optional(v.boolean()),
  // Present when another thread's agent queued this message rather than a human
  // (OS-1621). Absent is the pre-existing meaning: a person typed it.
  sentBy: v.optional(cliMessageSentByValidator),
  // Assistant-only in practice, though not by type: `fail` records the CLI's
  // reason on the message it was running.
  errorMessage: v.optional(v.string()),
});

export type CliMessageSummary = Infer<typeof cliMessageSummaryValidator>;

/** Shape one message around its already-composed text (shaping is not loading). */
export function toMessageSummary(
  message: Doc<"cliMessages">,
  text: { text: string; truncated: boolean }
): CliMessageSummary {
  return {
    messageId: message._id,
    role: message.role,
    status: message.status,
    createdAt: message.createdAt,
    text: text.text,
    // Direct assignment for every optional, as in the thread summary above —
    // Convex drops `undefined` fields, so mixing styles would imply a difference.
    truncated: text.truncated ? true : undefined,
    sentBy: message.sentBy,
    errorMessage: message.errorMessage,
  };
}

/**
 * One profile's stored model catalog for one runtime (OS-1721). Read per profile by
 * the surfaces that offer models — see `docs/specs/cli-opencode-runtime.md`.
 */
export const cliRuntimeCatalogValidator = v.object({
  profileId: v.id("cliProfiles"),
  cliType: cliTypeValidator,
  models: v.array(cliCatalogModelValidator),
});

export type CliRuntimeCatalog = Infer<typeof cliRuntimeCatalogValidator>;

export function toRuntimeCatalog(catalog: Doc<"cliRuntimeCatalogs">): CliRuntimeCatalog {
  return {
    profileId: catalog.profileId,
    cliType: catalog.cliType,
    models: catalog.models,
  };
}

/**
 * Resolved display for a thread's immutable Project agent binding (OS-1138).
 * Agents that no longer resolve fail soft to the deleted-agent placeholder;
 * resolution itself lives in `threadAgents.ts`.
 */
export const cliThreadAgentValidator = v.object({
  projectAgentId: v.id("projectAgents"),
  name: v.string(),
  color: v.string(),
  isDeleted: v.boolean(),
});

export type CliThreadAgent = Infer<typeof cliThreadAgentValidator>;

const DELETED_THREAD_AGENT_NAME = "Deleted agent";
const DELETED_THREAD_AGENT_COLOR = AGENT_COLOR_PALETTE[0];

/** Shape one binding; a null or soft-deleted agent yields the placeholder. */
export function toThreadAgent(
  projectAgentId: Id<"projectAgents">,
  projectAgent: Doc<"projectAgents"> | null
): CliThreadAgent {
  const active = projectAgent !== null && !projectAgent.isDeleted;
  return {
    projectAgentId,
    name: active ? projectAgent.name : DELETED_THREAD_AGENT_NAME,
    color: active ? projectAgent.appearance.color : DELETED_THREAD_AGENT_COLOR,
    isDeleted: !active,
  };
}

export const serviceRunValidator = v.object({
  messageId: v.id("cliMessages"), threadId: v.id("cliThreads"), runId: v.optional(v.string()),
  status: cliMessageStatusValidator, createdAt: v.number(), updatedAt: v.number(),
});
export type ServiceRun = Infer<typeof serviceRunValidator>;
export function toServiceRun(message: Doc<"cliMessages">): ServiceRun {
  return { messageId: message._id, threadId: message.threadId, runId: message.runId,
    status: message.status, createdAt: message.createdAt, updatedAt: message.updatedAt };
}
