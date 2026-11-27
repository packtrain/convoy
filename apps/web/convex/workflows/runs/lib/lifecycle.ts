import { ConvexError } from "convex/values";
import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { ComposerContent } from "../../../lib/contracts/composerContent";
import { attachedPullRequestUrl } from "../../../lib/contracts/github";
import type { CliScriptRequest, CliScriptResult, CliThreadAggregateStatus } from "../../../lib/contracts/validators";
import type { WorkflowStep } from "../../../lib/contracts/workflowDefinition";
import { getMessageById, listRunMessages } from "../../../cli/lib/cliMessagesRepo";
import { getOnlineSessionForProfile } from "../../../cli/lib/cliSessionsRepo";
import {
  getThreadById,
  getWorkflowRunContainer,
  setContainerAggregateStatus,
  setThreadWorkflowWaitParked,
} from "../../../cli/threads/lib/cliThreadsRepo";
import { errors } from "../../errors";
import { getWorkflowById } from "../../lib/workflowsRepo";
import { getWorkflowVersionById } from "../../lib/versionsRepo";
import { listLanesByRun, setLaneThread, setLaneWaitParked } from "./runLanesRepo";
import {
  bumpWorkflowRunActivity,
  getWorkflowRunById,
  markWorkflowRunCanceled,
  markWorkflowRunCompleted,
  markWorkflowRunNeedsAttention,
  markWorkflowRunRunning,
} from "./runsRepo";
import {
  dispatchableSteps,
  laneHeadStep,
  listStepsByRun,
  markStepCanceled,
  markStepCompleted,
  markStepDispatched,
  markStepFailed,
  markStepRevived,
  markStepWaiting,
  setStepUserMessage,
} from "./runStepsRepo";
import { resolveStepDefinition, resolveStepPrompt } from "./resolution";
import { laneThreadTitle, stepTitle } from "./naming";

/**
 * Thread fan-out cap per advance (docs/specs/workflows.md → Orchestration): a
 * parallel stage can hold 50 steps, so one transaction dispatches at most this
 * many and reschedules itself for the rest, bounding its writes. Leftovers
 * stay `pending` — the barrier is unaffected.
 */
const MAX_DISPATCHES_PER_ADVANCE = 10;

/**
 * Run-invariant reads memoized per advance instead of re-fetched per
 * dispatched step: the pinned version, and the container + workflow rows
 * that only thread creation needs. `undefined` = not read yet.
 */
type DispatchReads = {
  version?: Doc<"workflowVersions"> | null;
  naming?: { containerId: Id<"cliThreads">; workflowName: string };
  /** The run profile's online session, `null` when none is (OS-1895). */
  session?: Doc<"cliSessions"> | null;
};

/**
 * The run engine (docs/specs/workflows.md → Orchestration, OS-1868/OS-1869):
 * settle running steps against their thread's current state, then dispatch
 * each idle, unheld lane's next pending step within the earliest unfinished
 * stage — the stage barrier. Scheduled from the `cliThreadsRepo` write seams
 * and from run start; idempotent because everything is re-derived from
 * current DB state, so concurrent triggers converge.
 *
 * Run status is derived, not event-driven: `running` while any lane can move,
 * `needs_attention` when nothing moves without the user. The container dot
 * flips to `needs_attention` earlier — as soon as any lane waits on the user
 * (docs/specs/workflows.md → Step / run lifecycle).
 */
export async function advanceWorkflowRun(ctx: MutationCtx, runId: Id<"workflowRuns">): Promise<void> {
  const run = await getWorkflowRunById(ctx, runId);
  // Terminal runs stay put; a parked run enters to re-derive its park (and
  // un-park after in-thread recovery or a lane resume).
  if (!run || (run.status !== "running" && run.status !== "needs_attention")) {
    return;
  }

  const now = Date.now();
  const steps = await listStepsByRun(ctx, runId);
  const reads: DispatchReads = {};

  let userTurn = false;
  for (const step of steps) {
    if (step.status === "failed" && (await stepThreadRecovered(ctx, step))) {
      await markStepRevived(ctx, step._id);
      step.status = "running";
    }
    if (step.status !== "running") {
      continue;
    }
    const settled = await settleRunningStep(ctx, run, reads, step, now);
    step.status = settled.status;
    userTurn ||= settled.userTurn;
  }

  const lanes = new Map((await listLanesByRun(ctx, runId)).map((lane) => [lane.laneId, lane]));
  // Un-park resolved waits before dispatch reuses their threads — a stale
  // marker after a dispatch would mislabel the next turn's real questions.
  await syncWaitParks(ctx, steps, lanes.values(), now);

  const unfinished = steps.filter((step) => step.status !== "completed" && step.status !== "skipped");
  if (unfinished.length === 0) {
    await markWorkflowRunCompleted(ctx, runId, now);
    await mirrorRunStatusOnContainer(ctx, runId, "idle", now);
    return;
  }

  // Stage barrier: only the earliest unfinished stage dispatches. Each lane's
  // dispatchable steps (pending at the frontier: a single lane's head, all of
  // a parallel lane's) go out unless the lane is held; a running/waiting/
  // failed head blocks a single lane only.
  let dispatchedAny = false;
  let dispatchBudget = MAX_DISPATCHES_PER_ADVANCE;
  let leftovers = false;
  for (const laneId of new Set(unfinished.map((step) => step.laneId))) {
    const lane = lanes.get(laneId);
    // Lane rows are written at run start — a step with no lane row is a
    // system bug; fail the step rather than throw the whole advance.
    if (!lane) {
      for (const step of dispatchableSteps(steps, { laneId, laneType: "single" })) {
        await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_DISPATCH_FAILED, now);
        step.status = "failed";
      }
      continue;
    }
    const dispatchable = dispatchableSteps(steps, lane);
    // The hold blocks exactly these dispatches — Resume renders on the first
    // (docs/specs/workflows.md → Lane hold).
    if (lane.hold && dispatchable.length > 0) {
      userTurn = true;
      continue;
    }
    for (const step of dispatchable) {
      if (dispatchBudget === 0) {
        leftovers = true;
        break;
      }
      dispatchBudget -= 1;
      step.status = await dispatchStep(ctx, run, reads, lane, step, now);
      dispatchedAny ||= step.status === "running";
    }
  }
  if (leftovers) {
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId });
  }
  if (dispatchedAny) {
    await bumpWorkflowRunActivity(ctx, run._id, now);
  }

  await syncWaitParks(ctx, steps, lanes.values(), now);

  // Failed and waiting steps wait on the starting user (in-thread recovery
  // or the step row's Retry/Skip; a waiting step's Approve).
  userTurn ||= steps.some((step) => step.status === "failed" || step.status === "waiting");

  if (steps.some((step) => step.status === "running")) {
    if (run.status === "needs_attention") {
      await markWorkflowRunRunning(ctx, runId, now);
    }
    await mirrorRunStatusOnContainer(ctx, runId, userTurn ? "needs_attention" : "running", now);
    return;
  }
  // Nothing moves without the user: every lane is stopped on a failed step,
  // a wait step, a hold, or the barrier behind one of those.
  await parkRun(ctx, run, now);
}

/**
 * Map a running step's thread state back onto the step. `waiting_input`,
 * `pending`, and `streaming` leave it running: the user's in-thread answer
 * finishes the same step when its run completes
 * (docs/specs/workflows.md → Step / run lifecycle). `userTurn` reports a
 * still-running thread waiting on the user (question, approval, held queue),
 * by the same watch bucket the thread's own row uses.
 */
async function settleRunningStep(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  step: Doc<"workflowRunSteps">,
  now: number
): Promise<{ status: Doc<"workflowRunSteps">["status"]; userTurn: boolean }> {
  const thread = step.threadId ? await getThreadById(ctx, step.threadId) : null;
  if (!thread || thread.isDeleted) {
    await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_THREAD_DELETED, now);
    return { status: "failed", userTurn: false };
  }
  if (thread.status === "completed" && thread.processingState === "idle" && !thread.hasPendingUserMessages) {
    const scriptStatus = await settleScriptRun(ctx, run, reads, step, thread, now);
    if (scriptStatus !== undefined) {
      return { status: scriptStatus, userTurn: false };
    }
    await markStepCompleted(ctx, step._id, now);
    return { status: "completed", userTurn: false };
  }
  if (thread.status === "failed") {
    await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_THREAD_FAILED, now);
    return { status: "failed", userTurn: false };
  }
  return { status: "running", userTurn: thread.statusProjection?.watchTowerStatus === "waiting_input" };
}

/**
 * A bash step's script run just ended (docs/specs/workflows.md → Bash steps):
 * apply `reportOutput`. `stop_on_failure` fails the step on a non-zero exit or
 * timeout; `on_failure`/`always` send the output tail to the lane's agent as
 * the starting user, and the step finishes with that turn. Returns undefined
 * when the completed run was no script run — a prompt step, or the report
 * turn itself — so the caller completes the step.
 */
async function settleScriptRun(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  step: Doc<"workflowRunSteps">,
  thread: Doc<"cliThreads">,
  now: number
): Promise<"failed" | "running" | undefined> {
  const userMessage = step.userMessageId ? await getMessageById(ctx, step.userMessageId) : null;
  if (!userMessage?.scriptRequest) {
    return undefined;
  }
  reads.version ??= await getWorkflowVersionById(ctx, run.workflowVersionId);
  const definitionStep = reads.version ? resolveStepDefinition(reads.version.definition, step) : undefined;
  if (definitionStep?.action.type !== "bash") {
    return undefined;
  }
  // The CLI writes the result onto the run's assistant message at `complete`.
  const result = userMessage.runId
    ? (await listRunMessages(ctx, thread._id, userMessage.runId)).find((message) => message.role === "assistant")?.scriptResult
    : undefined;
  const failure = !result
    ? errors.WORKFLOW_STEP_SCRIPT_FAILED
    : result.timedOut
      ? errors.WORKFLOW_STEP_SCRIPT_TIMED_OUT
      : result.exitCode !== 0
        ? errors.workflowStepScriptExited(result.exitCode)
        : undefined;
  const reportOutput = definitionStep.action.reportOutput;
  if (failure !== undefined && reportOutput === "stop_on_failure") {
    await markStepFailed(ctx, step._id, failure, now);
    return "failed";
  }
  if (failure === undefined && reportOutput !== "always") {
    return undefined;
  }
  try {
    const reportMessageId: Id<"cliMessages"> = await ctx.runMutation(internal.cli.messages.sendForWorkflowStep, {
      threadId: thread._id,
      userId: run.startedBy,
      content: scriptReport(stepTitle(definitionStep, undefined), definitionStep.action.script, result),
      cliMode: step.resolvedExecution?.mode,
      cliModel: step.resolvedExecution?.cliModel,
      cliEffort: step.resolvedExecution?.cliEffort,
      workflowRunStepId: step._id,
    });
    await setStepUserMessage(ctx, step._id, reportMessageId);
  } catch (error) {
    // The report is a dispatch.
    return failStepOnDispatchError(ctx, step, error, now);
  }
  return "running";
}

/**
 * The report turn's text: what the script did, the script itself (the agent
 * never saw the request turn), then the output tail the CLI kept.
 */
function scriptReport(title: string, script: string, result: CliScriptResult | undefined): string {
  const outcome = !result ? "reported no result" : result.timedOut ? "timed out" : `exited with code ${result.exitCode}`;
  const tail = result?.outputTail.trim() ?? "";
  return `Workflow script "${title}" ${outcome}.\n\n\`\`\`bash\n${script}\n\`\`\`${tail ? `\n\n\`\`\`\n${tail}\n\`\`\`` : "\n\n(no output)"}`;
}

/**
 * A step failed because its thread run failed, and the user acted in the
 * thread (retry or a new prompt) so the thread left `failed`: the step
 * re-attaches and its thread's next completion finishes it. Dispatch failures
 * and deleted threads stay failed — nothing in the thread can complete a
 * prompt that never landed; only the step row's Retry/Skip un-parks them.
 */
async function stepThreadRecovered(ctx: MutationCtx, step: Doc<"workflowRunSteps">): Promise<boolean> {
  if (step.errorMessage !== errors.WORKFLOW_STEP_THREAD_FAILED || step.threadId === undefined) {
    return false;
  }
  const thread = await getThreadById(ctx, step.threadId);
  return thread !== null && !thread.isDeleted && thread.status !== "failed";
}

/**
 * Park each idle lane thread whose head step waits for the starting user as
 * `waiting_input`, and un-park once the wait resolves. The park is stored on
 * the lane (`waitParkedAt`), never inferred from the thread: the cli domain
 * writes `waiting_input` for its own reasons (docs/specs/workflows.md → Wait steps).
 */
async function syncWaitParks(
  ctx: MutationCtx,
  steps: Doc<"workflowRunSteps">[],
  lanes: Iterable<Doc<"workflowRunLanes">>,
  now: number
): Promise<void> {
  for (const lane of lanes) {
    if (lane.threadId === undefined) {
      continue;
    }
    const thread = await getThreadById(ctx, lane.threadId);
    if (!thread || thread.isDeleted || thread.processingState !== "idle" || thread.hasPendingUserMessages) {
      continue;
    }
    const head = laneHeadStep(steps, lane.laneId);
    if (head?.status === "waiting" && thread.status === "completed") {
      if (lane.waitParkedAt === undefined) {
        lane.waitParkedAt = now;
        await setLaneWaitParked(ctx, lane._id, now);
      }
      await setThreadWorkflowWaitParked(ctx, lane.threadId, true, now);
    } else if (head?.status !== "waiting" && lane.waitParkedAt !== undefined) {
      lane.waitParkedAt = undefined;
      await setLaneWaitParked(ctx, lane._id, undefined);
      if (thread.status === "waiting_input") {
        await setThreadWorkflowWaitParked(ctx, lane.threadId, false, now);
      }
    }
  }
}

/** Send one step into its lane; the caller derives run status from the returned step status. */
async function dispatchStep(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  lane: Doc<"workflowRunLanes">,
  step: Doc<"workflowRunSteps">,
  now: number
): Promise<Doc<"workflowRunSteps">["status"]> {
  if (reads.version === undefined) {
    reads.version = await getWorkflowVersionById(ctx, run.workflowVersionId);
  }
  const version = reads.version;
  const definitionStep = version ? resolveStepDefinition(version.definition, step) : undefined;
  // Versions are immutable — a row that no longer resolves is a system bug.
  // Fail the one step rather than throw: a throw here rolls back the whole
  // advance (including other lanes' settles) and replays forever.
  if (!version || !definitionStep) {
    await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_DISPATCH_FAILED, now);
    return "failed";
  }

  if (definitionStep.action.type === "wait") {
    await markStepWaiting(ctx, step._id, lane.threadId, now);
    return "waiting";
  }
  // Same treatment: a resolved row without its runtime is a system bug.
  const execution = step.resolvedExecution;
  if (!execution) {
    await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_DISPATCH_FAILED, now);
    return "failed";
  }
  let prompt: ComposerContent | undefined;
  let scriptRequest: CliScriptRequest | undefined;
  if (definitionStep.action.type === "bash") {
    // Trust is mode-gated at execution (docs/specs/workflows.md → Bash steps):
    // a single lane's act mode runs the script unprompted, any other mode holds
    // it as a waiting step for the starting user. Parallel lanes have no mode
    // and run unprompted.
    if (lane.laneType === "single" && execution.mode !== "agent" && step.approvedAt === undefined) {
      // A first script held before dispatch still gets its lane thread (OS-1920),
      // so Approve renders in a transcript; the same advance wait-parks it.
      if (lane.threadId === undefined) {
        try {
          lane.threadId = await createEmptyLaneThread(ctx, run, reads, lane, version, execution);
        } catch (error) {
          return failStepOnDispatchError(ctx, step, error, now);
        }
        await setLaneThread(ctx, lane._id, lane.threadId);
      }
      await markStepWaiting(ctx, step._id, lane.threadId, now);
      return "waiting";
    }
    // The script text is the message the transcript shows.
    prompt = { displayContent: definitionStep.action.script };
    scriptRequest = { script: definitionStep.action.script, timeoutMs: definitionStep.action.timeoutMs };
  } else {
    // A runtime the online CLI does not advertise fails here with the reason
    // (OS-1895); with no session online the prompt queues until one connects.
    if (!(await sessionRunsCliType(ctx, run, reads, execution.cliType))) {
      await markStepFailed(ctx, step._id, errors.workflowStepRuntimeUnavailable(execution.cliType), now);
      return "failed";
    }
    prompt = resolveStepPrompt(definitionStep, step);
  }
  // A resolved prompt step without its prompt is the same system bug.
  if (!prompt) {
    await markStepFailed(ctx, step._id, errors.WORKFLOW_STEP_DISPATCH_FAILED, now);
    return "failed";
  }

  let dispatch: { threadId: Id<"cliThreads">; userMessageId: Id<"cliMessages"> };
  try {
    // A parallel lane is a burst of one-shot threads the lane row never owns;
    // a single lane creates its one thread lazily on first dispatch.
    if (lane.laneType === "parallel" || lane.threadId === undefined) {
      dispatch = await createLaneThread(ctx, run, reads, lane, step, definitionStep, version, prompt, execution, scriptRequest);
      if (lane.laneType !== "parallel") {
        await setLaneThread(ctx, lane._id, dispatch.threadId);
      }
    } else {
      const userMessageId: Id<"cliMessages"> = await ctx.runMutation(internal.cli.messages.sendForWorkflowStep, {
        threadId: lane.threadId,
        userId: run.startedBy,
        content: prompt.displayContent,
        composerDocument: prompt.composerDocument,
        cliMode: execution.mode,
        cliModel: execution.cliModel,
        cliEffort: execution.cliEffort,
        workflowRunStepId: step._id,
        scriptRequest,
      });
      dispatch = { threadId: lane.threadId, userMessageId };
    }
  } catch (error) {
    return failStepOnDispatchError(ctx, step, error, now);
  }
  await markStepDispatched(ctx, step, dispatch, now);
  return "running";
}

/**
 * Lane-thread creation (docs/specs/workflows.md → Threads), through the cli
 * domain's internal boundary: a single lane's one lazily-created thread, or
 * a parallel-lane step's own. Titled Workflow — Lane; a parallel lane's
 * threads add the step, since the lane name alone would repeat.
 */
async function createLaneThread(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  lane: Doc<"workflowRunLanes">,
  step: Doc<"workflowRunSteps">,
  definitionStep: WorkflowStep,
  version: Doc<"workflowVersions">,
  prompt: ComposerContent,
  execution: NonNullable<Doc<"workflowRunSteps">["resolvedExecution"]>,
  scriptRequest: CliScriptRequest | undefined
): Promise<{ threadId: Id<"cliThreads">; userMessageId: Id<"cliMessages"> }> {
  const naming = await laneNaming(ctx, run, reads);
  const title = laneThreadTitle(
    naming.workflowName,
    laneName(version, lane),
    lane.laneType === "parallel" ? stepTitle(definitionStep, prompt.displayContent) : undefined
  );
  return ctx.runMutation(internal.cli.threads.core.createForWorkflowLane, {
    ...laneThreadSelection(run, lane, execution, naming, title),
    content: prompt.displayContent,
    composerDocument: prompt.composerDocument,
    workflowLaneType: lane.laneType,
    workflowRunStepId: step._id,
    scriptRequest,
  });
}

/** Whether the run profile's online session advertises `cliType`; true with no session online (the queued-until-connect rule). */
async function sessionRunsCliType(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  cliType: NonNullable<Doc<"workflowRunSteps">["resolvedExecution"]>["cliType"]
): Promise<boolean> {
  if (reads.session === undefined) {
    reads.session = await getOnlineSessionForProfile(ctx, run.selection.profileId);
  }
  return reads.session === null || reads.session.availableClis.some((cli) => cli.type === cliType);
}

/** A single lane's thread with no message yet (OS-1920): opened when the gate holds its first script. */
async function createEmptyLaneThread(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  reads: DispatchReads,
  lane: Doc<"workflowRunLanes">,
  version: Doc<"workflowVersions">,
  execution: NonNullable<Doc<"workflowRunSteps">["resolvedExecution"]>
): Promise<Id<"cliThreads">> {
  const naming = await laneNaming(ctx, run, reads);
  const title = laneThreadTitle(naming.workflowName, laneName(version, lane), undefined);
  return ctx.runMutation(internal.cli.threads.core.createEmptyForWorkflowLane, laneThreadSelection(run, lane, execution, naming, title));
}

/** What every lane thread is created from: the run's selection and checkout, the step's runtime, its place under the container. */
function laneThreadSelection(
  run: Doc<"workflowRuns">,
  lane: Doc<"workflowRunLanes">,
  execution: NonNullable<Doc<"workflowRunSteps">["resolvedExecution"]>,
  naming: NonNullable<DispatchReads["naming"]>,
  title: string
) {
  return {
    userId: run.startedBy,
    profileId: run.selection.profileId,
    pathId: run.selection.workspace.pathId,
    // One shared checkout per run; lane threads carry the run's worktree spec.
    worktree: run.selection.workspace.worktree,
    cliType: execution.cliType,
    cliMode: execution.mode,
    cliModel: execution.cliModel,
    cliEffort: execution.cliEffort,
    taskId: run.attachedTaskId,
    pullRequestUrl: run.attachedPullRequest ? attachedPullRequestUrl(run.attachedPullRequest) : undefined,
    agentWorkSource: "workflow_run" as const,
    projectAgentId: execution.projectAgentId,
    title,
    parentThreadId: naming.containerId,
    workflowRunId: run._id,
    workflowLaneId: lane.laneId,
  };
}

/** A dispatch the cli domain refused (revoked access, removed profile, …) fails the step with its reason instead of crashing the advance. */
async function failStepOnDispatchError(ctx: MutationCtx, step: Doc<"workflowRunSteps">, error: unknown, now: number): Promise<"failed"> {
  await markStepFailed(ctx, step._id, error instanceof ConvexError ? String(error.data) : errors.WORKFLOW_STEP_DISPATCH_FAILED, now);
  return "failed";
}

function laneName(version: Doc<"workflowVersions">, lane: Doc<"workflowRunLanes">): string | undefined {
  return version.definition.lanes.find((candidate) => candidate.laneId === lane.laneId)?.name;
}

async function laneNaming(ctx: MutationCtx, run: Doc<"workflowRuns">, reads: DispatchReads): Promise<NonNullable<DispatchReads["naming"]>> {
  if (reads.naming === undefined) {
    const container = await getWorkflowRunContainer(ctx, run._id);
    if (!container) {
      throw new Error(`Workflow run ${run._id} has no container thread`);
    }
    // Soft-deleted workflows keep naming their runs' threads — read the row as-is.
    const workflow = await getWorkflowById(ctx, run.workflowId);
    reads.naming = { containerId: container._id, workflowName: workflow?.name ?? "Workflow" };
  }
  return reads.naming;
}

/**
 * How many threads one stop-treatment transaction visits. A run accumulates a
 * thread per parallel step, and each stop reads the thread plus its pending
 * messages — unbatched, a long run's cancel would blow the transaction read
 * budget and roll the cancel itself back.
 */
const STOP_THREADS_BATCH = 10;

/**
 * Cancel a run (docs/specs/workflows.md → Cancel): terminal, in-flight steps
 * flip to `canceled`, and every run thread — single-lane and per-step — gets
 * the Stop button's treatment, in scheduled batches; a wait-parked thread is
 * un-parked instead. Callers verify who may cancel; `canceledBy` is the acting
 * user (the deleter on a workflow soft delete), so the starter's notification
 * isn't self-suppressed.
 */
export async function cancelWorkflowRun(
  ctx: MutationCtx,
  run: Doc<"workflowRuns">,
  canceledBy: Id<"users">,
  now: number
): Promise<void> {
  await markWorkflowRunCanceled(ctx, run._id, now);
  const steps = await listStepsByRun(ctx, run._id);
  for (const step of steps) {
    if (step.status === "running" || step.status === "waiting") {
      await markStepCanceled(ctx, step._id, now);
    }
  }
  const lanes = await listLanesByRun(ctx, run._id);
  const threadIds = new Set([...lanes, ...steps].flatMap((row) => row.threadId ?? []));
  // Un-parking is per lane, so it stays inline; a parked thread that is really
  // idle in `waiting_input` needs no stop, only its marker cleared.
  for (const lane of lanes) {
    if (lane.waitParkedAt === undefined) {
      continue;
    }
    await setLaneWaitParked(ctx, lane._id, undefined);
    if (lane.threadId === undefined) {
      continue;
    }
    const thread = await getThreadById(ctx, lane.threadId);
    if (thread && !thread.isDeleted && thread.status === "waiting_input" && thread.processingState === "idle") {
      await setThreadWorkflowWaitParked(ctx, lane.threadId, false, now);
      threadIds.delete(lane.threadId);
    }
  }
  // The stop treatment runs after the cancel commits: a wide run's thread
  // count must not decide whether the cancel lands.
  if (threadIds.size > 0) {
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.stopRunThreads, { threadIds: [...threadIds], canceledBy });
  }
  const container = await getWorkflowRunContainer(ctx, run._id);
  if (container) {
    await setContainerAggregateStatus(ctx, container._id, "idle", now);
  }
}

/** One stop-treatment batch for a canceled run's threads; reschedules itself with the remainder. Idle, finished, and deleted threads no-op inside. */
export async function stopCanceledRunThreads(
  ctx: MutationCtx,
  threadIds: Id<"cliThreads">[],
  canceledBy: Id<"users">
): Promise<void> {
  for (const threadId of threadIds.slice(0, STOP_THREADS_BATCH)) {
    await ctx.runMutation(internal.cli.threads.runControl.cancelProcessingForWorkflowRun, { threadId, userId: canceledBy });
  }
  const rest = threadIds.slice(STOP_THREADS_BATCH);
  if (rest.length > 0) {
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.stopRunThreads, { threadIds: rest, canceledBy });
  }
}

async function parkRun(ctx: MutationCtx, run: Doc<"workflowRuns">, now: number): Promise<void> {
  // Same-value guard as the container mirror: a parked run re-parks on every
  // advance, and an identical patch would churn run subscribers and
  // `lastActivityAt` ordering.
  if (run.status !== "needs_attention") {
    await markWorkflowRunNeedsAttention(ctx, run._id, now);
  }
  await mirrorRunStatusOnContainer(ctx, run._id, "needs_attention", now);
}

/**
 * The container mirrors run status, written by the runs domain at its own
 * seams (docs/specs/workflow-data-schema.md). Skips same-value writes: the
 * advance mirrors on every pass of a live run, and an identical patch would
 * invalidate every thread-list subscriber.
 */
async function mirrorRunStatusOnContainer(
  ctx: MutationCtx,
  runId: Id<"workflowRuns">,
  aggregateStatus: CliThreadAggregateStatus,
  now: number
): Promise<void> {
  const container = await getWorkflowRunContainer(ctx, runId);
  if (container && container.aggregateStatus !== aggregateStatus) {
    await setContainerAggregateStatus(ctx, container._id, aggregateStatus, now);
  }
}
