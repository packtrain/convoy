import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

export const deleteWorkflowCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete").description("Delete a Workflow; its active runs are canceled, history is kept").argument("<workflowId>", "Workflow ID")
  )
).action(async (workflow: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const workflowId = parseId<"workflows">(workflow, "workflowId");
    await client.mutation(api.workflows.core.remove, { workflowId });

    printOutput(outputMode, { workflowId }, (value) => {
      console.log(chalk.green("✓") + " Workflow deleted");
      console.log(`  ID: ${value.workflowId}`);
      console.log(chalk.dim("  Its active runs were canceled; version and run history are kept."));
      console.log();
    });
  });
});
