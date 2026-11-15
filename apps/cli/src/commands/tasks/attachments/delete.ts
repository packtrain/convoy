import { confirm } from "@inquirer/prompts";
import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import { addGlobalOptions } from "../../../cli.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { findTaskAttachment, listTaskAttachments, resolveTaskIdForAttachmentCommand } from "./resolve.js";

interface DeleteTaskAttachmentOptions extends OutputOptions {
  org?: string;
  yes?: boolean;
}

export const deleteTaskAttachmentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Delete a task file attachment")
      .argument("<taskId>", "Task ID or ref")
      .argument("<attachmentId>", "Attachment ID")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("-y, --yes", "Skip confirmation")
  )
).action(async (taskId: string, attachmentId: string, options: DeleteTaskAttachmentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolvedTaskId = await resolveTaskIdForAttachmentCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });
    const parsedAttachmentId = parseId<"taskAttachments">(attachmentId, "attachmentId");
    const attachments = await listTaskAttachments(client, resolvedTaskId);
    const attachment = findTaskAttachment(attachments, parsedAttachmentId);

    if (!options.yes) {
      const shouldDelete = await confirm({
        message: `Delete attachment "${attachment.fileName}"?`,
        default: false,
      });
      if (!shouldDelete) {
        const payload = {
          taskId: resolvedTaskId,
          attachmentId: parsedAttachmentId,
          deleted: false,
        };
        printOutput(outputMode, payload, () => {
          console.log(chalk.dim("\nCancelled."));
          console.log();
        });
        return;
      }
    }

    await client.mutation(api.tasks.attachments.deleteTaskAttachment, {
      attachmentId: parsedAttachmentId,
    });

    const payload = {
      taskId: resolvedTaskId,
      attachmentId: parsedAttachmentId,
      deleted: true,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Attachment deleted");
      console.log(`  ID: ${value.attachmentId}`);
      console.log();
    });
  });
});
