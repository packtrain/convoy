import type {
  LaneDefinition,
  LaneRuntimeDefaults,
  StepAction,
  StepOverrides,
  WorkflowDefinition,
  WorkflowStep,
} from "@/convex/lib/contracts/workflowDefinition";
import { DEFAULT_FALLBACK_CLI_TYPE, getCliModeDefinition } from "@/lib/cli-runtime-ui/registry";

// Pure draft-definition edits for the grid editor. Each returns a new
// definition; laneId/stageId are stable UUIDs (workflow-data-schema.md).

export function createSeedDefinition(): WorkflowDefinition {
  return {
    lanes: [{ laneId: crypto.randomUUID(), name: "Lane 1", type: "single" }],
    stages: [{ stageId: crypto.randomUUID(), name: "Stage 1", steps: [] }],
  };
}

// New lanes/stages are named purely from their position; existing names
// (renames, deletes) don't affect it. Duplicate names are legal.
export function addLane(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    lanes: [
      ...definition.lanes,
      { laneId: crypto.randomUUID(), name: `Lane ${definition.lanes.length + 1}`, type: "single" as const },
    ],
  };
}

export function renameLane(definition: WorkflowDefinition, laneId: string, name: string): WorkflowDefinition {
  return {
    ...definition,
    lanes: definition.lanes.map((lane) => (lane.laneId === laneId ? { ...lane, name } : lane)),
  };
}

/** Removing a lane drops its steps in every stage. */
export function removeLane(definition: WorkflowDefinition, laneId: string): WorkflowDefinition {
  return {
    ...definition,
    lanes: definition.lanes.filter((lane) => lane.laneId !== laneId),
    stages: definition.stages.map((stage) => ({
      ...stage,
      steps: stage.steps.filter((step) => step.laneId !== laneId),
    })),
  };
}

export function addStage(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    stages: [
      ...definition.stages,
      { stageId: crypto.randomUUID(), name: `Stage ${definition.stages.length + 1}`, steps: [] },
    ],
  };
}

export function renameStage(definition: WorkflowDefinition, stageId: string, name: string): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) => (stage.stageId === stageId ? { ...stage, name } : stage)),
  };
}

export function removeStage(definition: WorkflowDefinition, stageId: string): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.filter((stage) => stage.stageId !== stageId),
  };
}

/** Everything the step dialog edits; stepId and laneId are fixed at creation. */
export interface StepInput {
  name?: string;
  action: StepAction;
}

export function addStep(definition: WorkflowDefinition, stageId: string, laneId: string, input: StepInput): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) =>
      stage.stageId === stageId
        ? { ...stage, steps: [...stage.steps, { stepId: crypto.randomUUID(), laneId, ...input }] }
        : stage
    ),
  };
}

export function updateStep(definition: WorkflowDefinition, stageId: string, stepId: string, input: StepInput): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) =>
      stage.stageId === stageId
        ? {
            ...stage,
            steps: stage.steps.map((step) =>
              // Spread keeps fields this dialog doesn't edit as the step shape grows.
              step.stepId === stepId ? { ...step, name: input.name, action: input.action } : step
            ),
          }
        : stage
    ),
  };
}

/** stepIds are unique per stage, not per definition, so a step is addressed by both. */
export interface StepLocation {
  stageId: string;
  stepId: string;
}

/** Where a dragged step lands: a cell, optionally at a position next to a step in it. */
export interface StepDropTarget {
  stageId: string;
  laneId: string;
  /** Insert relative to this step in the target stage; absent = append. */
  anchor?: { stepId: string; position: "before" | "after" };
}

/**
 * The Lane override rule (workflow-data-schema.md → Lane and override rules),
 * applied by the step dialog on save and by moveStep across Lane types.
 * `pinCliType`: the runtime pinned onto Parallel-Lane overrides lacking one.
 */
export function reconcileStepOverrides(
  overrides: StepOverrides | undefined,
  lane: Pick<LaneDefinition, "type" | "defaults"> | undefined,
  pinCliType: NonNullable<StepOverrides["cliType"]>
): StepOverrides | undefined {
  if (lane?.type === "parallel") {
    const next = { ...overrides, cliType: overrides?.cliType ?? pinCliType };
    // Mode values are runtime-specific; drop one the step's runtime lacks.
    return next.mode === undefined || getCliModeDefinition(next.cliType, next.mode)
      ? next
      : { ...next, mode: undefined };
  }
  // A single Lane's thread settings live on the Lane; mode is the only step
  // override, and only when the Lane's runtime has it.
  const mode = overrides?.mode;
  return mode === undefined || !getCliModeDefinition(laneEffectiveCliType(lane), mode) ? undefined : { mode };
}

/** The overrides of the Lane's last Prompt step in grid order; seeds the next new Prompt (OS-1892). */
export function lastPromptOverrides(definition: WorkflowDefinition, laneId: string): StepOverrides | undefined {
  let last: StepOverrides | undefined;
  for (const stage of definition.stages) {
    for (const step of stage.steps) {
      if (step.laneId === laneId && step.action.type === "prompt") {
        last = step.action.overrides;
      }
    }
  }
  return last;
}

/** The runtime a single Lane's thread runs with: its defaults, else the app default. */
export function laneEffectiveCliType(lane: Pick<LaneDefinition, "defaults"> | undefined) {
  return lane?.defaults?.cliType ?? DEFAULT_FALLBACK_CLI_TYPE;
}

/**
 * Flipping a Lane's type moves its runtime settings where the new type keeps
 * them, in the same edit: → parallel moves the Lane defaults onto each Prompt
 * (the Prompt's own overrides winning); → single reduces each Prompt's
 * overrides to mode (workflow-data-schema.md → Lane and override rules).
 */
export function setLaneType(
  definition: WorkflowDefinition,
  laneId: string,
  type: LaneDefinition["type"]
): WorkflowDefinition {
  const lane = definition.lanes.find((candidate) => candidate.laneId === laneId);
  if (!lane || lane.type === type) {
    return definition;
  }
  const nextLane: LaneDefinition = { ...lane, type, defaults: undefined };
  const pin = laneEffectiveCliType(lane);
  return {
    ...definition,
    lanes: definition.lanes.map((candidate) => (candidate.laneId === laneId ? nextLane : candidate)),
    stages: definition.stages.map((stage) => ({
      ...stage,
      steps: stage.steps.map((step) =>
        step.laneId === laneId && step.action.type === "prompt"
          ? {
              ...step,
              action: {
                ...step.action,
                overrides: reconcileStepOverrides({ ...lane.defaults, ...step.action.overrides }, nextLane, pin),
              },
            }
          : step
      ),
    })),
  };
}

export function setLaneDefaults(
  definition: WorkflowDefinition,
  laneId: string,
  defaults: LaneRuntimeDefaults | undefined
): WorkflowDefinition {
  const lane = definition.lanes.find((candidate) => candidate.laneId === laneId);
  if (!lane) {
    return definition;
  }
  const nextLane: LaneDefinition = { ...lane, defaults };
  const runtimeChanged = laneEffectiveCliType(nextLane) !== laneEffectiveCliType(lane);
  return {
    ...definition,
    lanes: definition.lanes.map((candidate) => (candidate.laneId === laneId ? nextLane : candidate)),
    // A runtime change re-scopes which step modes are legal (they are runtime-specific).
    stages: runtimeChanged
      ? definition.stages.map((stage) => ({
          ...stage,
          steps: stage.steps.map((step) =>
            step.laneId === laneId && step.action.type === "prompt"
              ? {
                  ...step,
                  action: {
                    ...step.action,
                    overrides: reconcileStepOverrides(step.action.overrides, nextLane, laneEffectiveCliType(nextLane)),
                  },
                }
              : step
          ),
        }))
      : definition.stages,
  };
}

/** Moves a step between cells or within one; a drop that changes nothing returns the input. */
export function moveStep(
  definition: WorkflowDefinition,
  source: StepLocation,
  target: StepDropTarget
): WorkflowDefinition {
  const sourceStage = definition.stages.find((stage) => stage.stageId === source.stageId);
  const step = sourceStage?.steps.find((candidate) => candidate.stepId === source.stepId);
  if (!sourceStage || !step) {
    return definition;
  }

  let moved = step.laneId === target.laneId ? step : { ...step, laneId: target.laneId };
  const sourceLane = definition.lanes.find((lane) => lane.laneId === step.laneId);
  const targetLane = definition.lanes.find((lane) => lane.laneId === target.laneId);
  if (moved !== step && step.action.type === "prompt" && sourceLane?.type !== targetLane?.type) {
    // A Lane-type change re-scopes which overrides are legal on the step.
    const pin = (sourceLane?.type === "parallel" ? step.action.overrides?.cliType : undefined) ?? laneEffectiveCliType(sourceLane);
    moved = {
      ...moved,
      action: { ...step.action, overrides: reconcileStepOverrides(step.action.overrides, targetLane, pin) },
    };
  }
  const insert = (steps: WorkflowStep[]): WorkflowStep[] => {
    const anchorIndex = target.anchor ? steps.findIndex((candidate) => candidate.stepId === target.anchor?.stepId) : -1;
    const insertAt = anchorIndex === -1 ? steps.length : anchorIndex + (target.anchor?.position === "after" ? 1 : 0);
    return [...steps.slice(0, insertAt), moved, ...steps.slice(insertAt)];
  };

  if (source.stageId === target.stageId) {
    const steps = insert(sourceStage.steps.filter((candidate) => candidate.stepId !== source.stepId));
    if (moved === step && steps.every((candidate, index) => candidate === sourceStage.steps[index])) {
      return definition;
    }
    return {
      ...definition,
      stages: definition.stages.map((stage) => (stage.stageId === source.stageId ? { ...stage, steps } : stage)),
    };
  }

  return {
    ...definition,
    stages: definition.stages.map((stage) => {
      if (stage.stageId === source.stageId) {
        return { ...stage, steps: stage.steps.filter((candidate) => candidate.stepId !== source.stepId) };
      }
      if (stage.stageId === target.stageId) {
        return { ...stage, steps: insert(stage.steps) };
      }
      return stage;
    }),
  };
}

export function removeStep(definition: WorkflowDefinition, stageId: string, stepId: string): WorkflowDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) =>
      stage.stageId === stageId ? { ...stage, steps: stage.steps.filter((step) => step.stepId !== stepId) } : stage
    ),
  };
}
