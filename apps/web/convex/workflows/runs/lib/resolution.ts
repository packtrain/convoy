import type { Doc } from "../../../_generated/dataModel";
import type { ComposerContent } from "../../../lib/contracts/composerContent";
import type { WorkflowDefinition, WorkflowStep } from "../../../lib/contracts/workflowDefinition";

/**
 * The run-local Kickoff step (docs/specs/workflows.md → Start): the composer
 * text when the first lane has no prompt step. Ordered ahead of Stage 1; the
 * version has no such step, so its prompt is its own `promptOverride`.
 */
export const KICKOFF_STAGE_ID = "kickoff";
export const KICKOFF_STEP_ID = "kickoff";
export const KICKOFF_STAGE_ORDER = -1;

/**
 * definitionStepId → the pinned version's step definition. Step rows carry no
 * definition copy (docs/specs/workflow-data-schema.md → Run tree); the version
 * is immutable, so a missing pairing is a system invariant break.
 */
export function resolveStepDefinition(definition: WorkflowDefinition, step: Doc<"workflowRunSteps">): WorkflowStep | undefined {
  if (step.definitionStepId === KICKOFF_STEP_ID) {
    return step.promptOverride
      ? { stepId: KICKOFF_STEP_ID, laneId: step.laneId, action: { type: "prompt", content: step.promptOverride } }
      : undefined;
  }
  const stage = definition.stages.find((candidate) => candidate.stageId === step.stageId);
  return stage?.steps.find((candidate) => candidate.stepId === step.definitionStepId);
}

/** A prompt step's effective content: the run-local first-prompt override wins over the version. */
export function resolveStepPrompt(definitionStep: WorkflowStep, step: Doc<"workflowRunSteps">): ComposerContent | undefined {
  if (definitionStep.action.type !== "prompt") {
    return undefined;
  }
  return step.promptOverride ?? definitionStep.action.content;
}
