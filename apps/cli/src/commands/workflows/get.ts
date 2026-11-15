import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { formatDefinition } from "./formatters.js";

// JSON output is the stored workflow; its `draftDefinition` is the shape
// `workflows update --definition-file` accepts, so get → edit → update round-trips.
export const getWorkflowCommand = addGlobalOptions(
  addOutputOptions(new Command("get").description("Show a Workflow and its draft definition").argument("<workflowId>", "Workflow ID"))
).action(async (workflowId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const workflow = await client.query(api.workflows.core.get, {
      workflowId: parseId<"workflows">(workflowId, "workflowId"),
    });

    if (!workflow) {
      throw new Error("Workflow not found or not accessible.");
    }

    printOutput(outputMode, workflow, (value) => {
      console.log(chalk.bold(`\n${value.name}`) + (value.dirtySinceLastVersion ? chalk.yellow("  draft changed since last run") : ""));
      console.log(`  ID: ${value._id}`);
      console.log(`  Description: ${value.description ?? "None"}`);
      console.log(`  Category: ${value.category ?? "None"}`);
      console.log(`  Color: ${value.color ?? "None"}`);
      console.log(`  Updated: ${new Date(value.updatedAt).toISOString()}`);
      console.log();
      for (const line of formatDefinition(value.draftDefinition)) {
        console.log(line);
      }
    });
  });
});
