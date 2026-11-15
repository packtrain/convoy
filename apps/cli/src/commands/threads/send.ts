import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { readTextFile } from "../../lib/text-input.js";
import { requireThreadProject, withThreadAttachments } from "../../lib/thread-attachments.js";

interface SendThreadMessageOptions extends OutputOptions {
  contentFile?: string;
  attach?: string[];
}

export const sendThreadMessageCommand = addGlobalOptions(
  addOutputOptions(
    new Command("send")
      .description("Queue a message in a CLI thread for its next run")
      .argument("<threadId>", "Thread ID")
      .argument("[content]", "Message text")
      .option("--content-file <path>", "Read the message from a file")
      .option("--attach <file...>", "Files to attach")
  )
).action(async (threadId: string, positional: string | undefined, options: SendThreadMessageOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    if (positional !== undefined && options.contentFile !== undefined) {
      throw new Error("Cannot use a content argument and --content-file together");
    }

    const content = (
      options.contentFile === undefined
        ? (positional ?? "")
        : readTextFile(options.contentFile, "content")
    ).trim();
    const attach = options.attach ?? [];
    if (content.length === 0 && attach.length === 0) {
      throw new Error("Pass a content argument, --content-file, or --attach.");
    }

    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    const projectId = await requireThreadProject(client, parsedThreadId);

    const messageId = await withThreadAttachments(client, projectId, attach, (attachments) =>
      client.mutation(api.cli.messages.send, {
        threadId: parsedThreadId,
        content,
        ...(attachments.length === 0 ? {} : { attachments }),
      })
    );

    printOutput(outputMode, { threadId: parsedThreadId, messageId }, (value) => {
      console.log(chalk.green("✓") + " Message queued");
      console.log(`  Message ID: ${value.messageId}`);
      console.log();
    });
  });
});
