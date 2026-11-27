import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { AgentThreadWorkEntry, AgentThreadWorkSource } from "../../../lib/contracts/agentThreadWork";
import { getTaskById } from "../../../tasks/lib/tasksRepo";
import {
  deleteAgentThreadWork,
  getAgentThreadWorkByThread,
  insertAgentThreadWork,
  replaceAgentThreadWork,
} from "../../../tasks/lib/agentThreadWorkRepo";
import { getUserById } from "../../../users/lib/usersRepo";
// Circular with cliThreadsRepo (it calls sync after each write); safe because
// both modules only reference each other's functions at call time.
import { getThreadById } from "./cliThreadsRepo";
import { resolveCliThreadAgent } from "./threadAgents";

/**
 * Mirror a thread's lifecycle into its `agentThreadWork` row (OS-1094, OS-2579):
 * one row per thread, following `associatedTaskId`, deleted on soft delete. The
 * row status matches the thread-list display status, not the stored one.
 *
 * Every `cliThreads` write that can change association, status, title or delete
 * state must call this after patching (the repo helpers do). No-op writes are
 * skipped so hot lifecycle paths don't churn rows.
 */
export async function syncAgentThreadWork(
  ctx: MutationCtx,
  thread: Doc<"cliThreads">,
  opts?: { source?: AgentThreadWorkSource }
): Promise<void> {
  if (!thread.associatedTaskId) {
    return;
  }

  const existing = await getAgentThreadWorkByThread(ctx, thread._id);
  if (thread.isDeleted) {
    if (existing) {
      await deleteAgentThreadWork(ctx, existing._id);
    }
    return;
  }

  // The task is read only when the row is new or moves, keeping the task doc
  // out of the hot path.
  const sameTask = existing?.taskId === thread.associatedTaskId;
  const task = sameTask ? null : await getTaskById(ctx, thread.associatedTaskId);
  const projectId = sameTask ? existing.projectId : task && !task.isDeleted ? task.projectId : null;
  if (!projectId) {
    return;
  }
  // Snapshots belong to this thread's row only while it stays on the same task.
  const kept = sameTask ? existing : undefined;

  const userName = kept?.userName ?? (await getUserById(ctx, thread.userId))?.name ?? "Unknown";
  // The binding is immutable, so the agent identity is stable per row: the
  // name is snapshotted on first sync (like `userName`) and reused afterwards,
  // surviving later agent deletion.
  const agentIdentity = thread.projectAgentId
    ? {
        projectAgentId: thread.projectAgentId,
        agentName: kept?.agentName ?? (await resolveCliThreadAgent(ctx, thread.projectAgentId)).name,
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
    source: kept?.source ?? opts?.source ?? "manual_attachment",
    ...agentIdentity,
    // Snapshotted on first sync (like `userName`), so the timeline orders a
    // foreign thread row by when its run started, not by `updatedAt`.
    createdAt: kept?.createdAt ?? thread.createdAt,
    updatedAt: Date.now(),
  };

  if (kept && kept.threadTitle === next.threadTitle && kept.status === next.status) {
    return;
  }

  const row = { ...next, projectId, taskId: thread.associatedTaskId };
  if (existing) {
    await replaceAgentThreadWork(ctx, existing._id, row);
  } else {
    await insertAgentThreadWork(ctx, row);
  }
}

/**
 * Re-read a thread after a repo write and sync its `agentThreadWork` row. Convenience
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
