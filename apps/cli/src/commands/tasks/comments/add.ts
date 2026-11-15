import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../../cli.js";
import { api } from "../../../convex/_generated/api.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { resolveRequiredStringInput } from "../../../lib/text-input.js";
import { resolveTaskIdForCommand } from "../resolve.js";

interface AddTaskCommentOptions extends OutputOptions {
  org?: string;
  message?: string;
  messageFile?: string;
}

export const addTaskCommentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("add")
      .description("Create a markdown comment on a task")
      .argument("<taskId>", "Task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("-m, --message <text>", "Comment body (markdown)")
      .option("--message-file <path>", "Read the comment body from a file")
  )
).action(async (taskId: string, options: AddTaskCommentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const content = resolveRequiredStringInput({
      inlineValue: options.message,
      filePath: options.messageFile,
      inlineLabel: "--message",
      fileLabel: "--message-file",
      displayName: "message",
    }).trim();
    if (content.length === 0) {
      throw new Error("Comment content must be non-empty.");
    }

    const resolvedTaskId = await resolveTaskIdForCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });
    const commentId = await client.mutation(api.tasks.comments.create, {
      taskId: resolvedTaskId,
      content,
    });

    printOutput(outputMode, { taskId: resolvedTaskId, commentId }, (value) => {
      console.log(chalk.green("✓") + " Task comment created");
      console.log(`  Comment ID: ${value.commentId}`);
    });
  });
});
