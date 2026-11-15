import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { DEFAULT_FALLBACK_CLI_TYPE } from "../../lib/contracts/validators";
import type { StepAction, WorkflowDefinition } from "../../lib/contracts/workflowDefinition";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeWorkflowName(name: string): string {
  const normalized = normalizeWhitespace(name);
  ensure(normalized.length).gte(1, errors.WORKFLOW_NAME_REQUIRED);
  ensure(normalized.length).lte(120, errors.WORKFLOW_NAME_TOO_LONG);
  return normalized;
}

export function normalizeOptionalWorkflowCategory(value: string | null | undefined): string | undefined {
  return normalizeOptionalText(value, 60, errors.WORKFLOW_CATEGORY_TOO_LONG);
}

export function normalizeOptionalWorkflowDescription(value: string | null | undefined): string | undefined {
  return normalizeOptionalText(value, 2000, errors.WORKFLOW_DESCRIPTION_TOO_LONG);
}

export function normalizeWorkflowColor(color: string): string {
  ensure(color).satisfies(
    (value) => AGENT_COLOR_PALETTE.some((paletteColor) => paletteColor === value),
    errors.WORKFLOW_COLOR_INVALID
  );
  return color;
}

/**
 * Trims lane, stage, and step names (step: empty → unset), drops ref-less
 * prompt composer documents, and puts runtime settings where the Lane type
 * says they live (workflow-data-schema.md → Lane and override rules), so a
 * whitespace-only rename or an empty composer shell can't fake a definition
 * change and the illegal override states are unreachable on the way to
 * storage; length caps wait for the version cut.
 */
export function normalizeWorkflowDefinition(definition: WorkflowDefinition): WorkflowDefinition {
  const parallelLaneIds = new Set(definition.lanes.filter((lane) => lane.type === "parallel").map((lane) => lane.laneId));
  return {
    ...definition,
    lanes: definition.lanes.map((lane) => ({
      ...lane,
      name: normalizeWhitespace(lane.name),
      // A parallel Lane stores no defaults — each Step carries its own
      // settings. A single Lane without any gets the app default runtime the
      // editor header already shows, so the draft runs as displayed.
      defaults: lane.type === "parallel" ? undefined : (lane.defaults ?? { cliType: DEFAULT_FALLBACK_CLI_TYPE }),
    })),
    stages: definition.stages.map((stage) => ({
      ...stage,
      name: normalizeWhitespace(stage.name),
      steps: stage.steps.map((step) => ({
        ...step,
        name: step.name === undefined ? undefined : normalizeWhitespace(step.name) || undefined,
        action: normalizeStepAction(step.action, parallelLaneIds.has(step.laneId)),
      })),
    })),
  };
}

function normalizeStepAction(action: StepAction, inParallelLane: boolean): StepAction {
  // A parallel lane's one-shot thread has no agent to report to (OS-1886).
  if (action.type === "bash") {
    return inParallelLane && action.reportOutput !== "stop_on_failure" ? { ...action, reportOutput: "stop_on_failure" } : action;
  }
  if (action.type !== "prompt") {
    return action;
  }
  const content =
    action.content.composerDocument?.refs.length === 0
      ? { ...action.content, composerDocument: undefined }
      : action.content;
  // A single Lane's Step may override only mode; the thread settings are the Lane's.
  const overrides = inParallelLane
    ? action.overrides
    : action.overrides?.mode === undefined
      ? undefined
      : { mode: action.overrides.mode };
  return { ...action, content, overrides };
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number, tooLongError: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  ensure(normalized.length).lte(maxLength, tooLongError);
  return normalized || undefined;
}
