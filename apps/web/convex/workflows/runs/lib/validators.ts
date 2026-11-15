import { v, type Infer } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";
import { cliEffortValidator, cliModelValidator, cliScriptRequestValidator, cliTypeValidator } from "../../../lib/contracts/validators";
import { workflowRunStatusValidator, workflowRunStepStatusValidator } from "../../../lib/contracts/workflowRuns";
import type { WorkflowStep } from "../../../lib/contracts/workflowDefinition";
import { KICKOFF_STAGE_ID, KICKOFF_STEP_ID, resolveStepDefinition } from "./resolution";
import { dispatchableSteps } from "./runStepsRepo";
import { stepTitle } from "./naming";

export const workflowRunStepItemValidator = v.object({
  _id: v.id("workflowRunSteps"),
  definitionStepId: v.string(),
  laneId: v.string(),
  laneName: v.string(),
  title: v.string(),
  type: v.union(v.literal("prompt"), v.literal("wait"), v.literal("bash")),
  status: workflowRunStepStatusValidator,
  // The prompt step's resolved runtime, for the Run view's lane label.
  cliType: v.optional(cliTypeValidator),
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  threadId: v.optional(v.id("cliThreads")),
  errorMessage: v.optional(v.string()),
  // A bash step's pinned script, so Approve shows what it authorizes.
  script: v.optional(cliScriptRequestValidator),
  // Set on a held lane's next pending step — the dispatch the hold blocks;
  // the Run view renders Resume on it (docs/specs/workflows.md → Lane hold).
  held: v.optional(v.boolean()),
});

export const workflowRunStageItemValidator = v.object({
  stageId: v.string(),
  name: v.string(),
  steps: v.array(workflowRunStepItemValidator),
});

// The Run view's whole payload: run header state plus steps grouped by stage,
// resolved against the pinned version (step rows carry no definition copy).
export const workflowRunDetailValidator = v.object({
  _id: v.id("workflowRuns"),
  workflowId: v.id("workflows"),
  workflowName: v.string(),
  // Run history outlives its workflow — the view drops the editor link then.
  workflowDeleted: v.boolean(),
  status: workflowRunStatusValidator,
  versionNumber: v.number(),
  attachedTaskId: v.optional(v.id("tasks")),
  startedAt: v.number(),
  lastActivityAt: v.number(),
  completedAt: v.optional(v.number()),
  canceledAt: v.optional(v.number()),
  stages: v.array(workflowRunStageItemValidator),
});

export const workflowRunSummaryValidator = v.object({
  _id: v.id("workflowRuns"),
  workflowId: v.id("workflows"),
  status: workflowRunStatusValidator,
  startedAt: v.number(),
  lastActivityAt: v.number(),
  completedAt: v.optional(v.number()),
  canceledAt: v.optional(v.number()),
});

export type WorkflowRunStepItem = Infer<typeof workflowRunStepItemValidator>;
export type WorkflowRunStageItem = Infer<typeof workflowRunStageItemValidator>;
export type WorkflowRunDetail = Infer<typeof workflowRunDetailValidator>;
export type WorkflowRunSummary = Infer<typeof workflowRunSummaryValidator>;

export function toWorkflowRunSummary(run: Doc<"workflowRuns">): WorkflowRunSummary {
  return {
    _id: run._id,
    workflowId: run.workflowId,
    status: run.status,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    completedAt: run.completedAt,
    canceledAt: run.canceledAt,
  };
}

/**
 * Join step rows onto the pinned version's definition order. The version is
 * immutable, so every row's `definitionStepId` resolves; a missing pairing
 * (never expected) drops the step rather than failing the whole view.
 */
export function toWorkflowRunDetail(args: {
  run: Doc<"workflowRuns">;
  workflowName: string;
  workflowDeleted: boolean;
  version: Doc<"workflowVersions">;
  steps: Doc<"workflowRunSteps">[];
  lanes: Doc<"workflowRunLanes">[];
}): WorkflowRunDetail {
  const { run, workflowName, workflowDeleted, version, steps, lanes } = args;
  const laneNames = new Map(version.definition.lanes.map((lane) => [lane.laneId, lane.name]));
  const rowsByStep = new Map(steps.map((row) => [`${row.stageId}:${row.definitionStepId}`, row]));
  // The engine's dispatch rule decides which rows a hold blocks, so Resume
  // never renders on a step the hold isn't holding back; one Resume per lane.
  const heldStepIds = new Set(
    lanes.filter((lane) => lane.hold !== undefined).flatMap((lane) => dispatchableSteps(steps, lane)[0]?._id ?? [])
  );

  const toStepItem = (definitionStep: WorkflowStep, row: Doc<"workflowRunSteps">): WorkflowRunStepItem => ({
    _id: row._id,
    definitionStepId: definitionStep.stepId,
    laneId: definitionStep.laneId,
    laneName: laneNames.get(definitionStep.laneId) ?? "",
    title: stepTitle(definitionStep, row.promptOverride?.displayContent),
    type: definitionStep.action.type,
    status: row.status,
    cliType: row.resolvedExecution?.cliType,
    cliModel: row.resolvedExecution?.cliModel,
    cliEffort: row.resolvedExecution?.cliEffort,
    threadId: row.threadId,
    errorMessage: row.errorMessage,
    script:
      definitionStep.action.type === "bash"
        ? { script: definitionStep.action.script, timeoutMs: definitionStep.action.timeoutMs }
        : undefined,
    held: heldStepIds.has(row._id) || undefined,
  });

  // The run-local Kickoff step is its own stage ahead of the version's.
  const kickoffRow = steps.find((row) => row.definitionStepId === KICKOFF_STEP_ID);
  const kickoffStep = kickoffRow ? resolveStepDefinition(version.definition, kickoffRow) : undefined;
  const stages = [
    ...(kickoffRow && kickoffStep ? [{ stageId: KICKOFF_STAGE_ID, name: "Kickoff", steps: [toStepItem(kickoffStep, kickoffRow)] }] : []),
    ...version.definition.stages.map((stage) => ({
      stageId: stage.stageId,
      name: stage.name,
      steps: stage.steps.flatMap((definitionStep) => {
        const row = rowsByStep.get(`${stage.stageId}:${definitionStep.stepId}`);
        return row ? [toStepItem(definitionStep, row)] : [];
      }),
    })),
  ];

  return {
    _id: run._id,
    workflowId: run.workflowId,
    workflowName,
    workflowDeleted,
    status: run.status,
    versionNumber: version.versionNumber,
    attachedTaskId: run.attachedTaskId,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    completedAt: run.completedAt,
    canceledAt: run.canceledAt,
    stages,
  };
}
