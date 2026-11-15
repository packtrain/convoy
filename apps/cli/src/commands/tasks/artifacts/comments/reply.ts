import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../../convex/_generated/api.js";
import { addGlobalOptions } from "../../../../cli.js";
import { parseId } from "../../../../lib/id.js";
import { runOneShotCommand } from "../../../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../../../lib/output.js";

interface ReplyArtifactCommentOptions extends OutputOptions {
  message: string;
}

export const replyArtifactCommentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("reply")
      .description("Reply to a root artifact comment")
      .argument("<commentId>", "Root comment ID to reply to")
      .requiredOption("-m, --message <text>", "Reply body (markdown)")
  )
).action(async (commentId: string, options: ReplyArtifactCommentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);

    const replyId = await client.mutation(api.tasks.artifactComments.reply, {
      parentId: parseId(commentId, "commentId"),
      content: options.message,
    });

    printOutput(outputMode, { commentId: replyId }, (value) => {
      console.log(chalk.green(`Reply created: ${value.commentId}`));
    });
  });
});
