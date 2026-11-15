import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";

export type Prompt = FunctionReturnType<typeof api.slashCommands.core.listByProject>[number];

export function formatPromptLine(prompt: Prompt): string {
  const scope = chalk.dim(`[${prompt.scope}]`);
  const description = prompt.description ? ` - ${prompt.description}` : "";
  return `${scope} /${prompt.key}${description} ${chalk.dim(`(${prompt._id})`)}`;
}
