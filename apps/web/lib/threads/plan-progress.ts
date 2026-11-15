import type { CliPlanStep } from "@/convex/lib/contracts/validators";

export type { CliPlanStep };

export type PlanProgress = {
  steps: CliPlanStep[];
  completed: number;
  total: number;
  /**
   * 1-based position of the step to show in the pill: the in-progress step
   * when the runtime reports one (Claude, Codex app-server), otherwise the
   * first incomplete step (Codex exec reports completed/incomplete only).
   */
  currentIndex: number;
  currentStep: string;
};

/**
 * Shape the thread's stored plan steps for the composer pill. Returns `null`
 * for threads with no plan, which is most of them.
 */
export function toPlanProgress(
  steps: ReadonlyArray<CliPlanStep> | undefined
): PlanProgress | null {
  if (!steps || steps.length === 0) {
    return null;
  }

  const activeIndex = steps.findIndex((step) => step.status === "in-progress");
  const firstIncomplete = steps.findIndex((step) => step.status !== "completed");
  // All steps done: keep pointing at the last one so the pill reads "N/N".
  const index =
    activeIndex >= 0 ? activeIndex : firstIncomplete >= 0 ? firstIncomplete : steps.length - 1;

  return {
    steps: [...steps],
    completed: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
    currentIndex: index + 1,
    currentStep: steps[index]?.text ?? "",
  };
}
