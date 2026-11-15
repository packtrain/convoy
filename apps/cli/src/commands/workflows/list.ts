import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { formatWorkflowLine } from "./formatters.js";

interface ListWorkflowsOptions extends OutputOptions {
  org?: string;
}

export const listWorkflowsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list").description("List a project's Workflows").option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: ListWorkflowsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const workflows = await client.query(api.workflows.core.listByProject, { projectId });

    printOutput(outputMode, workflows, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("No workflows found."));
        return;
      }
      console.log(chalk.bold(`Workflows (${value.length}):`));
      for (const workflow of value) {
        console.log(`  ${formatWorkflowLine(workflow)}`);
      }
    });
  });
});
