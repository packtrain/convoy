import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { ComposerContent } from "../../../lib/contracts/composerContent";
import type { ResolvedExecution } from "../../../lib/contracts/workflowRuns";

type Ctx = QueryCtx | MutationCtx;

/** DB access for the `workflowRunSteps` table — no caller touches `ctx.db` directly. */

/**
 * All of a run's steps in execution order (stage, then lane, then step).
 * Bounded by the definition caps (≤ 50 stages × 50 steps), not paginated: the
 * Run view renders them all.
 */
export async function getWorkflowRunStepById(ctx: Ctx, stepId: Id<"workflowRunSteps">): Promise<Doc<"workflowRunSteps"> | null> {
  return ctx.db.get("workflowRunSteps", stepId);
}

export async function listStepsByRun(ctx: Ctx, runId: Id<"workflowRuns">): Promise<Doc<"workflowRunSteps">[]> {
  return ctx.db
    .query("workflowRunSteps")
    .withIndex("by_run_and_stageOrder_and_laneOrder_and_stepOrder", (q) => q.eq("runId", runId))
    .collect();
}

/**
 * A lane's head: its first unfinished step, in `listStepsByRun`'s execution
 * order. The head's status is the lane's state — running/waiting/failed
 * blocks the lane, pending means it is up next.
 */
export function laneHeadStep(steps: Doc<"workflowRunSteps">[], laneId: string): Doc<"workflowRunSteps"> | undefined {
  return steps.find((step) => step.laneId === laneId && step.status !== "completed" && step.status !== "skipped");
}

/**
 * The step a lane thread's message acts on. A Parallel-Lane one-shot carries
 * its one step from creation — finished, the thread serves none (never a
 * sibling's). A single lane's thread serves the lane's head, which has no
 * thread of its own before dispatch.
 */
export function laneThreadStep(
  steps: Doc<"workflowRunSteps">[],
  laneId: string,
  thread: Pick<Doc<"cliThreads">, "_id" | "workflowRunStepId">
): Doc<"workflowRunSteps"> | undefined {
  if (thread.workflowRunStepId !== undefined) {
    const own = steps.find((step) => step._id === thread.workflowRunStepId);
    return own !== undefined && own.status !== "completed" && own.status !== "skipped" ? own : undefined;
  }
  return (
    steps.find((step) => step.laneId === laneId && step.threadId === thread._id && step.status !== "completed" && step.status !== "skipped") ??
    laneHeadStep(steps, laneId)
  );
}

/**
 * The steps a lane dispatches next: pending at the earliest unfinished stage
 * (the barrier) — a single lane's head only, every such step of a parallel
 * lane (docs/specs/workflows.md → Lane types). One rule for the engine's
 * dispatch loop and the Run view's `held` marker, so Resume always sits on
 * a step the hold actually blocks (→ Lane hold).
 */
export function dispatchableSteps(
  steps: Doc<"workflowRunSteps">[],
  lane: Pick<Doc<"workflowRunLanes">, "laneId" | "laneType">
): Doc<"workflowRunSteps">[] {
  const unfinished = steps.filter((step) => step.status !== "completed" && step.status !== "skipped");
  if (unfinished.length === 0) {
    return [];
  }
  const frontierStage = Math.min(...unfinished.map((step) => step.stageOrder));
  if (lane.laneType === "parallel") {
    return unfinished.filter((step) => step.laneId === lane.laneId && step.status === "pending" && step.stageOrder === frontierStage);
  }
  const head = unfinished.find((step) => step.laneId === lane.laneId);
  return head?.status === "pending" && head.stageOrder === frontierStage ? [head] : [];
}

/** A step's prompt went into its lane's thread — the engine dispatched it (OS-1868). */
export async function markStepDispatched(
  ctx: MutationCtx,
  step: Doc<"workflowRunSteps">,
  dispatch: { threadId: Id<"cliThreads">; userMessageId: Id<"cliMessages"> },
  now: number
): Promise<void> {
  await ctx.db.patch("workflowRunSteps", step._id, {
    status: "running",
    threadId: dispatch.threadId,
    userMessageId: dispatch.userMessageId,
    attemptCount: step.attemptCount + 1,
    startedAt: now,
  });
}

export async function markStepCompleted(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, now: number): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "completed", finishedAt: now });
}

export async function markStepFailed(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, errorMessage: string, now: number): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "failed", errorMessage, finishedAt: now });
}

/** A failed step's thread recovered in-thread (docs/specs/workflows.md → In-thread recovery): re-attach and let settle finish it. */
export async function markStepRevived(ctx: MutationCtx, stepId: Id<"workflowRunSteps">): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "running", errorMessage: undefined, finishedAt: undefined });
}

/** The starting user skipped a failed step (`skipStep`); skipped satisfies the stage barrier. */
export async function markStepSkipped(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, now: number): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "skipped", finishedAt: now });
}

/** Explicit retry of a step whose prompt never landed (`retryStep`): back to pending for a fresh dispatch. */
export async function markStepRetried(ctx: MutationCtx, stepId: Id<"workflowRunSteps">): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, {
    status: "pending",
    errorMessage: undefined,
    threadId: undefined,
    userMessageId: undefined,
    assistantMessageId: undefined,
    startedAt: undefined,
    finishedAt: undefined,
  });
}

/**
 * A wait-for-human step reached the front of its lane (`approveStep` releases
 * it). Carries the lane's thread — where the wait card renders — when one
 * exists; a lane whose earlier steps never created a thread waits threadless.
 */
export async function markStepWaiting(
  ctx: MutationCtx,
  stepId: Id<"workflowRunSteps">,
  threadId: Id<"cliThreads"> | undefined,
  now: number
): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "waiting", threadId, startedAt: now });
}

/** The starting user approved a bash step's script (`approveStep`): back to pending, marked, for the next advance to dispatch. */
export async function markStepApproved(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, now: number): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "pending", approvedAt: now });
}

/** A bash step's report went into the lane thread as a user message; the step now finishes with that run. */
export async function setStepUserMessage(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, userMessageId: Id<"cliMessages">): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { userMessageId });
}

/** The run was canceled while this step was in flight (docs/specs/workflows.md → Cancel). */
export async function markStepCanceled(ctx: MutationCtx, stepId: Id<"workflowRunSteps">, now: number): Promise<void> {
  await ctx.db.patch("workflowRunSteps", stepId, { status: "canceled", finishedAt: now });
}

export async function insertWorkflowRunStep(
  ctx: MutationCtx,
  step: {
    runId: Id<"workflowRuns">;
    stageId: string;
    laneId: string;
    definitionStepId: string;
    stageOrder: number;
    laneOrder: number;
    stepOrder: number;
    promptOverride?: ComposerContent;
    resolvedExecution?: ResolvedExecution;
  }
): Promise<Id<"workflowRunSteps">> {
  return ctx.db.insert("workflowRunSteps", {
    ...step,
    status: "pending",
    attemptCount: 0,
  });
}
