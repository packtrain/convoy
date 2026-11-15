import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";

export type ProjectLabel = FunctionReturnType<typeof api.tasks.labels.list>[number];

export function formatLabelLine(label: ProjectLabel): string {
  const swatch = chalk.hex(label.color)("●");
  return `${swatch} ${label.name} ${chalk.dim(`(${label._id})`)} ${chalk.dim(label.color)}`;
}
