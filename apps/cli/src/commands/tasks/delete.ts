import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";

interface DeleteTaskOptions extends OutputOptions {
  cascade?: string;
}

export const deleteTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Delete a task")
      .argument("<taskId>", "Task ID")
      .option(
        "--cascade <mode>",
        "Cascade mode: delete_all|keep_children (default: delete_all)"
      )
  )
).action(async (taskId: string, options: DeleteTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    if (
      options.cascade !== undefined &&
      options.cascade !== "delete_all" &&
      options.cascade !== "keep_children"
    ) {
      throw new Error(
        `Invalid cascade mode "${options.cascade}". Use delete_all or keep_children.`
      );
    }

    const result = await client.mutation(api.tasks.core.remove, {
      id: parseId(taskId, "taskId"),
      ...(options.cascade !== undefined && {
        cascadeMode: options.cascade,
      }),
    });

    printOutput(outputMode, result, (value) => {
      console.log(
        chalk.green("✓") + ` Task deleted (${value.deletedIds.length} record(s) affected).`
      );
      console.log();
    });
  });
});
