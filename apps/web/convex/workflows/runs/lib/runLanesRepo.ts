import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { getWorkflowRunById } from "./runsRepo";
import { laneThreadStep, listStepsByRun } from "./runStepsRepo";

type Ctx = QueryCtx | MutationCtx;

/** DB access for the `workflowRunLanes` table — no caller touches `ctx.db` directly. */

/** All of a run's lanes in definition column order. Bounded: at most 12 lanes per definition. */
export async function listLanesByRun(ctx: Ctx, runId: Id<"workflowRuns">): Promise<Doc<"workflowRunLanes">[]> {
  const lanes = await ctx.db
    .query("workflowRunLanes")
    .withIndex("by_run_and_laneId", (q) => q.eq("runId", runId))
    .collect();
  return lanes.sort((a, b) => a.laneOrder - b.laneOrder);
}

export async function getLaneByRunAndLaneId(ctx: Ctx, runId: Id<"workflowRuns">, laneId: string): Promise<Doc<"workflowRunLanes"> | null> {
  return ctx.db
    .query("workflowRunLanes")
    .withIndex("by_run_and_laneId", (q) => q.eq("runId", runId).eq("laneId", laneId))
    .unique();
}

/** Attach a lane's lazily-created thread (docs/specs/workflows.md → Threads). Re-pointed only after a delete + `retryStep`. */
export async function setLaneThread(ctx: MutationCtx, laneId: Id<"workflowRunLanes">, threadId: Id<"cliThreads">): Promise<void> {
  await ctx.db.patch("workflowRunLanes", laneId, { threadId });
}

/** The lane's thread was deleted and its step retried (`retryStep`): the next dispatch creates a fresh one. */
export async function clearLaneThread(ctx: MutationCtx, laneId: Id<"workflowRunLanes">): Promise<void> {
  await ctx.db.patch("workflowRunLanes", laneId, { threadId: undefined });
}

/**
 * A manual user message entered a lane thread of a live run: hold the lane
 * until the starting user resumes it (docs/specs/workflows.md → Lane hold).
 * The first trigger wins. Decided per lane, not per run — a parked run's
 * healthy lanes still take holds. Judged by the thread's own step (a parallel
 * lane runs several): one that is `failed` (recovery, → In-thread recovery)
 * or `waiting` (own Approve, → Wait steps) takes none — not steering. A
 * thread serving no step (a finished one-shot) still steers the run's shared
 * checkout, so it holds.
 */
export async function holdLaneForManualMessage(
  ctx: MutationCtx,
  args: {
    runId: Id<"workflowRuns">;
    laneId: string;
    thread: Pick<Doc<"cliThreads">, "_id" | "workflowRunStepId">;
    triggeringMessageId: Id<"cliMessages">;
    now: number;
  }
): Promise<void> {
  const run = await getWorkflowRunById(ctx, args.runId);
  if (!run || (run.status !== "running" && run.status !== "needs_attention")) {
    return;
  }
  const lane = await getLaneByRunAndLaneId(ctx, args.runId, args.laneId);
  if (!lane || lane.hold) {
    return;
  }
  const threadStep = laneThreadStep(await listStepsByRun(ctx, args.runId), args.laneId, args.thread);
  if (threadStep && (threadStep.status === "failed" || threadStep.status === "waiting")) {
    return;
  }
  await ctx.db.patch("workflowRunLanes", lane._id, {
    hold: { heldAt: args.now, triggeringMessageId: args.triggeringMessageId },
  });
}

/** The starting user resumed a held lane (`resumeLane`). */
export async function clearLaneHold(ctx: MutationCtx, laneId: Id<"workflowRunLanes">): Promise<void> {
  await ctx.db.patch("workflowRunLanes", laneId, { hold: undefined });
}

/** The engine's stored wait-park handshake (docs/specs/workflows.md → Wait steps): set on park, cleared on un-park. */
export async function setLaneWaitParked(ctx: MutationCtx, laneId: Id<"workflowRunLanes">, parkedAt: number | undefined): Promise<void> {
  await ctx.db.patch("workflowRunLanes", laneId, { waitParkedAt: parkedAt });
}

export async function insertWorkflowRunLane(
  ctx: MutationCtx,
  lane: {
    runId: Id<"workflowRuns">;
    laneId: string;
    laneType: Doc<"workflowRunLanes">["laneType"];
    laneOrder: number;
  }
): Promise<Id<"workflowRunLanes">> {
  return ctx.db.insert("workflowRunLanes", lane);
}
