import { randomUUID } from "node:crypto";
import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { resolveLabelId } from "../labels/resolve.js";
import {
  LIST_OPTION_DESCRIPTION,
  parseOptionalDueDate,
  parseOptionalListIdentifier,
  parseOptionalTags,
  parseOptionalTaskPriority,
  parseOptionalTaskStatus,
  parseOptionalTaskTypeKey,
} from "./parsers.js";

interface CreateTaskOptions extends OutputOptions {
  name: string;
  org?: string;
  parentId?: string;
  taskTypeKey?: string;
  priority?: string;
  status?: string;
  dueDate?: string;
  assigneeId?: string;
  delegateToAgent?: string;
  tags?: string[];
  list?: string;
  label?: string;
}

export const createTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a task")
      .requiredOption("--name <name>", "Task name")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--parent-id <taskId>", "Parent task ID (to create a subtask)")
      .option("--task-type-key <key>", "Task type key")
      .option("--priority <priority>", "Priority: None|Low|Medium|High|Critical")
      .option("--status <status>", "Task status")
      .option("--due-date <value>", "Due date (unix seconds/ms or ISO-8601)")
      .option("--assignee-id <userId>", "Assignee (human owner) user ID, or \"me\"")
      .option("--delegate-to-agent <projectAgentId>", "Delegate execution to this project agent")
      .option("--tags <tag...>", "Tags (repeat and/or comma-separate values)")
      .option("--list <list>", LIST_OPTION_DESCRIPTION)
      .option("--label <label>", "Label ID or exact name")
  )
).action(async (options: CreateTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const taskTypeKey = parseOptionalTaskTypeKey(options.taskTypeKey);
    const priority = parseOptionalTaskPriority(options.priority) ?? "None";
    const status = parseOptionalTaskStatus(options.status) ?? "To Do";
    const dueDate = parseOptionalDueDate(options.dueDate);
    const tags = parseOptionalTags(options.tags) ?? [];
    const listId = parseOptionalListIdentifier(options.list);
    const labelId = options.label ? await resolveLabelId(client, projectId, options.label) : undefined;

    const createArgs = {
      projectId,
      clientId: randomUUID(),
      name: options.name,
      ...(taskTypeKey !== undefined && { taskTypeKey }),
      priority,
      status,
      ...(options.parentId && { parentId: parseId(options.parentId, "parentId") }),
      ...(dueDate !== undefined && { dueDate }),
      ...(options.assigneeId && { assigneeId: parseId(options.assigneeId, "assigneeId") }),
      ...(options.delegateToAgent && {
        delegatedToAgentId: parseId(options.delegateToAgent, "delegatedToAgentId"),
      }),
      tags,
      ...(listId !== undefined && { listId }),
      ...(labelId !== undefined && { labelId }),
    } as Omit<FunctionArgs<typeof api.tasks.core.create>, "apiKey">;

    const createResult = await client.mutation(api.tasks.core.create, createArgs);
    const createdTask = {
      _id: createResult.taskId,
      projectId: createResult.projectId,
      organizationId: createResult.organizationId,
      projectAlias: createResult.projectAlias,
      refNumber: createResult.refNumber,
      refId: createResult.refId,
      name: options.name,
    };
    const payload = {
      taskId: createResult.taskId,
      task: createdTask,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Task created");
      if (value.task) {
        console.log(`  ${value.task.refId} ${value.task.name}`);
      }
      console.log(`  ID: ${value.taskId}`);
      console.log();
    });
  });
});
