import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";

interface ResumeRunLaneOptions extends OutputOptions {
  lane: string;
}

export const resumeRunLaneCommand = addGlobalOptions(
  addOutputOptions(
    new Command("resume")
      .description("Resume a lane the user's own message put on hold")
      .argument("<runId>", "Run ID")
      .requiredOption("--lane <laneId>", "Lane ID (from `workflows runs get`)")
  )
).action(async (runId: string, options: ResumeRunLaneOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const args = { runId: parseId<"workflowRuns">(runId, "runId"), laneId: options.lane };
    await client.mutation(api.workflows.runs.core.resumeLane, args);
    printOutput(outputMode, args, (value) => {
      console.log(chalk.green("✓") + " Lane resumed");
      console.log(`  Lane: ${value.laneId}`);
      console.log();
    });
  });
});
