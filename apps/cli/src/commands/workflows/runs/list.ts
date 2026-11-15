import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { formatRunLine } from "./formatters.js";

// The caller's own runs only, newest first — the backend scopes by starter.
export const listRunsCommand = addGlobalOptions(
  addOutputOptions(new Command("list").description("List your runs of a Workflow").argument("<workflowId>", "Workflow ID"))
).action(async (workflowId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const runs = await client.query(api.workflows.runs.core.listByWorkflow, {
      workflowId: parseId<"workflows">(workflowId, "workflowId"),
    });

    printOutput(outputMode, runs, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("No runs found."));
        return;
      }
      console.log(chalk.bold(`\nRuns (${value.length}):`));
      for (const run of value) {
        console.log(`  ${formatRunLine(run)}`);
      }
      console.log();
    });
  });
});
