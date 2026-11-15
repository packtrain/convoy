import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";

interface CancelRunOptions extends OutputOptions {
  yes?: boolean;
}

// Confirmed by default: cancel is terminal and stops every lane thread.
export const cancelRunCommand = addGlobalOptions(
  addOutputOptions(new Command("cancel").description("Cancel a run and stop its lane threads").argument("<runId>", "Run ID").option("-y, --yes", "Skip confirmation"))
).action(async (runId: string, options: CancelRunOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const parsedRunId = parseId<"workflowRuns">(runId, "runId");

    if (!options.yes) {
      const shouldCancel = await confirm({ message: `Cancel run ${parsedRunId}? Its lane threads are stopped.`, default: false });
      if (!shouldCancel) {
        printOutput(outputMode, { runId: parsedRunId, canceled: false }, () => {
          console.log(chalk.dim("\nCancelled."));
          console.log();
        });
        return;
      }
    }

    await client.mutation(api.workflows.runs.core.cancel, { runId: parsedRunId });
    printOutput(outputMode, { runId: parsedRunId, canceled: true }, (value) => {
      console.log(chalk.green("✓") + " Run canceled");
      console.log(`  ID: ${value.runId}`);
      console.log();
    });
  });
});
