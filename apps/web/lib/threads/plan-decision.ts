import type { CliUiPart } from "@/lib/cli-stream-ui/types";
import type { CliProposedPlanSource } from "@/convex/lib/contracts/validators";
import { getCliModes } from "@/lib/cli-runtime-ui/registry";
import type { CliTypeSlug } from "@/lib/threads/types";

/**
 * What the user approved for a proposed plan. `nextMode` is the thread mode the
 * run (and the composer) continues in — approving is the only thing that moves
 * a thread out of `plan`. There is no "keep planning" decision: typing the
 * feedback is that decision (OS-1461), and the send path already ends the
 * parked run.
 */
export type PlanDecision = {
  nextMode: "auto" | "default" | "agent";
  proposedPlan?: CliProposedPlanSource;
};

export type PlanDecisionOption = {
  key: string;
  label: string;
  decision: PlanDecision;
};

const APPROVE_OPTIONS: Array<{
  key: string;
  /** Used when the runtime is unknown and has no label to borrow. */
  fallbackModeLabel: string;
  label?: string;
  nextMode: PlanDecision["nextMode"];
}> = [
  {
    key: "approve-auto",
    // The primary approve continues in the runtime's own supervised mode, so
    // it is named after that mode ("Auto" for Claude, "Sandboxed" for Codex).
    fallbackModeLabel: "auto",
    nextMode: "auto",
  },
  {
    key: "approve-ask-per-tool",
    fallbackModeLabel: "ask to approve",
    label: "Approve, ask per tool",
    nextMode: "default",
  },
  {
    key: "approve-act",
    fallbackModeLabel: "Act",
    nextMode: "agent",
  },
];

/**
 * Approve options are limited to the modes the runtime actually offers —
 * OpenCode has no `auto`, so it gets one approve button. The first option is
 * the primary one.
 */
export function getPlanDecisionOptions(
  cliType: CliTypeSlug | undefined
): PlanDecisionOption[] {
  // An unknown runtime keeps every approve option — hiding one would strand
  // the user with no way to approve at all.
  const modes = cliType ? getCliModes(cliType) : null;

  return APPROVE_OPTIONS.filter(
    (option) =>
      modes === null || modes.some((mode) => mode.value === option.nextMode)
  ).map((option): PlanDecisionOption => {
    const modeLabel =
      modes?.find((mode) => mode.value === option.nextMode)?.label ??
      option.fallbackModeLabel;

    return {
      key: option.key,
      label: option.label ?? `Approve & continue in ${modeLabel}`,
      decision: { nextMode: option.nextMode },
    };
  });
}

/**
 * Response body the CLI interaction bridge expects for a plan approval.
 * Approval is the only decision that travels the bridge.
 */
export function toPlanApprovalResponseJson(decision: PlanDecision): string {
  return JSON.stringify({
    decision: "approve",
    nextMode: decision.nextMode,
  });
}

/**
 * The message the approve fallback sends when the parked run died before the
 * user answered (OS-1463): the dead callback cannot be woken, so approving
 * degrades to a resumed run told to implement the plan already in its
 * transcript.
 */
export { PLAN_APPROVAL_FALLBACK_MESSAGE } from "@/convex/lib/contracts/validators";

/**
 * Whether a message ended parked on `ExitPlanMode` — the gate was presented and never
 * settled (answering settles it to output; OS-1435's interrupted-part settling skips
 * interactive tools). On a `waiting_input` thread with no live request this marks a
 * plan run whose CLI died while parked (OS-1463), keeping the approve buttons
 * available. NOT the OS-1467 "settled plan" misfire: the signal is the unsettled gate,
 * never the composer's mode.
 */
export function hasParkedExitPlanMode(parts: readonly CliUiPart[]): boolean {
  return parts.some(
    (part) =>
      part.type === "dynamic-tool" &&
      part.toolName === "ExitPlanMode" &&
      (part.state === "input-streaming" || part.state === "input-available")
  );
}
