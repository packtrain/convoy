import chalk from "chalk";
import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

interface ListTaskTypesOptions extends OutputOptions {
  org?: string;
}

type TaskTypeSummary = FunctionReturnType<typeof api.tasks.core.listTypes>[number];

function formatTaskType(taskType: TaskTypeSummary): string {
  return `${chalk.cyan(taskType.key.padEnd(16))} ${taskType.name} ${chalk.dim(`${taskType.icon} ${taskType.color}`)}`;
}

export const listTaskTypesCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List task types available in a project")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: ListTaskTypesOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const taskTypes = await client.query(api.tasks.core.listTypes, {
      projectId,
    });

    printOutput(outputMode, taskTypes, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("No task types found."));
        return;
      }

      console.log(chalk.bold(`Task types (${value.length}):`));
      for (const taskType of value) {
        console.log(`  ${formatTaskType(taskType)}`);
      }
    });
  });
});
