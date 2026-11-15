import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { formatLabelLine, type ProjectLabel } from "./formatters.js";

interface ListLabelsOptions extends OutputOptions {
  org?: string;
}

export const listLabelsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List project labels (in board-column order)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: ListLabelsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const labels: ProjectLabel[] = await client.query(api.tasks.labels.list, { projectId });

    printOutput(outputMode, labels, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("\nNo labels in this project."));
        return;
      }

      console.log(chalk.bold(`\nFound ${value.length} label(s):\n`));
      for (const label of value) {
        console.log(`  ${formatLabelLine(label)}`);
      }
      console.log();
    });
  });
});
