import { v, type Infer } from "convex/values";
import { cliEffortValidator, cliModelValidator, cliTypeValidator } from "./validators";
import { composerContentValidator } from "./composerContent";

// The Workflow definition tree (docs/specs/workflow-data-schema.md → Definition tree).
// In root contracts because schema.ts and the workflows domain share it. laneId/stageId/
// stepId are stable UUID strings scoped to the definition, not Convex document IDs.

// Single-Lane thread start settings. A parallel Lane stores no defaults — each of
// its executable Steps carries its own settings via Step overrides.
export const laneRuntimeDefaultsValidator = v.object({
  cliType: cliTypeValidator,
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  mode: v.optional(v.string()),
  projectAgentId: v.optional(v.id("projectAgents")),
});

export const workflowLaneTypeValidator = v.union(v.literal("single"), v.literal("parallel"));

export const laneDefinitionValidator = v.object({
  laneId: v.string(),
  name: v.string(),
  type: workflowLaneTypeValidator,
  defaults: v.optional(laneRuntimeDefaultsValidator),
});

export const stepOverridesValidator = v.object({
  projectAgentId: v.optional(v.id("projectAgents")),
  cliType: v.optional(cliTypeValidator),
  cliModel: v.optional(cliModelValidator),
  cliEffort: v.optional(cliEffortValidator),
  mode: v.optional(v.string()),
});

export const stepActionValidator = v.union(
  v.object({
    type: v.literal("prompt"),
    content: composerContentValidator,
    overrides: v.optional(stepOverridesValidator),
  }),
  v.object({
    type: v.literal("wait"),
  }),
  v.object({
    type: v.literal("bash"),
    script: v.string(),
    timeoutMs: v.number(),
    // What a run does with the script's result: report it to the Lane's agent
    // (always / only on failure, the Lane continues either way), or halt the
    // Lane for the starting user on failure (docs/specs/workflows.md).
    reportOutput: v.union(v.literal("always"), v.literal("on_failure"), v.literal("stop_on_failure")),
  })
);

export const workflowStepValidator = v.object({
  stepId: v.string(),
  laneId: v.string(),
  name: v.optional(v.string()),
  action: stepActionValidator,
});

export const stageDefinitionValidator = v.object({
  stageId: v.string(),
  name: v.string(),
  steps: v.array(workflowStepValidator),
});

// Array order is authoritative: lanes[] is column order, stages[] is Stage
// execution order, steps[] is card layout order within a Stage.
export const workflowDefinitionValidator = v.object({
  runInNewWorktree: v.optional(v.boolean()),
  lanes: v.array(laneDefinitionValidator),
  stages: v.array(stageDefinitionValidator),
});

/**
 * The one step a run start may override: the first lane's first prompt, in
 * stage order. Shared by the composer prefill and the start mutation so the
 * override always lands on the step the user was shown.
 */
export function firstPromptStepOf(
  definition: WorkflowDefinition
): { stageId: string; stepId: string; action: Extract<StepAction, { type: "prompt" }> } | undefined {
  const laneId = definition.lanes[0]?.laneId;
  if (!laneId) {
    return undefined;
  }
  for (const stage of definition.stages) {
    for (const step of stage.steps) {
      if (step.laneId === laneId && step.action.type === "prompt") {
        return { stageId: stage.stageId, stepId: step.stepId, action: step.action };
      }
    }
  }
  return undefined;
}

export type LaneRuntimeDefaults = Infer<typeof laneRuntimeDefaultsValidator>;
export type LaneDefinition = Infer<typeof laneDefinitionValidator>;
export type StepOverrides = Infer<typeof stepOverridesValidator>;
export type StepAction = Infer<typeof stepActionValidator>;
export type WorkflowStep = Infer<typeof workflowStepValidator>;
export type StageDefinition = Infer<typeof stageDefinitionValidator>;
export type WorkflowDefinition = Infer<typeof workflowDefinitionValidator>;
