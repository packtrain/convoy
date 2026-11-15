import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/index.js";
import { normalizeLabelName, resolveLabelId } from "../labels/resolve.js";
import {
  parseOptionalDueDate,
  parseOptionalTags,
  parseOptionalTaskPriority,
  parseOptionalTaskStatus,
  parseOptionalTaskTypeKey,
  validateNoConflict,
} from "./parsers.js";

interface UpdateTaskOptions extends OutputOptions {
  name?: string;
  taskTypeKey?: string;
  description?: string;
  clearDescription?: boolean;
  priority?: string;
  status?: string;
  dueDate?: string;
  clearDueDate?: boolean;
  assigneeId?: string;
  unassign?: boolean;
  delegateToAgent?: string;
  clearDelegation?: boolean;
  tags?: string[];
  clearTags?: boolean;
  label?: string;
  clearLabel?: boolean;
  checklist?: string;
  /** False when `--no-checks` is passed. */
  checks?: boolean;
}

/** Resolve a checklist ID or exact name (normalized like label names), same contract as the MCP handler. */
async function resolveChecklistId(
  client: ConvoyClient,
  projectId: Id<"projects">,
  identifier: string
): Promise<Id<"checklists">> {
  const checklists: { _id: Id<"checklists">; name: string }[] = await client.query(
    api.checks.checklists.list,
    { projectId }
  );
  const normalized = normalizeLabelName(identifier);
  const checklist = checklists.find(
    (c) => c._id === identifier || normalizeLabelName(c.name) === normalized
  );
  if (!checklist) {
    throw new Error(
      `checklist "${identifier}" did not match any checklist in the project. Use the list_checklists MCP tool to see available checklists.`
    );
  }
  return checklist._id;
}

export const updateTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Update task fields")
      .argument("<taskId>", "Task ID")
      .option("--name <name>", "Task name")
      .option("--task-type-key <key>", "Task type key")
      .option("--description <description>", "Task description")
      .option("--clear-description", "Clear task description")
      .option("--priority <priority>", "Priority: None|Low|Medium|High|Critical")
      .option("--status <status>", "Task status")
      .option("--due-date <value>", "Due date (unix seconds/ms or ISO-8601)")
      .option("--clear-due-date", "Clear due date")
      .option("--assignee-id <userId>", "Assign task to this user ID (human owner)")
      .option("--unassign", "Clear assignee")
      .option("--delegate-to-agent <projectAgentId>", "Delegate execution to this project agent")
      .option("--clear-delegation", "Clear the delegated agent (assignee is kept)")
      .option("--tags <tag...>", "Set tags (repeat and/or comma-separate values)")
      .option("--clear-tags", "Clear all tags")
      .option("--label <label>", "Set the task's label (ID or exact name)")
      .option("--clear-label", "Clear the task's label")
      .option("--checklist <checklist>", "Set the task's checklist (ID or exact name)")
      .option("--no-checks", "Give the task no checks")
  )
).action(async (taskId: string, options: UpdateTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    validateNoConflict(
      options.clearDescription === true,
      options.description !== undefined,
      "Cannot use --description and --clear-description together"
    );
    validateNoConflict(
      options.clearDueDate === true,
      options.dueDate !== undefined,
      "Cannot use --due-date and --clear-due-date together"
    );
    validateNoConflict(
      options.unassign === true,
      options.assigneeId !== undefined,
      "Cannot use --assignee-id and --unassign together"
    );
    validateNoConflict(
      options.clearDelegation === true,
      options.delegateToAgent !== undefined,
      "Cannot use --delegate-to-agent and --clear-delegation together"
    );
    validateNoConflict(
      options.clearTags === true,
      options.tags !== undefined,
      "Cannot use --tags and --clear-tags together"
    );
    validateNoConflict(
      options.clearLabel === true,
      options.label !== undefined,
      "Cannot use --label and --clear-label together"
    );
    validateNoConflict(
      options.checks === false,
      options.checklist !== undefined,
      "Cannot use --checklist and --no-checks together"
    );

    const taskTypeKey = parseOptionalTaskTypeKey(options.taskTypeKey);
    const priority = parseOptionalTaskPriority(options.priority);
    const status = parseOptionalTaskStatus(options.status);
    const dueDate = parseOptionalDueDate(options.dueDate);
    const tags = parseOptionalTags(options.tags);
    const parsedTaskId = parseId(taskId, "taskId");

    // Resolving a label or checklist by name needs the task's project, so fetch it up front.
    const getProjectId = async () => {
      const task = await client.query(api.tasks.core.getById, { id: parsedTaskId });
      if (!task) {
        throw new Error("Task not found");
      }
      return task.projectId;
    };
    let labelId: string | null | undefined;
    if (options.clearLabel === true) {
      labelId = null;
    } else if (options.label !== undefined) {
      labelId = await resolveLabelId(client, await getProjectId(), options.label);
    }
    let checklistId: Id<"checklists"> | null | undefined;
    if (options.checks === false) {
      checklistId = null;
    } else if (options.checklist !== undefined) {
      checklistId = await resolveChecklistId(client, await getProjectId(), options.checklist);
    }

    const updates = {
      ...(options.name !== undefined && { name: options.name }),
      ...(taskTypeKey !== undefined && { taskTypeKey }),
      ...(options.description !== undefined && { description: options.description }),
      ...(options.clearDescription === true && { description: null }),
      ...(priority !== undefined && { priority }),
      ...(status !== undefined && { status }),
      ...(dueDate !== undefined && { dueDate }),
      ...(options.clearDueDate === true && { dueDate: null }),
      ...(options.assigneeId !== undefined && {
        assigneeId: parseId(options.assigneeId, "assigneeId"),
      }),
      ...(options.unassign === true && { assigneeId: null }),
      ...(options.delegateToAgent !== undefined && {
        delegatedToAgentId: parseId(options.delegateToAgent, "delegatedToAgentId"),
      }),
      ...(options.clearDelegation === true && { delegatedToAgentId: null }),
      ...(tags !== undefined && { tags }),
      ...(options.clearTags === true && { tags: [] }),
      ...(labelId !== undefined && { labelId }),
    };

    if (Object.keys(updates).length === 0 && checklistId === undefined) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    if (checklistId !== undefined) {
      await client.mutation(api.tasks.core.setChecklist, { taskId: parsedTaskId, checklistId });
    }
    if (Object.keys(updates).length > 0) {
      const mutationArgs = {
        id: parsedTaskId,
        ...updates,
      } as Omit<FunctionArgs<typeof api.tasks.core.update>, "apiKey">;

      await client.mutation(api.tasks.core.update, mutationArgs);
    }

    const updatedTask = await client.query(api.tasks.core.getById, {
      id: parsedTaskId,
    });

    const payload = {
      taskId,
      task: updatedTask,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Task updated");
      if (value.task) {
        console.log(`  ${value.task.refId} ${value.task.name}`);
      }
      console.log(`  ID: ${value.taskId}`);
      console.log();
    });
  });
});
