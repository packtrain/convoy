import { Command } from "commander";
import chalk from "chalk";
import type { FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { printOutput, resolveOutputMode, addOutputOptions, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { parseOptionalIsoDate, parseOptionalTaskStatus } from "./parsers.js";
import { formatTaskSummaryLine } from "./formatters.js";

interface ClosedTasksOptions extends OutputOptions {
  org?: string;
  status?: string;
  limit?: string;
  since?: string;
  until?: string;
}

/** `convoy tasks closed` (docs/specs/task-closed-at.md). */
export const closedTasksCommand = addGlobalOptions(
  addOutputOptions(
    new Command("closed")
      .description("List recently closed tasks, newest first (all Lists, archived included)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--status <status>", "Closed status: Done|Canceled (default: Done)")
      .option("--limit <n>", "Maximum tasks, 1-200 (default: 50)")
      .option("--since <date>", "Closed at or after this ISO-8601 date/datetime (dates are UTC midnight)")
      .option("--until <date>", "Closed before this ISO-8601 date/datetime")
  )
).action(async (options: ClosedTasksOptions, cmd: Command) => {
  const status = parseOptionalTaskStatus(options.status);
  const since = parseOptionalIsoDate(options.since, "--since");
  const until = parseOptionalIsoDate(options.until, "--until");
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    // Status and limit are validated server-side.
    const args = {
      projectId,
      ...(status !== undefined && { status }),
      ...(options.limit !== undefined && { limit: Number(options.limit) }),
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
    } as Omit<FunctionArgs<typeof api.tasks.core.listClosed>, "apiKey">;
    const tasks = await client.query(api.tasks.core.listClosed, args);

    printOutput(outputMode, tasks, (rows) => {
      if (rows.length === 0) {
        console.log(chalk.dim("\nNo closed tasks found."));
        return;
      }
      console.log(chalk.bold(`\nFound ${rows.length} closed task(s):\n`));
      for (const task of rows) {
        const closedDate = task.closedAt === undefined ? "" : new Date(task.closedAt).toISOString().slice(0, 10);
        console.log(`  ${closedDate.padEnd(10)}  ${formatTaskSummaryLine(task)}`);
      }
      console.log();
    });
  });
});
