import { Command } from "commander";
import chalk from "chalk";
import { addGlobalOptions } from "../../../cli.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { printOutput, resolveOutputMode } from "../../../lib/output.js";
import { downloadTaskAttachment } from "./transfer.js";
import { findTaskAttachment, listTaskAttachments, resolveTaskIdForAttachmentCommand } from "./resolve.js";

interface DownloadTaskAttachmentOptions {
  org?: string;
  json?: boolean;
  output?: string;
  force?: boolean;
}

export const downloadTaskAttachmentCommand = addGlobalOptions(
  new Command("download")
    .description("Download a task file attachment")
    .argument("<taskId>", "Task ID or ref")
    .argument("<attachmentId>", "Attachment ID")
    .option("--org <org>", "Organization ID or slug (used with --project alias)")
    .option("--output <path>", "Output file path (default: current directory with original filename)")
    .option("-f, --force", "Overwrite an existing file")
    .option("--json", "Print JSON output")
).action(async (taskId: string, attachmentId: string, options: DownloadTaskAttachmentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode({ json: options.json });
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
    const outputPath = await downloadTaskAttachment(attachment, options.output, { force: options.force });

    const payload = {
      taskId: resolvedTaskId,
      attachmentId: parsedAttachmentId,
      outputPath,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Attachment downloaded");
      console.log(`  ID: ${value.attachmentId}`);
      console.log(`  Path: ${value.outputPath}`);
      console.log();
    });
  });
});
