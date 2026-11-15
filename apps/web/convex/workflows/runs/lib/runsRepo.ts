import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { RunSelection } from "../../../lib/contracts/workflowRuns";

type Ctx = QueryCtx | MutationCtx;

/** DB access for the `workflowRuns` table — no caller touches `ctx.db` directly. */

export async function getWorkflowRunById(ctx: Ctx, runId: Id<"workflowRuns">): Promise<Doc<"workflowRuns"> | null> {
  return ctx.db.get("workflowRuns", runId);
}

/** A workflow's runs started by one user, newest first, capped by the caller. */
export async function listRunsByWorkflowAndStarter(
  ctx: Ctx,
  workflowId: Id<"workflows">,
  startedBy: Id<"users">,
  limit: number
): Promise<Doc<"workflowRuns">[]> {
  return ctx.db
    .query("workflowRuns")
    .withIndex("by_workflow_and_startedBy_and_startedAt", (q) => q.eq("workflowId", workflowId).eq("startedBy", startedBy))
    .order("desc")
    .take(limit);
}

/**
 * A workflow's live runs across all starters — soft delete cancels them
 * (docs/specs/workflows.md → Versioning). Reads by project + live status, so
 * the scan is bounded by the project's live runs, not the run history.
 */
export async function listLiveRunsByWorkflow(
  ctx: Ctx,
  workflowId: Id<"workflows">,
  projectId: Id<"projects">
): Promise<Doc<"workflowRuns">[]> {
  const live = await Promise.all(
    (["running", "needs_attention"] as const).map((status) =>
      ctx.db
        .query("workflowRuns")
        .withIndex("by_project_and_status_and_lastActivityAt", (q) => q.eq("projectId", projectId).eq("status", status))
        .collect()
    )
  );
  return live.flat().filter((run) => run.workflowId === workflowId);
}

export async function insertWorkflowRun(
  ctx: MutationCtx,
  run: {
    workflowId: Id<"workflows">;
    workflowVersionId: Id<"workflowVersions">;
    projectId: Id<"projects">;
    startedBy: Id<"users">;
    attachedTaskId?: Id<"tasks">;
    selection: RunSelection;
  },
  now: number
): Promise<Id<"workflowRuns">> {
  return ctx.db.insert("workflowRuns", {
    ...run,
    status: "running",
    startedAt: now,
    lastActivityAt: now,
  });
}

/** Terminal cancel (docs/specs/workflows.md → Cancel): canceled runs cannot resume. */
export async function markWorkflowRunCanceled(ctx: MutationCtx, runId: Id<"workflowRuns">, now: number): Promise<void> {
  await ctx.db.patch("workflowRuns", runId, {
    status: "canceled",
    canceledAt: now,
    lastActivityAt: now,
  });
}

/** Terminal completion: every step of the final stage finished (docs/specs/workflows.md → Step / run lifecycle). */
export async function markWorkflowRunCompleted(ctx: MutationCtx, runId: Id<"workflowRuns">, now: number): Promise<void> {
  await ctx.db.patch("workflowRuns", runId, {
    status: "completed",
    completedAt: now,
    lastActivityAt: now,
  });
}

/** The engine parked the run: nothing moves without the starting user. */
export async function markWorkflowRunNeedsAttention(ctx: MutationCtx, runId: Id<"workflowRuns">, now: number): Promise<void> {
  await ctx.db.patch("workflowRuns", runId, {
    status: "needs_attention",
    lastActivityAt: now,
  });
}

/** Un-park a run: the engine re-derived that a lane can move again. */
export async function markWorkflowRunRunning(ctx: MutationCtx, runId: Id<"workflowRuns">, now: number): Promise<void> {
  await ctx.db.patch("workflowRuns", runId, {
    status: "running",
    lastActivityAt: now,
  });
}

export async function bumpWorkflowRunActivity(ctx: MutationCtx, runId: Id<"workflowRuns">, now: number): Promise<void> {
  await ctx.db.patch("workflowRuns", runId, { lastActivityAt: now });
}
