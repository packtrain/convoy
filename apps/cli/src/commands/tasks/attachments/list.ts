import { Command } from "commander";
import chalk from "chalk";
import { addGlobalOptions } from "../../../cli.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../../lib/output.js";
import { formatAttachmentSummaryLine } from "./formatters.js";
import { listTaskAttachments, resolveTaskIdForAttachmentCommand } from "./resolve.js";

interface ListTaskAttachmentsOptions extends OutputOptions {
  org?: string;
}

export const listTaskAttachmentsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List task file attachments")
      .argument("<taskId>", "Task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (taskId: string, options: ListTaskAttachmentsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolvedTaskId = await resolveTaskIdForAttachmentCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });
    const attachments = await listTaskAttachments(client, resolvedTaskId);

    printOutput(outputMode, attachments, (value) => {
      console.log(chalk.bold(`\nAttachments for ${taskId}`));
      if (value.length === 0) {
        console.log("  (none)");
        console.log();
        return;
      }

      for (const attachment of value) {
        console.log(`  - ${formatAttachmentSummaryLine(attachment)}`);
      }
      console.log();
    });
  });
});
