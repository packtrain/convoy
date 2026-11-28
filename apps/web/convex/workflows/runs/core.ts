import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { firstPromptStepOf, type LaneDefinition, type StepOverrides } from "../../lib/contracts/workflowDefinition";
import type { ResolvedExecution } from "../../lib/contracts/workflowRuns";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { MAX_GROUP_CHILDREN } from "../../../lib/threads/constants";
import { isValidWorktreeBranchName } from "../../../lib/threads/worktree-branches";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../../lib/access/auth";
import { authorizeProjectAccess, requireAuthorizedProject } from "../../lib/access/permissions";
import { composerContentValidator } from "../../lib/contracts/composerContent";
import { parseAttachedPullRequest } from "../../lib/contracts/github";
import { cliThreadWorktreeSpecValidator, isWorktreeParent } from "../../lib/contracts/validators";
import { ensure } from "../../lib/shared/ensure";
import { errors as cliErrors } from "../../cli/errors";
import { getCliProfileById } from "../../cli/lib/cliProfilesRepo";
import { getActiveTaskById } from "../../tasks/lib/tasksRepo";
import { attachWorkflowRunToContainer, countGroupRows, getThreadById, insertGroupContainer, insertWorkflowRunContainer, setThreadParent, unpinThread } from "../../cli/threads/lib/cliThreadsRepo";
import { errors } from "../errors";
import { getWorkflowById } from "../lib/workflowsRepo";
import { cutVersionForRun, getWorkflowVersionById } from "../lib/versionsRepo";
import { advanceWorkflowRun, cancelWorkflowRun, stopCanceledRunThreads } from "./lib/lifecycle";
import { clearLaneHold, clearLaneThread, getLaneByRunAndLaneId, insertWorkflowRunLane, listLanesByRun } from "./lib/runLanesRepo";
import { getWorkflowRunById, insertWorkflowRun, listLiveRunsByWorkflow, listRunsByWorkflowAndStarter } from "./lib/runsRepo";
import {
  getWorkflowRunStepById,
  insertWorkflowRunStep,
  listStepsByRun,
  markStepApproved,
  markStepCompleted,
  markStepRetried,
  markStepSkipped,
} from "./lib/runStepsRepo";
import { KICKOFF_STAGE_ID, KICKOFF_STAGE_ORDER, KICKOFF_STEP_ID, resolveStepDefinition } from "./lib/resolution";
import {
  toWorkflowRunDetail,
  toWorkflowRunSummary,
  workflowRunDetailValidator,
  workflowRunSummaryValidator,
} from "./lib/validators";

const RUNS_BY_WORKFLOW_LIMIT = 50;

/**
 * Start a Workflow run (docs/specs/workflows.md → Run model): cut/pin the
 * version, create the run + lane + step rows with everything pre-resolved,
 * and create the container thread the run lives under in the thread list.
 * No step is dispatched inline — the scheduled `advance` picks up the first
 * pending step.
 */
export const start = mutation({
  args: {
    workflowId: v.id("workflows"),
    sourceThreadId: v.optional(v.id("cliThreads")),
    expectedContainerId: v.optional(v.union(v.id("cliThreads"), v.null())),
    profileId: v.id("cliProfiles"),
    pathId: v.string(),
    worktree: v.optional(cliThreadWorktreeSpecValidator),
    taskId: v.optional(v.id("tasks")),
    /** A github.com PR URL or `owner/name#number`: the run's Attached pull request. */
    pullRequestUrl: v.optional(v.string()),
    // The starting composer's one permitted edit: the first lane's first prompt,
    // stored as that step's run-local override. The pinned version is untouched.
    firstPromptOverride: v.optional(composerContentValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("workflowRuns"),
    containerThreadId: v.id("cliThreads"),
  }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const workflow = await ensure(getWorkflowById(ctx, args.workflowId)).notDeleted(errors.WORKFLOW_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, workflow.projectId, ProjectPermission.CLI_THREAD);

    const source = args.sourceThreadId
      ? await ensure(getThreadById(ctx, args.sourceThreadId)).notDeleted(cliErrors.THREAD_NOT_FOUND)
      : undefined;
    let container: Doc<"cliThreads"> | undefined;
    if (source) {
      ensure(source.userId).eq(user._id, cliErrors.NOT_AUTHORIZED);
      ensure(source.projectId).eq(workflow.projectId, errors.WORKFLOW_RUN_SOURCE_DIFFERENT_PROJECT);
      ensure(source.workflowRunId).isNull(errors.WORKFLOW_RUN_SOURCE_ALREADY_BOUND);
      ensure(source.sharedAt).isNull(errors.WORKFLOW_RUN_SOURCE_SHARED);
      const containerId = source.kind === "group" ? source._id : source.parentThreadId;
      if (args.expectedContainerId !== undefined) {
        ensure(containerId).eq(args.expectedContainerId ?? undefined, errors.WORKFLOW_RUN_SOURCE_MOVED);
      }
      if (containerId) {
        container = await ensure(getThreadById(ctx, containerId)).notDeleted(cliErrors.THREAD_NOT_FOUND);
        ensure(container.userId).eq(user._id, cliErrors.NOT_AUTHORIZED);
        ensure(container.projectId).eq(workflow.projectId, errors.WORKFLOW_RUN_SOURCE_DIFFERENT_PROJECT);
        ensure(container.kind).eq("group", cliErrors.THREAD_NOT_FOUND);
        ensure(container.parentThreadId).isNull(cliErrors.THREAD_NOT_FOUND);
        ensure(container.workflowRunId).isNull(errors.WORKFLOW_RUN_SOURCE_ALREADY_BOUND);
        ensure(container.sharedAt).isNull(errors.WORKFLOW_RUN_SOURCE_SHARED);
        ensure(await countGroupRows(ctx, container._id)).lt(MAX_GROUP_CHILDREN, cliErrors.groupFull(MAX_GROUP_CHILDREN));
      }
    } else {
      ensure(args.expectedContainerId).isNull(cliErrors.THREAD_NOT_FOUND);
    }

    // Same workspace checks as thread creation (cli/threads/lib/lifecycle.ts):
    // one machine + working directory serves every lane of the run.
    const profile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(cliErrors.PROFILE_NOT_FOUND);
    ensure(profile.userId).eq(user._id, cliErrors.THREAD_PROFILE_NOT_OWNED);
    ensure(profile.projectId).eq(workflow.projectId, errors.WORKFLOW_RUN_PROFILE_DIFFERENT_PROJECT);
    const pathEntry = await ensure(profile.paths.find((p) => p.id === args.pathId)).notNull(cliErrors.PATH_NOT_FOUND_IN_PROFILE);
    if (args.worktree) {
      ensure(args.worktree.parentPathId).eq(args.pathId, cliErrors.WORKTREE_PARENT_PATH_MISMATCH);
      ensure(pathEntry.kind).notEq("worktree", cliErrors.WORKTREE_PARENT_NOT_REPO_PATH);
      ensure(isWorktreeParent(profile.paths, pathEntry)).isTrue(cliErrors.WORKTREE_PARENT_IS_FOLDER);
      ensure(isValidWorktreeBranchName(args.worktree.branch)).isTrue(cliErrors.WORKTREE_BRANCH_INVALID);
      if (args.worktree.baseRef !== undefined) {
        ensure(isValidWorktreeBranchName(args.worktree.baseRef)).isTrue(cliErrors.WORKTREE_BRANCH_INVALID);
      }
    }
    // Same rule as `requireAccessibleCliTask`: the task must live in the run's
    // project; a foreign or deleted id answers "not found", not "forbidden".
    const task = args.taskId ? await getActiveTaskById(ctx, args.taskId) : null;
    if (args.taskId && (!task || task.projectId !== workflow.projectId)) {
      throw new ConvexError("Task not found");
    }
    const pullRequest =
      args.pullRequestUrl === undefined
        ? undefined
        : await ensure(parseAttachedPullRequest(args.pullRequestUrl)).notNull(cliErrors.PULL_REQUEST_URL_INVALID);

    // Validates the draft (assertDefinitionRunnable) when it cuts a new version.
    const version = await cutVersionForRun(ctx, workflow, user._id);
    const definition = version.definition;
    const now = Date.now();

    const runId = await insertWorkflowRun(
      ctx,
      {
        workflowId: workflow._id,
        workflowVersionId: version._id,
        projectId: workflow.projectId,
        startedBy: user._id,
        attachedTaskId: task?._id,
        attachedPullRequest: pullRequest,
        selection: {
          profileId: args.profileId,
          workspace: { pathId: args.pathId, pathSnapshot: pathEntry.path, worktree: args.worktree },
        },
      },
      now
    );

    const lanesByLaneId = new Map(definition.lanes.map((lane, index) => [lane.laneId, { laneOrder: index, type: lane.type, defaults: lane.defaults }]));
    for (const [index, lane] of definition.lanes.entries()) {
      await insertWorkflowRunLane(ctx, { runId, laneId: lane.laneId, laneType: lane.type, laneOrder: index });
    }

    const overrideStep = args.firstPromptOverride ? firstPromptStepOf(definition) : undefined;
    const firstLane = lanesByLaneId.get(definition.lanes[0].laneId)!;
    // The run's runtime: the first lane's, else the first parallel prompt's.
    // Labels the container and carries a parallel lane's bash steps, whose
    // threads need a runtime the machine serves but never prompt an agent.
    const runCliType =
      definition.lanes[0].defaults?.cliType ??
      definition.stages
        .flatMap((stage) => stage.steps)
        .map((step) => (step.action.type === "prompt" ? step.action.overrides?.cliType : undefined))
        .find((cliType) => cliType !== undefined) ??
      "claude-code";
    // No prompt step to override → the text becomes the run-local Kickoff step
    // (docs/specs/workflows.md → Start): the first lane's first turn, on the
    // lane's runtime; a parallel lane's one-shot rides the run's runtime.
    if (args.firstPromptOverride && !overrideStep) {
      await insertWorkflowRunStep(ctx, {
        runId,
        stageId: KICKOFF_STAGE_ID,
        laneId: definition.lanes[0].laneId,
        definitionStepId: KICKOFF_STEP_ID,
        stageOrder: KICKOFF_STAGE_ORDER,
        laneOrder: 0,
        stepOrder: 0,
        resolvedExecution:
          firstLane.type === "parallel" ? { cliType: runCliType } : resolveExecution(firstLane, undefined, KICKOFF_STEP_ID),
        promptOverride: args.firstPromptOverride,
      });
    }
    for (const [stageOrder, stage] of definition.stages.entries()) {
      for (const [stepOrder, step] of stage.steps.entries()) {
        // assertDefinitionStructure guarantees the lane exists and the cut
        // guarantees single-lane defaults — a break here must fail the
        // start, not persist a step in the wrong lane slot or without runtime.
        const lane = lanesByLaneId.get(step.laneId);
        if (!lane) {
          throw new Error(`Workflow run step ${step.stepId} references unknown lane ${step.laneId}`);
        }
        // Lane defaults + step overrides folded once, at this boundary
        // (docs/specs/workflow-data-schema.md → Lane and override rules): a
        // single lane's step overrides only `mode`; a parallel lane's step
        // carries every setting itself.
        const resolvedExecution =
          step.action.type === "prompt"
            ? resolveExecution(lane, step.action.overrides, step.stepId)
            : step.action.type === "bash"
              ? lane.type === "parallel"
                ? { cliType: runCliType }
                : resolveExecution(lane, undefined, step.stepId)
              : undefined;
        await insertWorkflowRunStep(ctx, {
          runId,
          stageId: stage.stageId,
          laneId: step.laneId,
          definitionStepId: step.stepId,
          stageOrder,
          laneOrder: lane.laneOrder,
          stepOrder,
          resolvedExecution,
          promptOverride:
            overrideStep && overrideStep.stageId === stage.stageId && overrideStep.stepId === step.stepId
              ? args.firstPromptOverride
              : undefined,
        });
      }
    }

    const containerSelection = {
      userId: user._id,
      projectId: workflow.projectId,
      profileId: args.profileId,
      pathId: args.pathId,
      path: pathEntry.path,
      cliType: runCliType,
      workflowRunId: runId,
      associatedTaskId: task?._id,
      attachedPullRequest: pullRequest,
    };
    let containerThreadId: Id<"cliThreads">;
    if (source) {
      containerThreadId = container?._id ?? await insertGroupContainer(ctx, source, now);
      // Bind before reparenting so the child fold preserves the run's status.
      await attachWorkflowRunToContainer(ctx, containerThreadId, containerSelection, now);
      if (!container) {
        await setThreadParent(ctx, source._id, containerThreadId);
        if (source.isPinned) await unpinThread(ctx, source._id);
      }
    } else {
      containerThreadId = await insertWorkflowRunContainer(ctx, {
        ...containerSelection,
        title: workflow.name,
        originTaskId: task?._id,
      }, now);
    }

    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId });
    return { runId, containerThreadId };
  },
});

/** The cut guarantees a runtime on the lane (single) or the step (parallel) — a miss here is a system bug, so the start fails. */
function resolveExecution(
  lane: { type: LaneDefinition["type"]; defaults: LaneDefinition["defaults"] },
  overrides: StepOverrides | undefined,
  stepId: string
): ResolvedExecution {
  // Fields listed explicitly, not spread: the override and defaults shapes
  // are allowed to grow past what an execution stores.
  if (lane.type === "parallel") {
    if (!overrides?.cliType) {
      throw new Error(`Workflow run step ${stepId} has no runtime to resolve`);
    }
    return {
      cliType: overrides.cliType,
      cliModel: overrides.cliModel,
      cliEffort: overrides.cliEffort,
      projectAgentId: overrides.projectAgentId,
      mode: overrides.mode,
    };
  }
  if (!lane.defaults) {
    throw new Error(`Workflow run step ${stepId} has no lane runtime to resolve`);
  }
  return {
    cliType: lane.defaults.cliType,
    cliModel: lane.defaults.cliModel,
    cliEffort: lane.defaults.cliEffort,
    projectAgentId: lane.defaults.projectAgentId,
    mode: overrides?.mode ?? lane.defaults.mode,
  };
}

/**
 * The run engine's single entry point (docs/specs/workflows.md →
 * Orchestration): scheduled from run start and from the `cliThreadsRepo`
 * write seams whenever a run-bound thread's lifecycle moves. Logic lives in
 * `lib/lifecycle.ts`; idempotent, so concurrent triggers converge.
 */
export const advance = internalMutation({
  args: { runId: v.id("workflowRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await advanceWorkflowRun(ctx, args.runId);
    return null;
  },
});

/**
 * Cancel a run (docs/specs/workflows.md → Cancel). Only the starting user;
 * terminal and idempotent — a canceled run stays canceled, a completed run
 * refuses. Full cancel (OS-1871): in-flight steps flip to `canceled` and
 * each lane thread gets the stop treatment, in `cancelWorkflowRun`.
 */
export const cancel = mutation({
  args: { runId: v.id("workflowRuns"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const run = await ensure(getWorkflowRunById(ctx, args.runId)).notNull(errors.WORKFLOW_RUN_NOT_FOUND);
    // Membership before identity: an outsider must not learn who a run belongs to.
    await requireAuthorizedProject(ctx, principal, run.projectId, ProjectPermission.CLI_THREAD);
    ensure(run.startedBy).eq(user._id, errors.WORKFLOW_RUN_NOT_STARTER);

    if (run.status === "canceled") {
      return null;
    }
    ensure(run.status).notEq("completed", errors.WORKFLOW_RUN_ALREADY_FINISHED);

    await cancelWorkflowRun(ctx, run, user._id, Date.now());
    return null;
  },
});

/**
 * A canceled run's thread stops, batched (docs/specs/workflows.md → Cancel):
 * `cancelWorkflowRun` commits terminal state and schedules this to apply the
 * stop treatment a few threads per transaction, rescheduling the remainder.
 */
export const stopRunThreads = internalMutation({
  args: { threadIds: v.array(v.id("cliThreads")), canceledBy: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await stopCanceledRunThreads(ctx, args.threadIds, args.canceledBy);
    return null;
  },
});

/**
 * Workflow soft delete cancels the workflow's live runs, across all starters
 * (docs/specs/workflows.md → Versioning). The runs module's boundary for
 * `workflows/core.ts`, whose `remove` already checked edit permission.
 */
export const cancelRunsForDeletedWorkflow = internalMutation({
  args: { workflowId: v.id("workflows"), projectId: v.id("projects"), canceledBy: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const run of await listLiveRunsByWorkflow(ctx, args.workflowId, args.projectId)) {
      await cancelWorkflowRun(ctx, run, args.canceledBy, now);
    }
    return null;
  },
});

/**
 * Resume a held lane (docs/specs/workflows.md → Lane hold): clears the hold
 * and reschedules the advance, which re-derives run and container status.
 * Starting user only; idempotent — resuming an unheld lane answers quietly.
 */
export const resumeLane = mutation({
  args: { runId: v.id("workflowRuns"), laneId: v.string(), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const run = await ensure(getWorkflowRunById(ctx, args.runId)).notNull(errors.WORKFLOW_RUN_NOT_FOUND);
    // Membership before identity, same as cancel.
    await requireAuthorizedProject(ctx, principal, run.projectId, ProjectPermission.CLI_THREAD);
    ensure(run.startedBy).eq(user._id, errors.WORKFLOW_RUN_NOT_STARTER);
    ensure(run.status).notEq("completed", errors.WORKFLOW_RUN_ALREADY_FINISHED);
    ensure(run.status).notEq("canceled", errors.WORKFLOW_RUN_ALREADY_FINISHED);

    const lane = await getLaneByRunAndLaneId(ctx, args.runId, args.laneId);
    if (!lane?.hold) {
      return null;
    }
    await clearLaneHold(ctx, lane._id);
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId: args.runId });
    return null;
  },
});

/** Shared guard for the step-row interventions (`retryStep`/`skipStep`/`approveStep`): starter of a live run, a step of that run in the expected status. */
async function requireStepOfLiveRun(
  ctx: MutationCtx,
  args: { runId: Id<"workflowRuns">; stepId: Id<"workflowRunSteps">; apiKey?: string },
  expected: { status: Doc<"workflowRunSteps">["status"]; error: string }
): Promise<{ run: Doc<"workflowRuns">; step: Doc<"workflowRunSteps"> }> {
  const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
  const run = await ensure(getWorkflowRunById(ctx, args.runId)).notNull(errors.WORKFLOW_RUN_NOT_FOUND);
  // Membership before identity, same as cancel.
  await requireAuthorizedProject(ctx, principal, run.projectId, ProjectPermission.CLI_THREAD);
  ensure(run.startedBy).eq(user._id, errors.WORKFLOW_RUN_NOT_STARTER);
  ensure(run.status).notEq("completed", errors.WORKFLOW_RUN_ALREADY_FINISHED);
  ensure(run.status).notEq("canceled", errors.WORKFLOW_RUN_ALREADY_FINISHED);

  const step = await getWorkflowRunStepById(ctx, args.stepId);
  if (!step || step.runId !== args.runId) {
    throw new ConvexError(errors.WORKFLOW_STEP_NOT_FOUND);
  }
  ensure(step.status).eq(expected.status, expected.error);
  return { run, step };
}

/**
 * Skip a failed step (docs/specs/workflows.md → Step / run lifecycle):
 * skipped satisfies the stage barrier, so the run moves on without it. The
 * rescheduled advance re-derives run and container status.
 */
export const skipStep = mutation({
  args: { runId: v.id("workflowRuns"), stepId: v.id("workflowRunSteps"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { step } = await requireStepOfLiveRun(ctx, args, { status: "failed", error: errors.WORKFLOW_STEP_NOT_FAILED });
    await markStepSkipped(ctx, step._id, Date.now());
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId: args.runId });
    return null;
  },
});

/**
 * Approve a waiting step (docs/specs/workflows.md → Wait steps, Bash steps):
 * a wait step completes; a bash step held for approval goes back to pending,
 * marked approved, so the rescheduled advance dispatches its script. Either
 * way the advance un-parks the lane thread. Starting user only.
 */
export const approveStep = mutation({
  args: { runId: v.id("workflowRuns"), stepId: v.id("workflowRunSteps"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run, step } = await requireStepOfLiveRun(ctx, args, { status: "waiting", error: errors.WORKFLOW_STEP_NOT_WAITING });
    const version = await getWorkflowVersionById(ctx, run.workflowVersionId);
    const definitionStep = version ? resolveStepDefinition(version.definition, step) : undefined;
    if (definitionStep?.action.type === "bash") {
      await markStepApproved(ctx, step._id, Date.now());
    } else {
      await markStepCompleted(ctx, step._id, Date.now());
    }
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId: args.runId });
    return null;
  },
});

/**
 * Retry a failed step (docs/specs/workflows.md → Step / run lifecycle). A
 * thread-run failure rides the in-thread retry — the same requeue as the
 * message retry button; a step whose prompt never landed (dispatch refusal,
 * deleted lane thread) resets to pending and re-dispatches, on a fresh
 * thread when the old one is gone.
 */
export const retryStep = mutation({
  args: { runId: v.id("workflowRuns"), stepId: v.id("workflowRunSteps"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { step } = await requireStepOfLiveRun(ctx, args, { status: "failed", error: errors.WORKFLOW_STEP_NOT_FAILED });

    if (step.errorMessage === errors.WORKFLOW_STEP_THREAD_FAILED && step.threadId !== undefined && step.userMessageId !== undefined) {
      const thread = await getThreadById(ctx, step.threadId);
      if (thread && !thread.isDeleted) {
        if (thread.status === "failed") {
          // The requeue seam schedules the advance, which revives the step.
          await ctx.runMutation(internal.cli.messages.retryForWorkflowStep, {
            threadId: step.threadId,
            userMessageId: step.userMessageId,
          });
        } else {
          // Already recovered in-thread — the advance revives it.
          await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId: args.runId });
        }
        return null;
      }
    }

    await markStepRetried(ctx, step._id);
    const lane = await getLaneByRunAndLaneId(ctx, args.runId, step.laneId);
    if (lane?.threadId !== undefined) {
      const laneThread = await getThreadById(ctx, lane.threadId);
      if (!laneThread || laneThread.isDeleted) {
        await clearLaneThread(ctx, lane._id);
      }
    }
    await ctx.scheduler.runAfter(0, internal.workflows.runs.core.advance, { runId: args.runId });
    return null;
  },
});

/** The Run view's payload: run state plus steps grouped by stage. Starting user only. */
export const get = query({
  args: { runId: v.id("workflowRuns"), apiKey: v.optional(v.string()) },
  returns: v.union(workflowRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const caller = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!caller) {
      return null;
    }
    const run = await getWorkflowRunById(ctx, args.runId);
    if (!run || run.startedBy !== caller.user._id) {
      return null;
    }
    const access = await authorizeProjectAccess(ctx, caller.principal, run.projectId, ProjectPermission.CLI_THREAD);
    if (!access) {
      return null;
    }
    const version = await getWorkflowVersionById(ctx, run.workflowVersionId);
    if (!version) {
      return null;
    }
    // Soft-deleted workflows keep rendering run history — read the row as-is.
    const workflow = await getWorkflowById(ctx, run.workflowId);
    const steps = await listStepsByRun(ctx, args.runId);
    const lanes = await listLanesByRun(ctx, args.runId);
    return toWorkflowRunDetail({
      run,
      workflowName: workflow?.name ?? "Workflow",
      workflowDeleted: !workflow || workflow.isDeleted,
      version,
      steps,
      lanes,
    });
  },
});

/** A workflow's run history, newest first — the caller's own runs only (threads are user-scoped). */
export const listByWorkflow = query({
  args: { workflowId: v.id("workflows"), apiKey: v.optional(v.string()) },
  returns: v.array(workflowRunSummaryValidator),
  handler: async (ctx, args) => {
    const caller = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!caller) {
      return [];
    }
    const workflow = await getWorkflowById(ctx, args.workflowId);
    if (!workflow) {
      return [];
    }
    const access = await authorizeProjectAccess(ctx, caller.principal, workflow.projectId, ProjectPermission.CLI_THREAD);
    if (!access) {
      return [];
    }
    const runs = await listRunsByWorkflowAndStarter(ctx, args.workflowId, caller.user._id, RUNS_BY_WORKFLOW_LIMIT);
    return runs.map(toWorkflowRunSummary);
  },
});
