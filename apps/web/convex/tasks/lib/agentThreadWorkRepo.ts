import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AgentThreadWorkEntry } from "../../lib/contracts/agentThreadWork";

// DB access for the `agentThreadWork` table: one row per task-linked thread (OS-2579).

type Ctx = QueryCtx | MutationCtx;

export async function getAgentThreadWorkByThread(
  ctx: Ctx,
  threadId: Id<"cliThreads">
): Promise<Doc<"agentThreadWork"> | null> {
  return ctx.db
    .query("agentThreadWork")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
}

export async function listAgentThreadWorkByTask(
  ctx: Ctx,
  projectId: Id<"projects">,
  taskId: Id<"tasks">
): Promise<Doc<"agentThreadWork">[]> {
  return ctx.db
    .query("agentThreadWork")
    .withIndex("by_project_and_task", (q) => q.eq("projectId", projectId).eq("taskId", taskId))
    .collect();
}

export type AgentThreadWorkRow = AgentThreadWorkEntry & { projectId: Id<"projects">; taskId: Id<"tasks"> };

export async function insertAgentThreadWork(ctx: MutationCtx, row: AgentThreadWorkRow): Promise<void> {
  await ctx.db.insert("agentThreadWork", row);
}

/** Replaces the whole row, so optional agent fields can't outlive the entry they came from. */
export async function replaceAgentThreadWork(
  ctx: MutationCtx,
  id: Id<"agentThreadWork">,
  row: AgentThreadWorkRow
): Promise<void> {
  await ctx.db.replace("agentThreadWork", id, row);
}

export async function deleteAgentThreadWork(ctx: MutationCtx, id: Id<"agentThreadWork">): Promise<void> {
  await ctx.db.delete("agentThreadWork", id);
}

export async function deleteAgentThreadWorkByTask(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  taskId: Id<"tasks">
): Promise<void> {
  for (const row of await listAgentThreadWorkByTask(ctx, projectId, taskId)) {
    await ctx.db.delete("agentThreadWork", row._id);
  }
}
