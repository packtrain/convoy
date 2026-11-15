import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";

type StepMutation = typeof api.workflows.runs.core.approveStep;

// approve, retry, skip share one shape: (runId, run-step id) → null. The
// backend gates each to the starting user and the step's current status.
function stepCommand(name: string, description: string, mutation: StepMutation, done: string) {
  return addGlobalOptions(
    addOutputOptions(new Command(name).description(description).argument("<runId>", "Run ID").argument("<stepId>", "Run step ID (from `workflows runs get`)"))
  ).action(async (runId: string, stepId: string, options: OutputOptions, cmd: Command) => {
    await runOneShotCommand(cmd, async ({ client }) => {
      const outputMode = resolveOutputMode(options);
      const args = { runId: parseId<"workflowRuns">(runId, "runId"), stepId: parseId<"workflowRunSteps">(stepId, "stepId") };
      await client.mutation(mutation, args);
      printOutput(outputMode, args, (value) => {
        console.log(chalk.green("✓") + ` ${done}`);
        console.log(`  Step: ${value.stepId}`);
        console.log();
      });
    });
  });
}

export const approveStepCommand = stepCommand("approve", "Approve a waiting step (a wait step completes; a held bash step runs)", api.workflows.runs.core.approveStep, "Step approved");
export const retryStepCommand = stepCommand("retry", "Retry a failed step", api.workflows.runs.core.retryStep, "Step retried");
export const skipStepCommand = stepCommand("skip", "Skip a failed step so the run moves on", api.workflows.runs.core.skipStep, "Step skipped");
