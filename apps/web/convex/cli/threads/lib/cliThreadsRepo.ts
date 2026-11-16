import { makeFunctionReference, type PaginationOptions, type PaginationResult } from "convex/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { AgentThreadWorkSource } from "../../../lib/contracts/agentThreadWork";
import type { AttachedPullRequest } from "../../../lib/contracts/github";
import type { CodexUsageCursor } from "../../../lib/contracts/costUsage";
import type {
  CliThreadMetadata,
  CliThreadAggregateStatus,
  CliThreadForkedFrom,
  CliThreadPullRequest,
  CliThreadWatchStatus,
} from "../../../lib/contracts/validators";
import { getProjectAgentById } from "../../../agents/lib/projectAgentsRepo";
import { PINNED_THREADS_MAX, TASK_THREADS_MAX } from "../../../../lib/threads/constants";
import { syncAgentThreadWorkById } from "./agentThreadWork";
import { deleteCheckResultsOwnedByThread, moveThreadCheckResultsToTask } from "../../../checks/lib/checkResultsRepo";
import { mergeLastUsedCli, type CliMessageSelection } from "../../lib/lastUsedCli";
import { CLI_RUNTIME_LABELS } from "../../lib/runtimes/registry";
import {
  deriveContainerAggregateStatus,
  deriveContainerWatchStatus,
  WATCH_STATUS_RANK,
  deriveThreadStatusProjection,
  hasUnreadThreadActivity,
  isContainerThread,
  isThreadDone,
  requiresThreadAttention,
  threadExecutionBranch,
  threadNeedsReadPatch,
} from "../../lib/watchStatus";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for the `cliThreads` table — no caller touches `ctx.db` directly.
 * Writes are intent-named, stamp `lastActivityAt`, and mirror task association,
 * status, title and delete state into the task's denormalized `agentThreadWork`
 * summary (OS-1094).
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A single thread by id, or null when it no longer exists. */
export async function getThreadById(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliThreads"> | null> {
  return ctx.db.get("cliThreads", threadId);
}

/** Batch-get threads by id; ids that no longer resolve are dropped. */
export async function getThreadsByIds(ctx: Ctx, threadIds: Id<"cliThreads">[]): Promise<Doc<"cliThreads">[]> {
  const docs = await Promise.all(threadIds.map((threadId) => ctx.db.get("cliThreads", threadId)));
  return docs.filter((doc): doc is Doc<"cliThreads"> => doc !== null);
}

/** Batch-get the given user's live (not soft-deleted) threads; other ids are dropped. */
export async function getOwnedThreadsByIds(ctx: Ctx, userId: Id<"users">, threadIds: Id<"cliThreads">[]): Promise<Doc<"cliThreads">[]> {
  const docs = await getThreadsByIds(ctx, threadIds);
  return docs.filter((doc) => !doc.isDeleted && doc.userId === userId);
}

/** Parse an untrusted string into a `cliThreads` id, or null when it is not one. */
export function normalizeThreadId(ctx: Ctx, raw: string): Id<"cliThreads"> | null {
  return ctx.db.normalizeId("cliThreads", raw);
}

/**
 * Display label for the thread's acting agent: the bound Project agent's
 * name, else the runtime label ("Claude Code", ...). The cli domain's public
 * answer to "who is working this thread" — used by the notifications fan-out
 * for thread lifecycle snapshots (OS-1243).
 */
export async function getThreadActorLabel(ctx: Ctx, thread: Doc<"cliThreads">): Promise<string> {
  const agent = thread.projectAgentId ? await getProjectAgentById(ctx, thread.projectAgentId) : null;
  return agent && !agent.isDeleted ? agent.name : CLI_RUNTIME_LABELS[thread.cliType];
}

type ThreadSortBy = "created" | "lastActivity";

type ProjectThreadsPageArgs = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  sortBy: ThreadSortBy;
  /** Restrict to done / not-done threads (the list's sections, OS-1451); omitted = one ungrouped list. */
  isDone?: boolean;
  paginationOpts: { cursor: string | null; numItems: number };
};

/**
 * A page of a user's non-deleted threads in a project, newest first. `isDone`
 * splits the list on parallel indexes. Container children are excluded — the
 * flat list shows containers and plain threads only.
 */
export async function paginateProjectThreads(ctx: Ctx, args: ProjectThreadsPageArgs): Promise<PaginationResult<Doc<"cliThreads">>> {
  const isDone = args.isDone;
  if (isDone !== undefined) {
    return ctx.db
      .query("cliThreads")
      .withIndex(
        args.sortBy === "created"
          ? "by_user_project_deleted_isDone_parent_createdAt"
          : "by_user_project_deleted_isDone_parent_lastActivity",
        (q) =>
          q
            .eq("userId", args.userId)
            .eq("projectId", args.projectId)
            .eq("isDeleted", false)
            .eq("statusProjection.isDone", isDone)
            .eq("parentThreadId", undefined)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  }

  return ctx.db
    .query("cliThreads")
    .withIndex(
      args.sortBy === "created" ? "by_user_project_deleted_parent_createdAt" : "by_user_project_deleted_parent_lastActivity",
      (q) => q.eq("userId", args.userId).eq("projectId", args.projectId).eq("isDeleted", false).eq("parentThreadId", undefined)
    )
    .order("desc")
    .paginate(args.paginationOpts);
}

type UserThreadsPageArgs = {
  userId: Id<"users">;
  watchStatus: CliThreadWatchStatus;
  paginationOpts: { cursor: string | null; numItems: number };
};

/** Standalone threads and containers in one Watch Tower section. */
export async function paginateUserThreadsByWatchStatus(ctx: Ctx, args: UserThreadsPageArgs): Promise<PaginationResult<Doc<"cliThreads">>> {
  return ctx.db.query("cliThreads")
    .withIndex("by_user_deleted_parent_watchTowerStatus_lastActivity", (q) =>
      q.eq("userId", args.userId).eq("isDeleted", false).eq("parentThreadId", undefined).eq("statusProjection.watchTowerStatus", args.watchStatus)
    )
    .order("desc")
    .paginate(args.paginationOpts);
}

/** Direct pagination for one project's section, optionally restricted to its owner. */
export async function paginateProjectThreadsByWatchStatus(
  ctx: Ctx,
  args: Omit<UserThreadsPageArgs, "userId"> & { projectId: Id<"projects">; userId?: Id<"users"> },
): Promise<PaginationResult<Doc<"cliThreads">>> {
  const { userId } = args;
  const query = userId !== undefined
    ? ctx.db.query("cliThreads").withIndex("by_user_project_deleted_parent_watchTowerStatus_lastActivity", (q) =>
      q.eq("userId", userId).eq("projectId", args.projectId).eq("isDeleted", false)
        .eq("parentThreadId", undefined).eq("statusProjection.watchTowerStatus", args.watchStatus))
    : ctx.db.query("cliThreads").withIndex("by_project_deleted_parent_watchTowerStatus_lastActivity", (q) =>
      q.eq("projectId", args.projectId).eq("isDeleted", false)
        .eq("parentThreadId", undefined).eq("statusProjection.watchTowerStatus", args.watchStatus));
  return query.order("desc").paginate(args.paginationOpts);
}

/**
 * A user's non-deleted threads associated with a task, newest activity first.
 * Bounded by `TASK_THREADS_MAX`: no caller paginates and nothing caps threads per
 * task on write, so the read carries the ceiling for all of them (OS-636).
 */
export async function listThreadsByAssociatedTask(
  ctx: Ctx,
  args: { userId: Id<"users">; projectId: Id<"projects">; taskId: Id<"tasks"> }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_project_task_deleted_lastActivity", (q) =>
      q.eq("userId", args.userId).eq("projectId", args.projectId).eq("associatedTaskId", args.taskId).eq("isDeleted", false)
    )
    .order("desc")
    .take(TASK_THREADS_MAX);
}

/** A project's threads attached to one PR (`AttachedPullRequest.ref`), newest activity first. Every owner's: callers filter by visibility. */
export async function listThreadsByAttachedPullRequest(
  ctx: Ctx,
  args: { projectId: Id<"projects">; ref: string }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_project_attachedPullRequestRef_deleted_lastActivity", (q) =>
      q.eq("projectId", args.projectId).eq("attachedPullRequest.ref", args.ref).eq("isDeleted", false)
    )
    .order("desc")
    .take(TASK_THREADS_MAX);
}

/**
 * The CLI worker's claim queue: threads with pending user messages, oldest
 * first. Held threads wait for the user's next send (OS-1374); containers must
 * never reach a worker (OS-1556). Both filtered in memory — the set is small.
 */
export async function listPendingThreadsByProfile(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliThreads">[]> {
  const threads = await ctx.db
    .query("cliThreads")
    .withIndex("by_profile_pending_deleted_lastActivityAt", (q) =>
      q.eq("profileId", profileId).eq("hasPendingUserMessages", true).eq("isDeleted", false)
    )
    .order("asc")
    .collect();
  return threads.filter((thread) => thread.queueHeldAt === undefined && !isContainerThread(thread));
}

/**
 * A user's non-deleted threads in the given processing state, newest activity
 * first, capped — the desktop popover's "active" feed (OS-1237).
 */
export async function listUserThreadsByProcessingState(
  ctx: Ctx,
  args: { userId: Id<"users">; processingState: "claimed" | "streaming"; limit: number }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_processing_deleted_lastActivity", (q) =>
      q.eq("userId", args.userId).eq("processingState", args.processingState).eq("isDeleted", false)
    )
    .order("desc")
    .take(args.limit);
}

/**
 * A user's non-deleted threads with queued user messages (claimed or not),
 * newest activity first, capped. Callers dedupe against the processing-state
 * reads; the remainder is "queued, waiting for an agent" (OS-1237).
 */
export async function listUserThreadsWithPendingMessages(
  ctx: Ctx,
  args: { userId: Id<"users">; limit: number }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_pending_deleted_lastActivity", (q) =>
      q.eq("userId", args.userId).eq("hasPendingUserMessages", true).eq("isDeleted", false)
    )
    .order("desc")
    .take(args.limit);
}

/**
 * Attention-bucket threads for the desktop feed (OS-1237): idle with no pending
 * messages but still needing the user. `since` keeps months of unacknowledged
 * failures out of a "happening now" surface. Containers excluded.
 */
export async function listUserThreadsByWatchStatus(
  ctx: Ctx,
  args: { userId: Id<"users">; watchStatus: CliThreadWatchStatus; since: number; limit: number }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_deleted_kind_watchTowerStatus_lastActivity", (q) =>
      q
        .eq("userId", args.userId)
        .eq("isDeleted", false)
        .eq("kind", undefined)
        .eq("statusProjection.watchTowerStatus", args.watchStatus)
        .gte("lastActivityAt", args.since)
    )
    .order("desc")
    .take(args.limit);
}

/**
 * A user's pinned, non-deleted threads in a project, most recently pinned
 * first (OS-1173). Bounded by `PINNED_THREADS_MAX`: pins are user-curated and
 * few.
 */
export async function listPinnedProjectThreads(
  ctx: Ctx,
  args: { userId: Id<"users">; projectId: Id<"projects"> }
): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_project_deleted_pinned_pinnedAt", (q) =>
      q.eq("userId", args.userId).eq("projectId", args.projectId).eq("isDeleted", false).eq("isPinned", true)
    )
    .order("desc")
    .take(PINNED_THREADS_MAX);
}

/**
 * A page of a user's shared, non-deleted threads in a project, most recently
 * shared first (OS-1576). `gt("sharedAt", 0)` is the "is shared" test: Convex
 * sorts an unset optional field before every number, so the range drops
 * unshared rows without a post-filter.
 */
export async function paginateSharedProjectThreads(
  ctx: Ctx,
  args: { userId: Id<"users">; projectId: Id<"projects">; paginationOpts: PaginationOptions }
): Promise<PaginationResult<Doc<"cliThreads">>> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_user_project_deleted_sharedAt", (q) =>
      q.eq("userId", args.userId).eq("projectId", args.projectId).eq("isDeleted", false).gt("sharedAt", 0)
    )
    .order("desc")
    .paginate(args.paginationOpts);
}

/**
 * A workflow run's container row (OS-1366): among the run's few threads
 * (container + lane threads), the one with `kind` set.
 */
export async function getWorkflowRunContainer(ctx: Ctx, runId: Id<"workflowRuns">): Promise<Doc<"cliThreads"> | null> {
  const rows = await ctx.db
    .query("cliThreads")
    .withIndex("by_workflowRunId", (q) => q.eq("workflowRunId", runId))
    .collect();
  return rows.find((row) => isContainerThread(row) && !row.isDeleted) ?? null;
}

/** Every thread currently claimed by a session (deleted ones included — caller filters). */
export async function listThreadsClaimedBySession(ctx: Ctx, sessionId: Id<"cliSessions">): Promise<Doc<"cliThreads">[]> {
  return ctx.db
    .query("cliThreads")
    .withIndex("by_claimedBySessionId", (q) => q.eq("claimedBySessionId", sessionId))
    .collect();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type ThreadGit = NonNullable<Doc<"cliThreads">["git"]>;

/** A thread patch whose `git` part is merged into the stored object, not replaced. */
type ThreadPatch = Omit<Partial<Doc<"cliThreads">>, "git" | "statusProjection"> & {
  git?: Partial<ThreadGit>;
};

/** Clears both halves of a done mark (OS-2176). */
const CLEARED_DONE = { doneAt: undefined, isMarkedDone: undefined } satisfies ThreadPatch;

/**
 * `inCascade` marks a seam write applied to a container child inside a cascade
 * (OS-1475): it skips the per-child container re-sync — the cascade syncs once
 * at the end instead. Without it, every child write re-collects all group children:
 * O(n²) row reads, ~10k for one 100-child group, and a 50-row batch of full
 * groups would blow Convex's per-transaction read ceiling.
 */
type CascadeOpts = {
  inCascade?: boolean;
  /**
   * Force the full container recompute regardless of what the patch moved
   * (OS-1599). Membership changes need it: `childCount` and the dissolve-on-
   * last-child rule depend on the row set, not on any one child's contribution,
   * and the departing child can hand the origin role to a group child.
   */
  forceContainerRecompute?: boolean;
};

/**
 * The container denorms a single child contributes to, as seen from that child
 * alone (OS-1599). Everything `syncContainerDenorms` aggregates is a fold over
 * these per-child values, which is what lets most writes skip the group-child
 * collect — see `classifyContainerImpact`.
 */
type ChildContribution = {
  bucket: CliThreadWatchStatus;
  isUnread: boolean;
  needsAttention: boolean;
  lastActivityAt: number;
};

function childContribution(thread: Doc<"cliThreads">): ChildContribution {
  return {
    bucket: deriveThreadStatusProjection(thread).watchTowerStatus,
    isUnread: hasUnreadThreadActivity(thread),
    needsAttention: requiresThreadAttention(thread),
    lastActivityAt: thread.lastActivityAt,
  };
}

/**
 * `aggregateStatus` precedence as a rank (OS-1476, `docs/specs/thread-groups.md`):
 * higher wins, so a child's bucket can only *raise* the container's aggregate
 * without consulting group children. Mirrors `deriveContainerAggregateStatus`, which
 * stays the single source of truth for the recompute path.
 */
const AGGREGATE_RANK: Record<CliThreadAggregateStatus, number> = { idle: 0, running: 1, needs_attention: 2, failed: 3 };

function bucketAsAggregate(bucket: CliThreadWatchStatus): CliThreadAggregateStatus {
  if (bucket === "failed") {
    return "failed";
  }
  if (bucket === "waiting_input") {
    return "needs_attention";
  }
  return bucket === "running" ? "running" : "idle";
}

/**
 * How a child write can move its container's denorms (OS-1599). Every aggregate
 * is monotone in one direction, so rising-only moves (`escalate`) are provably
 * correct from the one child and patch the container directly; a term turning
 * *off* (`recompute`) needs the full group-child collect because a group child may still
 * hold the state. Claim/stream-start/interaction-set all land on `escalate`, so
 * a run's cost stops scaling with group size.
 */
type ContainerImpact =
  | { tier: "none" }
  | { tier: "escalate"; patch: ThreadPatch }
  | { tier: "recompute" };

function classifyContainerImpact(
  container: Doc<"cliThreads">,
  before: ChildContribution,
  after: ChildContribution,
  originChanged: boolean
): ContainerImpact {
  // The origin child feeds `originBranch`/`originTaskId`, which read the oldest
  // live child only — and membership changes can hand the role to a group child.
  if (originChanged || container.childWatchStatus === undefined) {
    return { tier: "recompute" };
  }
  // Any term switching off may or may not still be held by a group child.
  if (
    (before.isUnread && !after.isUnread) ||
    (before.needsAttention && !after.needsAttention) ||
    WATCH_STATUS_RANK[after.bucket] < WATCH_STATUS_RANK[before.bucket]
  ) {
    return { tier: "recompute" };
  }

  const patch: ThreadPatch = {};
  if (after.lastActivityAt > container.lastActivityAt) {
    patch.lastActivityAt = after.lastActivityAt;
  }
  if (after.isUnread && container.hasUnreadChildren !== true) {
    patch.hasUnreadChildren = true;
  }
  if (after.needsAttention && container.hasAttentionChildren !== true) {
    patch.hasAttentionChildren = true;
  }
  if (WATCH_STATUS_RANK[after.bucket] > WATCH_STATUS_RANK[container.childWatchStatus]) {
    patch.childWatchStatus = after.bucket;
  }
  const candidate = bucketAsAggregate(after.bucket);
  const stored = container.aggregateStatus ?? "idle";
  // Run containers mirror workflowRun.status (same rule as the recompute
  // fold in `syncContainerDenorms`) — a child's rise must not overwrite it.
  if (container.workflowRunId === undefined && AGGREGATE_RANK[candidate] > AGGREGATE_RANK[stored]) {
    patch.aggregateStatus = candidate;
  }
  return Object.keys(patch).length === 0 ? { tier: "none" } : { tier: "escalate", patch };
}

/**
 * Patch a thread and recompute `statusProjection` from the merged doc — every
 * write touching a derivation input must go through here, not a bare
 * `ctx.db.patch`. Also the single seam that merges partial `git` patches, since
 * Convex `patch` would replace the whole object. Container upkeep is tiered by
 * what moved (see `classifyContainerImpact`).
 */
async function patchThreadWithStatusProjection(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: ThreadPatch,
  opts: CascadeOpts = {}
): Promise<void> {
  const current = await ctx.db.get("cliThreads", threadId);
  const effective = { ...patch };
  const merged = current ? { ...current, ...effective, git: { ...current.git, ...effective.git } } : undefined;
  // Background membership belongs to one live process/run. All lifecycle resets pass here.
  if (current?.metadata?.backgroundTasks && merged && (
    merged.isDeleted || merged.processingState !== "streaming" ||
    merged.activeAssistantMessageId !== current.activeAssistantMessageId ||
    merged.claimedBySessionId !== current.claimedBySessionId
  )) {
    effective.metadata = { ...(effective.metadata ?? current.metadata), backgroundTasks: undefined };
  }
  await ctx.db.patch("cliThreads", threadId, {
    ...effective,
    ...(effective.git ? { git: { ...current?.git, ...effective.git } } : {}),
    ...(current ? { statusProjection: deriveThreadStatusProjection({ ...current, ...effective }) } : {}),
  });
  if (opts.inCascade || !current || !merged) {
    return;
  }
  const parentThreadId = current.parentThreadId;
  if (parentThreadId === undefined) {
    return;
  }
  const container = await ctx.db.get("cliThreads", parentThreadId);
  if (!container || container.isDeleted) {
    return;
  }
    // An origin change here means this child's origin-visible fields moved;
    // membership changes go through `syncContainerDenorms` directly. Pre-
    // `originThreadId` containers can't answer "is this the origin?", so any
    // origin-visible move on them recomputes (and backfills the field).
  const originVisibleMove = threadExecutionBranch(merged) !== container.originBranch || merged.associatedTaskId !== container.originTaskId;
  const originChanged = originVisibleMove && (container.originThreadId === threadId || container.originThreadId === undefined);
  const impact: ContainerImpact = opts.forceContainerRecompute
    ? { tier: "recompute" }
    : classifyContainerImpact(container, childContribution(current), childContribution(merged), originChanged);
  if (impact.tier === "none") {
    return;
  }
  if (impact.tier === "escalate") {
    await patchThreadWithStatusProjection(ctx, parentThreadId, impact.patch);
    return;
  }
  await syncContainerDenorms(ctx, parentThreadId);
}

/**
 * Full recompute of a container's denorms from `by_parentThreadId`, in the same
 * transaction as the child write (OS-1473). Used by the de-escalating tier and
 * every membership change, where a group child may still hold a dropped state. No-op
 * without a parent, so containers cannot recurse.
 *
 * Being from-scratch, it doubles as the drift self-heal for the O(1) tiers — keep
 * it reachable on membership changes and cascade tails.
 */
async function syncContainerDenorms(ctx: MutationCtx, parentThreadId: Id<"cliThreads"> | undefined): Promise<void> {
  if (parentThreadId === undefined) {
    return;
  }
  const container = await ctx.db.get("cliThreads", parentThreadId);
  if (!container || container.isDeleted) {
    return;
  }
  const children = await listGroupRows(ctx, parentThreadId);
  // A group dissolves when its last live member is removed or deleted
  // (OS-1474). Run containers never auto-delete: they exist before their lazy
  // lane threads do, and outlive them while the run is readable (OS-1366).
  if (children.length === 0 && container.workflowRunId === undefined) {
    await softDeleteThread(ctx, parentThreadId, Date.now());
    return;
  }
    // The oldest live child is the group's origin; `children` is in creation order.
  const origin = children[0];
  const next = {
    ...containerChildFields(container, children),
    // Run containers mirror workflowRun.status (written by the runs domain at
    // its own seams), never the child fold — an empty or settled child set
    // must not overwrite a running run's status.
    aggregateStatus:
      container.workflowRunId !== undefined ? container.aggregateStatus : deriveContainerAggregateStatus(children),
    originBranch: origin ? threadExecutionBranch(origin) : undefined,
    originTaskId: origin?.associatedTaskId,
    originThreadId: origin?._id,
  };
  // Nothing moved: skip the write so the group row's subscribers aren't
  // invalidated for an identical document (OS-1599).
  const unchanged =
    next.childCount === container.childCount &&
    next.childWatchStatus === container.childWatchStatus &&
    next.aggregateStatus === container.aggregateStatus &&
    next.hasUnreadChildren === container.hasUnreadChildren &&
    next.hasAttentionChildren === container.hasAttentionChildren &&
    next.originBranch === container.originBranch &&
    next.originTaskId === container.originTaskId &&
    next.originThreadId === container.originThreadId &&
    next.lastActivityAt === container.lastActivityAt;
  if (unchanged) {
    return;
  }
  await patchThreadWithStatusProjection(ctx, parentThreadId, next);
}

export type ThreadInsert = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  profileId: Id<"cliProfiles">;
  pathId: string;
  path: string;
  cliType: Doc<"cliThreads">["cliType"];
  title: string;
  associatedTaskId?: Id<"tasks">;
  attachedPullRequest?: AttachedPullRequest;
  /** A Pull request checks run's head revision at launch (OS-2400). Set only here at creation. */
  pullRequestChecks?: { headSha: string };
  /** How the task association was initiated — recorded on the task's `agentThreadWork` entry, not stored on the thread. */
  agentWorkSource?: AgentThreadWorkSource;
  /**
   * Immutable Project agent binding + prompt snapshot (OS-1138). Set only here
   * at creation; no write helper may change or clear them afterwards.
   */
  projectAgentId?: Id<"projectAgents">;
  agentPromptSnapshot?: string;
  worktree?: ThreadGit["worktree"];
  executionBranch?: string;
  /**
   * The creating user message's runtime selection, denormalized (OS-1454).
   * Stamped here rather than patched afterwards because a brand-new thread has
   * no metadata to merge with.
   */
  lastUsedCliSelection?: CliMessageSelection;
  /** Container this thread is born into as a group child (OS-1474). */
  parentThreadId?: Id<"cliThreads">;
  /** Born before its first message (OS-1920): opens `completed`, nothing for the CLI to claim yet. */
  awaitsFirstMessage?: true;
  /**
   * The thread whose agent spawned this one through MCP `create_thread`
   * (OS-1162). Set only here at creation; nothing patches it afterwards.
   * Independent of `parentThreadId` — see the schema comment.
   */
  spawnedByThreadId?: Id<"cliThreads">;
  /** The parent run this thread was branched from (OS-1397). Set only here at creation. */
  forkedFrom?: CliThreadForkedFrom;
  /** Run + lane this thread executes for (OS-1868). Set only here at creation. */
  workflowRunId?: Id<"workflowRuns">;
  workflowLaneId?: string;
  /** The one step a Parallel-Lane one-shot serves (OS-1885) — see the schema comment. */
  workflowRunStepId?: Id<"workflowRunSteps">;
};

/**
 * Insert a freshly-created thread. Stamps the creation-constant lifecycle fields
 * (`pending`/`idle` status, pending-message flag, read/created/activity
 * timestamps from `now`, `isDeleted: false`) so callers pass only
 * the identity + content props.
 */
export async function insertCliThread(ctx: MutationCtx, thread: ThreadInsert, now: number): Promise<Id<"cliThreads">> {
  const cli = thread.lastUsedCliSelection ? mergeLastUsedCli(undefined, thread.lastUsedCliSelection) : undefined;
  const status = thread.awaitsFirstMessage ? "completed" : "pending";
  const threadId = await ctx.db.insert("cliThreads", {
    userId: thread.userId,
    projectId: thread.projectId,
    profileId: thread.profileId,
    pathId: thread.pathId,
    path: thread.path,
    cliType: thread.cliType,
    title: thread.title,
    status,
    processingState: "idle",
    statusProjection: deriveThreadStatusProjection({
      status,
      readAt: now,
      attentionAcknowledgedAt: undefined,
      lastActivityAt: now,
    }),
    hasPendingUserMessages: !thread.awaitsFirstMessage,
    parentThreadId: thread.parentThreadId,
    spawnedByThreadId: thread.spawnedByThreadId,
    forkedFrom: thread.forkedFrom,
    workflowRunId: thread.workflowRunId,
    workflowLaneId: thread.workflowLaneId,
    workflowRunStepId: thread.workflowRunStepId,
    associatedTaskId: thread.associatedTaskId,
    attachedPullRequest: thread.attachedPullRequest,
    pullRequestChecks: thread.pullRequestChecks,
    projectAgentId: thread.projectAgentId,
    agentPromptSnapshot: thread.agentPromptSnapshot,
    ...(thread.worktree || thread.executionBranch ? {
      git: { worktree: thread.worktree, executionBranch: thread.executionBranch },
    } : {}),
    ...(cli ? { metadata: { cli } } : {}),
    readAt: now,
    createdAt: now,
    lastActivityAt: now,
    isDeleted: false,
  });
  await syncAgentThreadWorkById(ctx, threadId, { source: thread.agentWorkSource });
  await foldInsertedChildIntoContainer(ctx, thread.parentThreadId, threadId);
  return threadId;
}

/**
 * Fold a freshly inserted child into its container in O(1) (OS-1885). A new
 * child is the newest row, so it can never take the origin role, and it only
 * *adds* state — the escalate tier's rising-only argument. Without this, a wide
 * parallel stage re-collects every sibling (agent prompt snapshots included) on
 * each of its inserts. A container without live children recomputes instead,
 * seeding the origin fields and healing `childCount`.
 */
async function foldInsertedChildIntoContainer(
  ctx: MutationCtx,
  parentThreadId: Id<"cliThreads"> | undefined,
  childId: Id<"cliThreads">
): Promise<void> {
  if (parentThreadId === undefined) {
    return;
  }
  const container = await ctx.db.get("cliThreads", parentThreadId);
  if (!container || container.isDeleted) {
    return;
  }
  const child = await ctx.db.get("cliThreads", childId);
  if (!container.childCount || container.childWatchStatus === undefined || !child) {
    await syncContainerDenorms(ctx, parentThreadId);
    return;
  }
  // A contribution that holds nothing, so classify can only escalate or no-op.
  const nothing: ChildContribution = { bucket: "done", isUnread: false, needsAttention: false, lastActivityAt: 0 };
  const impact = classifyContainerImpact(container, nothing, childContribution(child), false);
  const patch: ThreadPatch = impact.tier === "escalate" ? impact.patch : {};
  patch.childCount = container.childCount + 1;
  await patchThreadWithStatusProjection(ctx, parentThreadId, patch);
}

function containerChildFields(container: Doc<"cliThreads">, children: Doc<"cliThreads">[]) {
  return {
    childWatchStatus: deriveContainerWatchStatus(children),
    childCount: children.length,
    hasUnreadChildren: children.some(hasUnreadThreadActivity),
    hasAttentionChildren: children.some(requiresThreadAttention),
    // Keep activity monotonic when the newest child is deleted.
    lastActivityAt: Math.max(container.lastActivityAt, ...children.map((child) => child.lastActivityAt)),
  };
}

/**
 * Insert a group container, snapshotting identity — and any pin or share — from
 * its first child (OS-1474, OS-1579). Both follow the list row, and neither
 * index is parent-aware, so the caller clears them on the source after
 * reparenting; the share must move for the owner's link to survive group creation.
 * Containers have no lifecycle of their own: status is terminal from birth.
 */
export async function insertGroupContainer(ctx: MutationCtx, source: Doc<"cliThreads">, now: number): Promise<Id<"cliThreads">> {
  return ctx.db.insert("cliThreads", {
    userId: source.userId,
    projectId: source.projectId,
    profileId: source.profileId,
    pathId: source.pathId,
    path: source.path,
    cliType: source.cliType,
    title: source.title,
    isPinned: source.isPinned,
    pinnedAt: source.pinnedAt,
    sharedAt: source.sharedAt,
    kind: "group",
    status: "completed",
    processingState: "idle",
    statusProjection: deriveThreadStatusProjection({
      status: "completed",
      readAt: now,
      attentionAcknowledgedAt: undefined,
      lastActivityAt: now,
    }),
    hasPendingUserMessages: false,
    childCount: 0,
    childWatchStatus: "needs_review",
    aggregateStatus: "idle",
    readAt: now,
    createdAt: now,
    lastActivityAt: now,
    isDeleted: false,
  });
}

type WorkflowRunContainerInsert = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  profileId: Id<"cliProfiles">;
  pathId: string;
  path: string;
  cliType: Doc<"cliThreads">["cliType"];
  title: string;
  workflowRunId: Id<"workflowRuns">;
  /** Pre-seeds the row's task chip; lane threads take over as origin children exist. */
  originTaskId?: Id<"tasks">;
  /** Binds the run into the task's Activity/`agentThreadWork` — its only surface until lane threads exist. */
  associatedTaskId?: Id<"tasks">;
};

/**
 * Insert a Workflow run's container (OS-1366): a group whose `workflowRunId`
 * identifies its run. Manual children may join and leave; workflow threads
 * stay attached. `aggregateStatus` mirrors the run. Spec: docs/specs/workflows.md.
 */
export async function insertWorkflowRunContainer(ctx: MutationCtx, container: WorkflowRunContainerInsert, now: number): Promise<Id<"cliThreads">> {
  const threadId = await ctx.db.insert("cliThreads", {
    ...container,
    kind: "group",
    status: "completed",
    processingState: "idle",
    statusProjection: deriveThreadStatusProjection({
      status: "completed",
      readAt: now,
      attentionAcknowledgedAt: undefined,
      lastActivityAt: now,
    }),
    hasPendingUserMessages: false,
    childCount: 0,
    childWatchStatus: "needs_review",
    aggregateStatus: "running",
    readAt: now,
    createdAt: now,
    lastActivityAt: now,
    isDeleted: false,
  });
  await syncAgentThreadWorkById(ctx, threadId);
  return threadId;
}

/** Bind an existing group without changing its title, pin, or children. Spec: workflows.md, Start. */
export async function attachWorkflowRunToContainer(
  ctx: MutationCtx,
  containerId: Id<"cliThreads">,
  selection: Omit<WorkflowRunContainerInsert, "title" | "originTaskId">,
  now: number
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, containerId, {
    ...selection,
    aggregateStatus: "running",
    ...CLEARED_DONE,
    lastActivityAt: now,
  });
  await syncAgentThreadWorkById(ctx, containerId);
}

/**
 * Mirror a Workflow run's status onto its container row (OS-1366) — the runs
 * domain's write seam for the thread-list dot. Bumps `lastActivityAt` so the
 * run resorts on status changes.
 */
export async function setContainerAggregateStatus(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  aggregateStatus: CliThreadAggregateStatus,
  now: number
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { aggregateStatus, lastActivityAt: now });
}

/**
 * Reparent a thread for group creation or removal (OS-1474), syncing both containers:
 * `patchThreadWithStatusProjection` covers the previous one (it reads the
 * pre-patch doc), the explicit call covers the new one. `undefined` unsets the
 * field, returning the thread to the flat list's `eq(parentThreadId, undefined)`
 * queries — and dissolves the old group if this was its last live member.
 */
export async function setThreadParent(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  parentThreadId: Id<"cliThreads"> | undefined
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { parentThreadId }, { forceContainerRecompute: true });
  await syncContainerDenorms(ctx, parentThreadId);
}

/**
 * A container's children in creation order — soft-deleted ones only with
 * `includeDeleted`. Callers needing both views
 * (getGroup: live tabs plus the cap's row count) should call this once with
 * `includeDeleted` and derive, not scan the index twice.
 */
export async function listGroupRows(
  ctx: Ctx,
  parentThreadId: Id<"cliThreads">,
  options?: { includeDeleted?: boolean }
): Promise<Doc<"cliThreads">[]> {
  const rows = await ctx.db
    .query("cliThreads")
    .withIndex("by_parentThreadId", (q) => q.eq("parentThreadId", parentThreadId))
    .collect();
  return options?.includeDeleted ? rows : rows.filter((child) => !child.isDeleted);
}

/**
 * All rows ever parented under a container — soft-deleted included.
 * The `MAX_GROUP_CHILDREN` cap's input (OS-1474): it bounds physical fan-out
 * under one container, so it must not use `childCount` (live members only).
 */
export async function countGroupRows(ctx: Ctx, parentThreadId: Id<"cliThreads">): Promise<number> {
  return (await listGroupRows(ctx, parentThreadId, { includeDeleted: true })).length;
}

/** Resolve the thread encoded by a checkpoint ref without trusting an arbitrary id. */
export async function getThreadByCheckpointRef(ctx: Ctx, ref: string): Promise<Doc<"cliThreads"> | null> {
  const match = /^refs\/convoy\/checkpoints\/([^/]+)\/[^/]+\/pre$/.exec(ref);
  const id = match ? ctx.db.normalizeId("cliThreads", match[1]) : null;
  return id ? getThreadById(ctx, id) : null;
}

/**
 * Repoint a thread at a different profile path entry (worktree resolution).
 * Updates the fallback path snapshot and the worktree spec together so the
 * thread never points at a path with a stale spec.
 */
export async function repointThreadPath(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: {
    pathId: string;
    path: string;
    worktree: ThreadGit["worktree"];
    previousWorkingDirectory?: string;
    legacyCheckpointsUnsafe?: boolean;
    executionBranch?: string | null;
  }
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, {
    pathId: patch.pathId,
    path: patch.path,
    git: {
      worktree: patch.worktree,
      ...(patch.legacyCheckpointsUnsafe ? { legacyCheckpointsUnsafe: true } : {}),
      ...(patch.previousWorkingDirectory ? { previousWorkingDirectory: patch.previousWorkingDirectory } : {}),
      ...(patch.executionBranch !== undefined ? { executionBranch: patch.executionBranch ?? undefined } : {}),
    },
  });
}

type MarkThreadPendingIntent = {
  now: number;
  /**
   * Whether the thread's status should flip to `pending` (the `send` path only
   * flips it when the thread was idle; an already-active thread keeps its
   * current status).
   */
  flipToPending: boolean;
  /** Associate this task with the thread, only when provided. */
  associatedTaskId?: Id<"tasks">;
  /** Set the thread's Attached pull request, only when provided. */
  attachedPullRequest?: AttachedPullRequest;
};

/**
 * Mark a thread as having freshly-queued user input (the `send` path). Always
 * flags `hasPendingUserMessages`, stamps `lastActivityAt`, and clears any
 * queue hold (a new send is the user's "go" signal, OS-1374); flips status to
 * `pending` only when `flipToPending` is set, and associates a task only when
 * `associatedTaskId` is provided.
 */
export async function markThreadPending(ctx: MutationCtx, threadId: Id<"cliThreads">, intent: MarkThreadPendingIntent): Promise<void> {
  const thread = await getThreadById(ctx, threadId);
  await reopenThreadForUserTurn(ctx, thread);
  if (thread?.metadata?.proposedPlan) {
    await mergeThreadStreamMetadata(ctx, thread, { proposedPlan: undefined });
  }
  await patchThreadWithStatusProjection(ctx, threadId, {
    hasPendingUserMessages: true,
    queueHeldAt: undefined,
    lastActivityAt: intent.now,
    ...(intent.flipToPending ? { status: "pending" } : {}),
    ...(intent.associatedTaskId !== undefined ? { associatedTaskId: intent.associatedTaskId } : {}),
    ...(intent.attachedPullRequest !== undefined ? { attachedPullRequest: intent.attachedPullRequest } : {}),
  });
  if (intent.associatedTaskId !== undefined) {
    await moveThreadCheckResultsToTask(ctx, threadId, intent.associatedTaskId);
  }
  await syncAgentThreadWorkById(ctx, threadId);
  await scheduleWorkflowAdvance(ctx, threadId);
}

/**
 * Recompute the pending-user-messages flag (the `consumeSteeredMessages` and
 * `removeQueued` paths). Leaves claim/streaming state alone. An empty
 * queue always clears the queue hold (nothing left to hold, OS-1374); a
 * non-empty queue keeps the current hold unless `holdQueue` explicitly sets
 * one (the edit-last rewind path holds the run's un-stamped messages).
 * An unclaimed pending thread whose queue empties settles to `completed` (OS-2311).
 */
export async function setThreadPendingUserMessages(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  hasPendingUserMessages: boolean,
  now: number,
  opts?: { holdQueue?: boolean }
): Promise<void> {
  const thread = await getThreadById(ctx, threadId);
  const settles = !hasPendingUserMessages && thread?.status === "pending" && thread.processingState === "idle";
  await patchThreadWithStatusProjection(ctx, threadId, {
    hasPendingUserMessages,
    ...(settles ? { status: "completed" } : {}),
    ...(hasPendingUserMessages ? (opts?.holdQueue === true ? { queueHeldAt: now } : {}) : { queueHeldAt: undefined }),
    lastActivityAt: now,
  });
  await syncAgentThreadWorkById(ctx, threadId);
}

type ThreadClaimPatch = {
  sessionId: Id<"cliSessions">;
  claimedAt: number;
  claimLeaseExpiresAt: number;
  processingState: Doc<"cliThreads">["processingState"];
  now: number;
};

/** Record a fresh claim lease on a thread (the `claimThread` path). */
export async function applyThreadClaim(ctx: MutationCtx, threadId: Id<"cliThreads">, patch: ThreadClaimPatch): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, {
    claimedBySessionId: patch.sessionId,
    claimedAt: patch.claimedAt,
    claimLeaseExpiresAt: patch.claimLeaseExpiresAt,
    processingState: patch.processingState,
    lastActivityAt: patch.now,
  });
}

/** Extend an active claim lease (the `heartbeatClaim` path; no activity stamp). */
export async function extendThreadClaimLease(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: { claimedAt: number; claimLeaseExpiresAt: number }
): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, {
    claimedAt: patch.claimedAt,
    claimLeaseExpiresAt: patch.claimLeaseExpiresAt,
  });
}

type ThreadStreamingPatch = {
  hasPendingUserMessages: boolean;
  activeAssistantMessageId: Id<"cliMessages">;
  streamWatchdogId: Id<"_scheduled_functions">;
  lastActivityAt: number;
};

/** Move a thread into the streaming state when a run begins. */
export async function markThreadStreaming(ctx: MutationCtx, threadId: Id<"cliThreads">, patch: ThreadStreamingPatch): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, {
    ...patch,
    status: "streaming",
    processingState: "streaming",
  });
  await syncAgentThreadWorkById(ctx, threadId);
}

type ThreadStreamingEndPatch = {
  /** Only successful completion may retain a ready proposal. */
  preserveProposedPlan?: boolean;
  status: Doc<"cliThreads">["status"];
  hasPendingUserMessages: boolean;
  processingState: Doc<"cliThreads">["processingState"];
  lastActivityAt: number;
  // Cumulative diff totals (OS-1252); the complete path passes them pre-summed.
  git?: Pick<ThreadGit, "linesAdded" | "linesRemoved">;
};

/**
 * End an in-flight stream (the `complete`/`fail` paths): set the resulting
 * status/queue state and clear the active assistant + watchdog references so no
 * stale streaming target survives (Chat Processing invariant #3).
 */
export async function markThreadStreamEnded(ctx: MutationCtx, threadId: Id<"cliThreads">, patch: ThreadStreamingEndPatch): Promise<void> {
  const { preserveProposedPlan, ...streamPatch } = patch;
  if (!preserveProposedPlan || patch.status !== "waiting_input") {
    const thread = await getThreadById(ctx, threadId);
    if (thread?.metadata?.proposedPlan) {
      await mergeThreadStreamMetadata(ctx, thread, { proposedPlan: undefined });
    }
  }
  await patchThreadWithStatusProjection(ctx, threadId, {
    ...streamPatch,
    activeAssistantMessageId: undefined,
    streamWatchdogId: undefined,
  });
  await syncAgentThreadWorkById(ctx, threadId);
  await scheduleWorkflowAdvance(ctx, threadId);
}

type ThreadClaimResetPatch = {
  status: Doc<"cliThreads">["status"];
  hasPendingUserMessages: boolean;
  /**
   * Hold the surviving queue until the user's next send (Stop, OS-1374).
   * Deliberately required: `undefined` clears any existing hold, so every
   * caller must state whether it keeps (`chat.queueHeldAt`), sets, or clears
   * the hold — forgetting the field must not silently un-park a queue.
   */
  queueHeldAt: number | undefined;
  now: number;
};

/**
 * Release a claim and clear every streaming pointer, returning the thread to
 * `idle` (Chat Processing invariant #3). The caller computes the resulting
 * `status`/`hasPendingUserMessages` and cancels the watchdog job.
 */
export async function resetThreadClaim(ctx: MutationCtx, threadId: Id<"cliThreads">, patch: ThreadClaimResetPatch): Promise<void> {
  const thread = await getThreadById(ctx, threadId);
  if (thread?.metadata?.proposedPlan &&
      (thread.processingState === "streaming" || patch.status !== "waiting_input" || !thread.metadata.proposedPlan.ready)) {
    await mergeThreadStreamMetadata(ctx, thread, { proposedPlan: undefined });
  }
  await patchThreadWithStatusProjection(ctx, threadId, {
    status: patch.status,
    processingState: "idle",
    hasPendingUserMessages: patch.hasPendingUserMessages,
    queueHeldAt: patch.queueHeldAt,
    claimedBySessionId: undefined,
    claimedAt: undefined,
    claimLeaseExpiresAt: undefined,
    activeAssistantMessageId: undefined,
    streamWatchdogId: undefined,
    lastActivityAt: patch.now,
  });
  await syncAgentThreadWorkById(ctx, threadId);
  await scheduleWorkflowAdvance(ctx, threadId);
}

/**
 * Requeue a thread after a message retry. Retry is an explicit "run it" signal,
 * so it clears any queue hold (OS-1374).
 *
 * Takes an id, not the caller's doc: `messages.retry` cancels pending
 * interaction requests first, and a doc read before that would re-stamp a stale
 * `waiting_input` bucket. The write seam re-reads, so it sees the cancellation.
 */
export async function requeueThreadForRetry(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  retriedMessageId: Id<"cliMessages">,
  now: number
): Promise<void> {
  const thread = await ctx.db.get("cliThreads", threadId);
  await reopenThreadForUserTurn(ctx, thread);
  await patchThreadWithStatusProjection(ctx, threadId, {
    hasPendingUserMessages: true,
    queueHeldAt: undefined,
    status: "pending",
    activeAssistantMessageId: thread?.activeAssistantMessageId === retriedMessageId ? undefined : thread?.activeAssistantMessageId,
    streamWatchdogId: undefined,
    lastActivityAt: now,
  });
  await syncAgentThreadWorkById(ctx, threadId);
  await scheduleWorkflowAdvance(ctx, threadId);
}

/**
 * A run-bound thread crossing a lifecycle seam (message queued, stream end,
 * claim reset, retry requeue, soft delete, interaction flag) re-evaluates its run. Scheduled, not inline: the engine
 * re-derives from current DB state, so this seam stays decoupled from the
 * workflows domain (docs/specs/workflows.md → Orchestration, OS-1868).
 */
// By path, not `internal.…`: importing `_generated/api` here forms a type cycle
// with `workflows/runs/core.ts` (which imports this file), and TS then drops
// `workflows` from `internal` depending on check order (TS2339 in editors).
const advanceRef = makeFunctionReference<"mutation", { runId: Id<"workflowRuns"> }>("workflows/runs/core:advance");

async function scheduleWorkflowAdvance(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  const thread = await ctx.db.get("cliThreads", threadId);
  if (thread && thread.workflowRunId !== undefined && thread.kind === undefined) {
    await ctx.scheduler.runAfter(0, advanceRef, { runId: thread.workflowRunId });
  }
}

/** Adjust a fork's count of chunk-copy chains still scheduled (OS-1397); no-op on a non-fork. */
export async function addForkCopiesInFlight(ctx: MutationCtx, thread: Doc<"cliThreads">, delta: number): Promise<void> {
  if (!thread.forkedFrom) {
    return;
  }
  const copiesInFlight = Math.max(0, (thread.forkedFrom.copiesInFlight ?? 0) + delta);
  await ctx.db.patch("cliThreads", thread._id, { forkedFrom: { ...thread.forkedFrom, copiesInFlight } });
}

/** Set a thread's display title (the `updateTitle` path; no activity stamp). */
export async function setThreadTitle(ctx: MutationCtx, threadId: Id<"cliThreads">, title: string): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { title });
  await syncAgentThreadWorkById(ctx, threadId);
}

/** Attach a task to a thread after creation (OS-1713); routes through the projection so a group's `originTaskId` follows. */
export async function setThreadAssociatedTask(ctx: MutationCtx, threadId: Id<"cliThreads">, taskId: Id<"tasks">): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { associatedTaskId: taskId });
  await moveThreadCheckResultsToTask(ctx, threadId, taskId);
  await syncAgentThreadWorkById(ctx, threadId);
}

/** Attach a PR to a thread after creation; attach-once is the caller's check. */
export async function setThreadAttachedPullRequest(ctx: MutationCtx, threadId: Id<"cliThreads">, pullRequest: AttachedPullRequest): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { attachedPullRequest: pullRequest });
}

/** Set or clear a task-less thread's own Checklist (OS-2293). */
export async function setThreadChecklist(ctx: MutationCtx, threadId: Id<"cliThreads">, checklistId: Id<"checklists"> | undefined): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { checklistId });
}

/** Set or clear the last-known PR snapshot for the thread's branch (OS-1370). */
export async function setThreadPullRequest(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  pullRequest: CliThreadPullRequest | undefined
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { git: { pullRequest } });
}

/**
 * Merge chunk-stream snapshots into the thread's denormalized `metadata`
 * (plan OS-1442, context window and usage limits OS-1889, goal OS-2276). Written from the
 * chunk-insert fold; merges so sibling keys survive.
 */
export async function mergeThreadStreamMetadata(
  ctx: MutationCtx,
  thread: Doc<"cliThreads">,
  patch: Pick<CliThreadMetadata, "plan" | "contextWindow" | "usageLimits" | "proposedPlan" | "backgroundTasks" | "stopConfirmation" | "goal">
): Promise<void> {
  await ctx.db.patch("cliThreads", thread._id, {
    metadata: { ...thread.metadata, ...patch },
  });
}

/**
 * Fold a message's runtime selection into the thread's denormalized last-used
 * selection (OS-1454), so the composer's pills read the thread doc instead of
 * scanning messages. Merges into existing `metadata` so `plan` survives.
 */
export async function setThreadLastUsedCliSelection(
  ctx: MutationCtx,
  thread: Doc<"cliThreads">,
  selection: CliMessageSelection
): Promise<void> {
  const cli = mergeLastUsedCli(thread.metadata?.cli, selection);
  if (!cli) {
    return;
  }

  await ctx.db.patch("cliThreads", thread._id, {
    metadata: { ...thread.metadata, cli },
  });
}

/** Set or clear the branch snapshot captured at execution start (OS-1247). */
export async function setThreadExecutionBranch(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  executionBranch: string | undefined
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { git: { executionBranch } });
}

/**
 * Run a list action over a container's live children (OS-1475), then recompute
 * its denorms once; false for plain threads. Seam writes in `applyToChild` must
 * pass `inCascade: true` to skip the per-child re-sync.
 *
 * The children are collected twice on purpose: the loop needs the pre-cascade
 * snapshot, `syncContainerDenorms` the post-cascade docs.
 */
async function cascadeToChildren(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  applyToChild: (child: Doc<"cliThreads">) => Promise<void>
): Promise<boolean> {
  const thread = await ctx.db.get("cliThreads", threadId);
  if (!thread || !isContainerThread(thread)) {
    return false;
  }
  for (const child of await listGroupRows(ctx, threadId)) {
    await applyToChild(child);
  }
  await syncContainerDenorms(ctx, threadId);
  return true;
}

/** The single-row read patch — no cascade, no container logic. */
async function patchThreadRead(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: { now: number; acknowledgeAttention: boolean },
  opts: CascadeOpts = {}
): Promise<void> {
  await patchThreadWithStatusProjection(
    ctx,
    threadId,
    {
      readAt: patch.now,
      ...(patch.acknowledgeAttention ? { attentionAcknowledgedAt: patch.now } : {}),
    },
    opts
  );
}

/**
 * Mark a thread read (the `markRead` path). Stamps `readAt`, and acknowledges
 * the current attention state only when `acknowledgeAttention` is set. On a
 * container, children follow first (settled ones skipped — a redundant patch
 * is a pure OCC-conflict source) and the container's own stamp lands last.
 */
export async function markThreadRead(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: { now: number; acknowledgeAttention: boolean }
): Promise<void> {
  const isContainer = await cascadeToChildren(ctx, threadId, async (child) => {
    const acknowledgeAttention = patch.acknowledgeAttention && requiresThreadAttention(child);
    if (threadNeedsReadPatch(child, acknowledgeAttention)) {
      await patchThreadRead(ctx, child._id, { now: patch.now, acknowledgeAttention }, { inCascade: true });
    }
  });
  // A container never carries an attention state of its own — the acks landed
  // on the children inside the cascade.
  await patchThreadRead(ctx, threadId, {
    now: patch.now,
    acknowledgeAttention: patch.acknowledgeAttention && !isContainer,
  });
}

/**
 * Mark a thread unread, clearing the read + attention-ack + done timestamps.
 * On a container, children follow (already-cleared ones skipped) — the group
 * row's unread dot derives from the children, so a container-local clear
 * would be invisible.
 */
export async function markThreadUnread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  const clearRead = { readAt: undefined, attentionAcknowledgedAt: undefined, ...CLEARED_DONE };
  await cascadeToChildren(ctx, threadId, async (child) => {
    if (child.readAt !== undefined || child.attentionAcknowledgedAt !== undefined || child.doneAt !== undefined) {
      await patchThreadWithStatusProjection(ctx, child._id, clearRead, { inCascade: true });
    }
  });
  await patchThreadWithStatusProjection(ctx, threadId, clearRead);
}

/** The single-row done patch — stamps done + read, no cascade or container logic. */
async function patchThreadDone(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: { now: number; acknowledgeAttention: boolean },
  opts: CascadeOpts = {}
): Promise<void> {
  await patchThreadWithStatusProjection(
    ctx,
    threadId,
    {
      doneAt: patch.now,
      isMarkedDone: true,
      readAt: patch.now,
      ...(patch.acknowledgeAttention ? { attentionAcknowledgedAt: patch.now } : {}),
    },
    opts
  );
}

/**
 * Explicitly mark a thread done (OS-1382). Done implies reviewed, so it also
 * stamps `readAt`. On a container, children follow first (already-done ones
 * skipped, preserving their own `doneAt`); ack stays off the container's own
 * stamp — see `markThreadRead`.
 */
export async function markThreadDone(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  patch: { now: number; acknowledgeAttention: boolean }
): Promise<void> {
  const isContainer = await cascadeToChildren(ctx, threadId, async (child) => {
    const acknowledgeAttention = patch.acknowledgeAttention && requiresThreadAttention(child);
    if (!isThreadDone(child) || threadNeedsReadPatch(child, acknowledgeAttention)) {
      await patchThreadDone(ctx, child._id, { now: patch.now, acknowledgeAttention }, { inCascade: true });
    }
  });
  await patchThreadDone(ctx, threadId, {
    now: patch.now,
    acknowledgeAttention: patch.acknowledgeAttention && !isContainer,
  });
}

/** A user turn clears the done mark on the thread and its group; agent activity never does (OS-2176). */
export async function reopenThreadForUserTurn(ctx: MutationCtx, thread: Doc<"cliThreads"> | null): Promise<void> {
  if (!thread) {
    return;
  }
  if (thread.doneAt !== undefined) {
    await patchThreadWithStatusProjection(ctx, thread._id, CLEARED_DONE);
  }
  const container = thread.parentThreadId ? await ctx.db.get("cliThreads", thread.parentThreadId) : null;
  if (container && !container.isDeleted && container.doneAt !== undefined) {
    await patchThreadWithStatusProjection(ctx, container._id, CLEARED_DONE);
  }
}

/** Clear the explicit done mark, returning a finished thread to needs-review (OS-1382). Children follow on a container (not-done ones skipped). */
export async function markThreadNotDone(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  await cascadeToChildren(ctx, threadId, async (child) => {
    if (child.doneAt !== undefined) {
      await patchThreadWithStatusProjection(ctx, child._id, CLEARED_DONE, { inCascade: true });
    }
  });
  await patchThreadWithStatusProjection(ctx, threadId, CLEARED_DONE);
}

/**
 * Set/clear the denormalized "run parked on a pending interaction request"
 * flag (maintained by cli/interactionRequests write paths). Re-syncs the task
 * summary: the flag flips a streaming entry to `waiting_input` (OS-1287).
 */
export async function setThreadHasPendingInteraction(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  hasPendingInteraction: boolean
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, { hasPendingInteraction });
  await syncAgentThreadWorkById(ctx, threadId);
  await scheduleWorkflowAdvance(ctx, threadId);
}

/**
 * Park/un-park a lane thread on its wait step (docs/specs/workflows.md → Wait
 * steps). Written by the advance itself, so no `scheduleWorkflowAdvance`.
 */
export async function setThreadWorkflowWaitParked(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  parked: boolean,
  now: number
): Promise<void> {
  await patchThreadWithStatusProjection(ctx, threadId, {
    status: parked ? "waiting_input" : "completed",
    lastActivityAt: now,
  });
  await syncAgentThreadWorkById(ctx, threadId);
}

/**
 * Persist the Codex exec cumulative-usage cursor (OS-1527). Plain patch: not a
 * `statusProjection` input. See `docs/specs/cost-tracking.md`.
 */
export async function setThreadCodexUsageCursor(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  codexUsageCursor: CodexUsageCursor
): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { codexUsageCursor });
}

/** Set or clear a thread's streaming-watchdog scheduled-job id. */
export async function setThreadWatchdog(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  streamWatchdogId: Id<"_scheduled_functions"> | undefined
): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { streamWatchdogId });
}

/**
 * Soft delete a thread (the `remove` path). In a delete cascade the caller
 * deletes the container explicitly after the children, so `inCascade` skips
 * the per-child re-sync (which would also auto-delete the group mid-loop).
 */
export async function softDeleteThread(ctx: MutationCtx, threadId: Id<"cliThreads">, now: number, opts: CascadeOpts = {}): Promise<void> {
  const thread = await ctx.db.get("cliThreads", threadId);
  await ctx.db.patch("cliThreads", threadId, { isDeleted: true, deletedAt: now });
  await deleteCheckResultsOwnedByThread(ctx, threadId);
  await syncAgentThreadWorkById(ctx, threadId);
  if (!opts.inCascade) {
    await syncContainerDenorms(ctx, thread?.parentThreadId);
  }
  // Deleting a lane thread must reach the run engine like any other lifecycle
  // seam — a merely-queued step has no stream/claim seam to cross.
  await scheduleWorkflowAdvance(ctx, threadId);
}

/** Pin a thread to the top of the thread list (the `pin` path; OS-1173). */
export async function pinThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { isPinned: true, pinnedAt: Date.now() });
}

/** Unpin a thread (the `unpin` path), clearing `pinnedAt`. */
export async function unpinThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { isPinned: false, pinnedAt: undefined });
}

/**
 * Share a thread read-only with project teammates (the `share` path; OS-1574).
 * A plain patch: `sharedAt` is not a `statusProjection` derivation input, and
 * the projection seam would also re-sync container denorms for nothing.
 */
export async function shareThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { sharedAt: Date.now() });
}

/** Stop sharing a thread (the `unshare` path), clearing `sharedAt`. */
export async function unshareThread(ctx: MutationCtx, threadId: Id<"cliThreads">): Promise<void> {
  await ctx.db.patch("cliThreads", threadId, { sharedAt: undefined });
}

/** Execution threads include group children, but never the container itself. */
export async function paginateServiceThreads(ctx: Ctx, userId: Id<"users">, projectId: Id<"projects">, opts: { cursor: string | null; numItems: number }) {
  return ctx.db.query("cliThreads")
    .withIndex("by_userId_projectId_isDeleted_kind_lastActivityAt", q => q.eq("userId", userId).eq("projectId", projectId).eq("isDeleted", false).eq("kind", undefined))
    .order("desc").paginate(opts);
}
