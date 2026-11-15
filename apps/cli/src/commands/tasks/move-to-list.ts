import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { LIST_OPTION_DESCRIPTION, parseOptionalListIdentifier } from "./parsers.js";
import { resolveTaskIdOrRef } from "./resolve.js";

const MAX_MOVE_ROOTS = 25;

interface MoveTasksToListOptions extends OutputOptions {
  org?: string;
  list: string;
}

export const moveTasksToListCommand = addGlobalOptions(
  addOutputOptions(
    new Command("move-to-list")
      .description("Move one or more tasks to a List")
      .argument("<tasks...>", "Task IDs or refs (maximum 25)")
      .requiredOption("--list <list>", `${LIST_OPTION_DESCRIPTION} or BACKLOG`)
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (tasks: string[], options: MoveTasksToListOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    if (tasks.length === 0 || tasks.length > MAX_MOVE_ROOTS) {
      throw new Error(`Pass between 1 and ${MAX_MOVE_ROOTS} task IDs or refs.`);
    }
    const listId = parseOptionalListIdentifier(options.list);
    if (listId === undefined) {
      throw new Error("--list is required.");
    }

    const { projects, projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const rootIds = await Promise.all(
      tasks.map((task) =>
        resolveTaskIdOrRef(client, {
          value: task,
          label: "task",
          projectId,
          projects,
        })
      )
    );
    const result = await client.mutation(api.tasks.core.move.toList, {
      rootIds,
      listId,
    });

    printOutput(outputMode, result, (value) => {
      console.log(chalk.green("✓") + ` Moved ${value.taskIds.length} task(s) to ${value.list.name} (${value.list.ref})`);
    });
  });
});
