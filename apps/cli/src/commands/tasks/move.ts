import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectIdFromCommand } from "../../lib/project-resolution.js";
import { isTaskRef, parseScopedTaskRef } from "./parsers.js";
import { resolveTaskIdOrRef } from "./resolve.js";

interface MoveTaskOptions extends OutputOptions {
  org?: string;
  parent?: string;
  topLevel?: boolean;
}

export const moveTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("move")
      .description("Move a task to a new parent or to top-level")
      .argument("<task>", "Task ID or task ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--parent <parent>", "Parent task ID or task ref")
      .option("--top-level", "Move task to top-level")
  )
).action(async (task: string, options: MoveTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const hasParent = options.parent !== undefined;
    const topLevel = options.topLevel === true;
    const parentValue = options.parent ?? "";

    if (hasParent === topLevel) {
      throw new Error("Pass exactly one of --parent or --top-level.");
    }

    const needsAccessibleProjects =
      isTaskRef(task) ||
      (hasParent && isTaskRef(parentValue)) ||
      parseScopedTaskRef(task) !== undefined ||
      (hasParent && parseScopedTaskRef(parentValue) !== undefined);
    const accessibleProjects = needsAccessibleProjects ? await client.query(api.projects.core.listAccessible, {}) : undefined;

    const needsProjectContext = isTaskRef(task) || (hasParent && isTaskRef(parentValue));
    const projectId = needsProjectContext ? resolveProjectIdFromCommand(accessibleProjects ?? [], config, cmd, options.org) : undefined;

    const taskId = await resolveTaskIdOrRef(client, {
      value: task,
      label: "task",
      projectId,
      projects: accessibleProjects,
    });
    const parentId = topLevel
      ? null
      : await resolveTaskIdOrRef(client, {
          value: parentValue,
          label: "parent",
          projectId,
          projects: accessibleProjects,
        });

    await client.mutation(api.tasks.core.move.toParent, {
      id: taskId,
      parentId,
    });

    const payload = {
      taskId,
      parentId,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Task moved");
      console.log(`  ID: ${value.taskId}`);
      console.log(`  Parent: ${value.parentId ?? "Top-level"}`);
      console.log();
    });
  });
});
