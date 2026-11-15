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

interface AddArtifactCommentOptions extends OutputOptions {
  anchor: string;
  occurrence?: string;
  message: string;
}

export const addArtifactCommentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("add")
      .description("Comment on a text snippet in a markdown artifact")
      .argument("<artifactId>", "Artifact ID")
      .requiredOption(
        "--anchor <text>",
        "Exact snippet from the artifact content to attach the comment to"
      )
      .option(
        "--occurrence <n>",
        "Which match of the anchor text to use when it appears multiple times (1-based, default 1)"
      )
      .requiredOption("-m, --message <text>", "Comment body (markdown)")
  )
).action(async (artifactId: string, options: AddArtifactCommentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    // Number() rejects trailing garbage ("2x") that parseInt would swallow.
    const occurrence = options.occurrence === undefined ? undefined : Number(options.occurrence);
    if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) {
      throw new Error("--occurrence must be a positive integer");
    }

    const commentId = await client.mutation(api.tasks.artifactComments.create, {
      artifactId: parseId(artifactId, "artifactId"),
      content: options.message,
      anchorText: options.anchor,
      ...(occurrence !== undefined && { anchorOccurrence: occurrence }),
    });

    printOutput(outputMode, { commentId }, (value) => {
      console.log(chalk.green(`Comment created: ${value.commentId}`));
    });
  });
});
