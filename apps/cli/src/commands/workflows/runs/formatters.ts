import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api.js";

export type RunSummary = FunctionReturnType<typeof api.workflows.runs.core.listByWorkflow>[number];
export type RunDetail = NonNullable<FunctionReturnType<typeof api.workflows.runs.core.get>>;
type RunStep = RunDetail["stages"][number]["steps"][number];

function colorStatus(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "failed":
    case "canceled":
      return chalk.red(status);
    case "running":
    case "waiting":
      return chalk.yellow(status);
    default:
      return chalk.dim(status);
  }
}

export function formatRunLine(run: RunSummary): string {
  const ended = run.completedAt ?? run.canceledAt;
  const when = new Date(run.startedAt).toISOString() + (ended ? ` → ${new Date(ended).toISOString()}` : "");
  return `${colorStatus(run.status).padEnd(19)} ${chalk.dim(when)}  ${run._id}`;
}

// Step ids printed here are the run-step row ids that approve/retry/skip take.
function formatStep(step: RunStep): string[] {
  const held = step.held ? ` ${chalk.yellow("held")}` : "";
  const lines = [`  ${colorStatus(step.status).padEnd(19)} ${step.title}${held} ${chalk.dim(`· ${step.laneName} · ${step.type} · ${step._id}`)}`];
  if (step.threadId) {
    lines.push(chalk.dim(`      thread ${step.threadId}`));
  }
  if (step.errorMessage) {
    lines.push(chalk.red(`      ${step.errorMessage}`));
  }
  return lines;
}

export function formatRunDetail(run: RunDetail): string[] {
  const lines = [
    chalk.bold(`${run.workflowName} v${run.versionNumber}`) + (run.workflowDeleted ? chalk.dim("  (workflow deleted)") : ""),
    `  ID: ${run._id}`,
    `  Status: ${colorStatus(run.status)}`,
    `  Task: ${run.attachedTaskId ?? "None"}`,
    `  Started: ${new Date(run.startedAt).toISOString()}`,
  ];
  if (run.completedAt) lines.push(`  Completed: ${new Date(run.completedAt).toISOString()}`);
  if (run.canceledAt) lines.push(`  Canceled: ${new Date(run.canceledAt).toISOString()}`);
  lines.push("");
  for (const stage of run.stages) {
    lines.push(chalk.bold(stage.name) + chalk.dim(` ${stage.stageId}`));
    for (const step of stage.steps) {
      lines.push(...formatStep(step));
    }
    lines.push("");
  }
  return lines;
}
