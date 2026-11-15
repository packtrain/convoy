import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import { addGlobalOptions } from "../../../cli.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { findTaskAttachment, listTaskAttachments, resolveTaskIdForAttachmentCommand } from "./resolve.js";

interface MoveTaskAttachmentOptions extends OutputOptions {
  org?: string;
  toTask: string;
}

export const moveTaskAttachmentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("move")
      .description("Move a task file attachment to another task in the same project")
      .argument("<taskId>", "Source task ID or ref")
      .argument("<attachmentId>", "Attachment ID")
      .requiredOption("--to-task <taskId>", "Target task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (taskId: string, attachmentId: string, options: MoveTaskAttachmentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolveTask = (taskIdOrRef: string) =>
      resolveTaskIdForAttachmentCommand({
        client,
        config,
        cmd,
        taskIdOrRef,
        org: options.org,
      });

    const resolvedTaskId = await resolveTask(taskId);
    const parsedAttachmentId = parseId<"taskAttachments">(attachmentId, "attachmentId");
    // Fails before the mutation when the attachment is on a different task.
    const attachments = await listTaskAttachments(client, resolvedTaskId);
    const attachment = findTaskAttachment(attachments, parsedAttachmentId);
    const targetTaskId = await resolveTask(options.toTask);

    await client.mutation(api.tasks.attachments.moveTaskAttachment, {
      attachmentId: parsedAttachmentId,
      taskId: targetTaskId,
    });

    const payload = {
      attachmentId: parsedAttachmentId,
      fileName: attachment.fileName,
      fromTaskId: resolvedTaskId,
      taskId: targetTaskId,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Attachment moved");
      console.log(`  File: ${value.fileName}`);
      console.log(`  Task: ${value.taskId}`);
      console.log();
    });
  });
});
