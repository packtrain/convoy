import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import { addGlobalOptions } from "../../../cli.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../../lib/output.js";
import { formatArtifactSummaryLine } from "../formatters.js";
import { resolveTaskIdForCommand } from "../resolve.js";

interface ListTaskArtifactsOptions extends OutputOptions {
  org?: string;
}

export const listTaskArtifactsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List document artifacts for a task")
      .argument("<taskId>", "Task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (taskId: string, options: ListTaskArtifactsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolvedTaskId = await resolveTaskIdForCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });
    const artifacts = await client.query(api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId: resolvedTaskId,
    });

    printOutput(outputMode, artifacts, (value) => {
      console.log(chalk.bold(`\nArtifacts for ${taskId}`));
      if (value.length === 0) {
        console.log("  (none)");
        console.log();
        return;
      }

      for (const artifact of value) {
        console.log(`  - ${formatArtifactSummaryLine(artifact)}`);
      }
      console.log();
    });
  });
});
