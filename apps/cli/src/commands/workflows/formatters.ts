import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";

export type WorkflowSummary = FunctionReturnType<typeof api.workflows.core.listByProject>[number];
export type Workflow = NonNullable<FunctionReturnType<typeof api.workflows.core.get>>;
type Lane = Workflow["draftDefinition"]["lanes"][number];
type Step = Workflow["draftDefinition"]["stages"][number]["steps"][number];

export function formatWorkflowLine(workflow: WorkflowSummary): string {
  const category = workflow.category ? ` ${chalk.dim(`[${workflow.category}]`)}` : "";
  const dirty = workflow.dirtySinceLastVersion ? ` ${chalk.yellow("draft changed")}` : "";
  return `${workflow.name}${category}${dirty} ${chalk.dim(`(${workflow._id})`)}`;
}

function formatLane(lane: Lane): string {
  const runtime = lane.defaults ? `, ${[lane.defaults.cliType, lane.defaults.cliModel].filter(Boolean).join(" ")}` : "";
  return `${lane.name} (${lane.type}${runtime}) ${chalk.dim(lane.laneId)}`;
}

function formatStep(step: Step, laneName: string): string {
  const label = step.name ?? (step.action.type === "bash" ? step.action.script.split("\n")[0] : step.action.type);
  return `${chalk.dim(`[${step.action.type}]`)} ${label} ${chalk.dim(`· ${laneName} · ${step.stepId}`)}`;
}

/** Lanes, then each Stage with its Steps — the grid flattened for a terminal. */
export function formatDefinition(definition: Workflow["draftDefinition"]): string[] {
  const laneNames = new Map(definition.lanes.map((lane: Lane) => [lane.laneId, lane.name]));
  const lines = [chalk.bold(`Lanes (${definition.lanes.length})`), ...definition.lanes.map((lane: Lane) => `  ${formatLane(lane)}`), ""];
  for (const stage of definition.stages) {
    lines.push(chalk.bold(stage.name) + chalk.dim(` ${stage.stageId}`));
    for (const step of stage.steps) {
      lines.push(`  ${formatStep(step, laneNames.get(step.laneId) ?? step.laneId)}`);
    }
    lines.push("");
  }
  return lines;
}

export type Validation = FunctionReturnType<typeof api.workflows.core.validate>;

export function printValidation(result: Validation): void {
  console.log(result.ok ? chalk.green("✓") + " Workflow is runnable" : chalk.red("✗") + ` Workflow is not runnable: ${result.error}`);
}

/** Exits non-zero on a failed verdict — called after printing, so JSON mode fails too. */
export function assertRunnable(result: Validation): void {
  if (!result.ok) {
    throw new Error(`Workflow is not runnable: ${result.error}`);
  }
}
