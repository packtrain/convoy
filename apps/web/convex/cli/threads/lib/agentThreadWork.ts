import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { AgentThreadWorkEntry, AgentThreadWorkSource } from "../../../lib/contracts/agentThreadWork";
import { getTaskById, patchTask } from "../../../tasks/lib/tasksRepo";
import { getUserById } from "../../../users/lib/usersRepo";
// Circular with cliThreadsRepo (it calls sync after each write); safe because
// both modules only reference each other's functions at call time.
import { getThreadById } from "./cliThreadsRepo";
import { resolveCliThreadAgent } from "./threadAgents";

/**
 * Mirror a thread's lifecycle into its task's denormalized `agentThreadWork`
 * summary (OS-1094): one entry per thread, following `associatedTaskId`, removed
 * on soft delete. The entry status matches the thread-list display status, not the
 * stored one.
 *
 * Every `cliThreads` write that can change association, status, title or delete
 * state must call this after patching (the repo helpers do). No-op writes are
 * skipped so hot lifecycle paths don't churn task documents.
 */
export async function syncAgentThreadWork(
  ctx: MutationCtx,
  thread: Doc<"cliThreads">,
  opts?: { source?: AgentThreadWorkSource }
): Promise<void> {
  if (!thread.associatedTaskId) {
    return;
  }

  const task = await getTaskById(ctx, thread.associatedTaskId);
  if (!task || task.isDeleted) {
    return;
  }

  const entries = task.agentThreadWork ?? [];
  const existing = entries.find((entry) => entry.threadId === thread._id);
  const removed = thread.isDeleted;

  if (removed) {
    if (!existing) {
      return;
    }
    await patchTask(
      ctx,
      task._id,
      { agentThreadWork: entries.filter((entry) => entry.threadId !== thread._id) },
      { bumpUpdatedAt: false }
    );
    return;
  }

  const userName = existing?.userName ?? (await getUserById(ctx, thread.userId))?.name ?? "Unknown";
  // The binding is immutable, so the agent identity is stable per entry: the
  // name is snapshotted on first sync (like `userName`) and reused afterwards,
  // surviving later agent deletion.
  const agentIdentity = thread.projectAgentId
    ? {
        projectAgentId: thread.projectAgentId,
        agentName: existing?.agentName ?? (await resolveCliThreadAgent(ctx, thread.projectAgentId)).name,
      }
    : {};
  // A run parked on a pending approval/question — or a queue held after a
  // Stop (OS-1374) — is the user's turn, not "running" — mirrors
  // deriveThreadWatchStatus (cli/lib/watchStatus.ts) and the thread-list
  // display status.
  const isParkedOnInteraction =
    (thread.status === "streaming" || thread.status === "pending") &&
    (thread.hasPendingInteraction === true || thread.queueHeldAt !== undefined);
  const next: AgentThreadWorkEntry = {
    threadId: thread._id,
    threadTitle: thread.title,
    userId: thread.userId,
    userName,
    cliType: thread.cliType,
    // A follow-up queued mid-stream doesn't pause the run — keep "streaming"
    // so the badge matches the thread list, which ignores queued input while
    // the thread is actively streaming.
    status: isParkedOnInteraction
      ? "waiting_input"
      : thread.status !== "streaming" && thread.hasPendingUserMessages
        ? "pending"
        : thread.status,
    source: existing?.source ?? opts?.source ?? "manual_attachment",
    ...agentIdentity,
    // Snapshotted on first sync and preserved afterwards (like `userName`), so
    // the timeline can order a foreign thread row by when its run started
    // rather than by `updatedAt`, which every status change restamps.
    createdAt: existing?.createdAt ?? thread.createdAt,
    updatedAt: Date.now(),
  };

  if (
    existing &&
    // A legacy entry predating `createdAt` (OS-1588) is backfilled the first
    // time its thread changes state. Presence-only on purpose: once set, this
    // is false forever after, so the no-op short-circuit below keeps protecting
    // hot lifecycle paths from task-doc churn. Do not compare the values.
    existing.createdAt !== undefined &&
    existing.threadTitle === next.threadTitle &&
    existing.status === next.status &&
    existing.source === next.source
  ) {
    return;
  }

  await patchTask(
    ctx,
    task._id,
    { agentThreadWork: [...entries.filter((entry) => entry.threadId !== thread._id), next] },
    { bumpUpdatedAt: false }
  );
}

/**
 * Re-read a thread after a repo write and sync its task summary. Convenience
 * for write helpers that only hold the thread id.
 */
export async function syncAgentThreadWorkById(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  opts?: { source?: AgentThreadWorkSource }
): Promise<void> {
  const thread = await getThreadById(ctx, threadId);
  if (!thread) {
    return;
  }
  await syncAgentThreadWork(ctx, thread, opts);
}
