import { Command } from "commander";
import chalk from "chalk";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { formatFileSize } from "./attachments/formatters.js";
import { resolveTaskIdForAttachmentCommand } from "./attachments/resolve.js";
import { uploadTaskAttachmentFile } from "./attachments/transfer.js";

interface AttachTaskOptions extends OutputOptions {
  org?: string;
}

type UploadedAttachment = Awaited<ReturnType<typeof uploadTaskAttachmentFile>>;

interface FailedAttachmentUpload {
  file: string;
  error: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const attachTaskCommand = addGlobalOptions(
  addOutputOptions(
    new Command("attach")
      .description("Upload one or more files to a task")
      .argument("<taskId>", "Task ID or ref")
      .argument("<files...>", "Files to upload")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (taskId: string, files: string[], options: AttachTaskOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolvedTaskId = await resolveTaskIdForAttachmentCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });

    const uploads: UploadedAttachment[] = [];
    const failures: FailedAttachmentUpload[] = [];

    for (const file of files) {
      try {
        uploads.push(await uploadTaskAttachmentFile(client, resolvedTaskId, file));
      } catch (error) {
        failures.push({
          file,
          error: getErrorMessage(error),
        });
      }
    }

    const payload = {
      taskId: resolvedTaskId,
      attachments: uploads,
      failures,
    };

    printOutput(outputMode, payload, (value) => {
      if (value.failures.length === 0) {
        console.log(chalk.green("✓") + ` Uploaded ${value.attachments.length} attachment(s)`);
      } else {
        console.log(chalk.yellow("!") + ` Uploaded ${value.attachments.length} attachment(s), ${value.failures.length} failed`);
      }

      if (value.attachments.length > 0) {
        console.log("  Uploaded:");
        for (const attachment of value.attachments) {
          console.log(
            `    - ${attachment.fileName} (${attachment.attachmentId}) ${formatFileSize(attachment.fileSize)} ${attachment.contentType}`
          );
        }
      }

      if (value.failures.length > 0) {
        console.log("  Failed:");
        for (const failure of value.failures) {
          console.log(`    - ${failure.file}: ${failure.error}`);
        }
      }
      console.log();
    });

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  });
});
