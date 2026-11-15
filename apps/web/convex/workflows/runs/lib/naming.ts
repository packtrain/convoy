import type { WorkflowStep } from "../../../lib/contracts/workflowDefinition";
import { clampChars } from "../../../lib/shared/strings";
import { THREAD_TITLE_MAX_LENGTH } from "../../../../lib/threads/constants";

/** Run-surface naming (docs/specs/workflows.md → Threads): step labels and lane-thread titles. */

const STEP_TITLE_MAX = 80;

/** A step's display name: its name, else its prompt's opening text, else its type — clipped to a label. */
export function stepTitle(definitionStep: WorkflowStep, promptOverride: string | undefined): string {
  if (definitionStep.name) {
    return clip(definitionStep.name, STEP_TITLE_MAX);
  }
  if (definitionStep.action.type === "prompt") {
    const text = (promptOverride ?? definitionStep.action.content.displayContent).trim();
    return text.length === 0 ? "Prompt" : clip(text, STEP_TITLE_MAX);
  }
  return definitionStep.action.type === "wait" ? "Wait for human" : "Bash script";
}

/**
 * A lane thread's title — Workflow — Lane — Step — always within the thread
 * cap (`normalizeChatTitle` rejects, never truncates). The prefix yields to
 * the step part: it is what keeps a parallel lane's one-shots distinguishable.
 */
export function laneThreadTitle(workflowName: string, laneName: string | undefined, stepPart: string | undefined): string {
  const suffix = stepPart === undefined ? "" : ` — ${clip(stepPart, STEP_TITLE_MAX)}`;
  const prefix = [workflowName, laneName].filter((part): part is string => part !== undefined && part.length > 0).join(" — ");
  return clip(prefix, THREAD_TITLE_MAX_LENGTH - suffix.length) + suffix;
}

function clip(text: string, max: number): string {
  // clampChars, not slice: a cut through a surrogate pair ships a lone
  // surrogate, which Convex rejects at write time.
  return text.length <= max ? text : `${clampChars(text, max - 1).trimEnd()}…`;
}
