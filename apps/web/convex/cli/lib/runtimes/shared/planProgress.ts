import type { CliNormalizedEvent, CliPlanStep } from "@/convex/lib/contracts/validators";

export type PlanProgressEvent = Extract<CliNormalizedEvent, { kind: "plan-progress" }>;
export type PlanStepUpdateEvent = Extract<CliNormalizedEvent, { kind: "plan-step-update" }>;
export type PlanProgressStep = CliPlanStep;

/**
 * Provider-neutral full plan snapshot. Runtimes that resend the whole list on
 * every update (Claude `TodoWrite` / `TaskList`, Codex `todo_list` and
 * `turn/plan/updated`) map into this. Returns `null` for empty snapshots so
 * callers can fall back to their normal event.
 */
export function planProgressEvent(steps: PlanProgressStep[]): PlanProgressEvent | null {
  const usable = steps.filter((step) => step.text.trim().length > 0);
  if (usable.length === 0) {
    return null;
  }
  return { kind: "plan-progress", steps: usable };
}

/**
 * Incremental plan edit for runtimes that only ever report one step at a time
 * (Claude's `TaskCreate` / `TaskUpdate`). Returns `null` when nothing usable
 * is being said about any step.
 */
export function planStepUpdateEvent(
  steps: PlanStepUpdateEvent["steps"]
): PlanStepUpdateEvent | null {
  const usable = steps.filter(
    (step) => step.id.length > 0 && (step.text !== undefined || step.status !== undefined)
  );
  if (usable.length === 0) {
    return null;
  }
  return { kind: "plan-step-update", steps: usable };
}

/**
 * Fold plan events over the thread's current steps, in stream order; `null` when no
 * event touched the plan, so callers can skip the write.
 *
 * A snapshot replaces everything; an update upserts by step id. An update for an
 * unknown id appends only if it carries text — a bare status has nothing to render.
 */
export function foldPlanEvents(
  current: ReadonlyArray<CliPlanStep>,
  events: ReadonlyArray<CliNormalizedEvent>
): CliPlanStep[] | null {
  let steps: CliPlanStep[] | null = null;

  for (const event of events) {
    if (event.kind === "plan-progress") {
      steps = [...event.steps];
      continue;
    }
    if (event.kind !== "plan-step-update") {
      continue;
    }

    const next = [...(steps ?? current)];
    for (const patch of event.steps) {
      const index = next.findIndex((step) => step.id === patch.id);
      if (index === -1) {
        if (patch.text === undefined) {
          continue;
        }
        next.push({ id: patch.id, text: patch.text, status: patch.status ?? "pending" });
        continue;
      }
      next[index] = {
        ...next[index],
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
    }
    steps = next;
  }

  return steps;
}
