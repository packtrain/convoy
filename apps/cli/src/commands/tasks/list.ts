import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { printOutput, resolveOutputMode, addOutputOptions, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { LIST_OPTION_DESCRIPTION, parseOptionalListIdentifier, parseOptionalTaskStatus } from "./parsers.js";
import { formatExternalLinkLine, formatTaskSummaryLine } from "./formatters.js";

interface ListTasksOptions extends OutputOptions {
  org?: string;
  archived?: boolean;
  status?: string;
  list?: string;
  includeLinks?: boolean;
}

export const listTasksCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List tasks")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--archived", "List archived tasks")
      .option("--list <list>", LIST_OPTION_DESCRIPTION)
      .option("--status <status>", "Filter by task status")
      .option("--include-links", "Print each task's external links in text output")
  )
).action(async (options: ListTasksOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const status = parseOptionalTaskStatus(options.status);
    const listId = parseOptionalListIdentifier(options.list);
    const taskQueryArgs = {
      projectId,
      archiveFilter: options.archived ? "archived" : undefined,
      status,
      ...(listId !== undefined && { listId }),
    } as Omit<FunctionArgs<typeof api.tasks.core.listByProject>, "apiKey">;
    const tasks = await client.query(api.tasks.core.listByProject, taskQueryArgs);

    printOutput(outputMode, tasks, (rows) => {
      if (rows.length === 0) {
        console.log(chalk.dim("\nNo tasks found."));
        return;
      }

      console.log(chalk.bold(`\nFound ${rows.length} task(s):\n`));
      for (const task of rows) {
        console.log(`  ${formatTaskSummaryLine(task)}`);
        if (options.includeLinks === true) {
          for (const link of task.externalLinks) {
            console.log(`      ${formatExternalLinkLine(link)}`);
          }
        }
      }
      console.log();
    });
  });
});
