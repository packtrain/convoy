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
import { ArtifactCommentStatus } from "./parsers.js";

function makeStatusCommand(name: string, status: ArtifactCommentStatus, verb: string): Command {
  return addGlobalOptions(
    addOutputOptions(
      new Command(name)
        .description(`${verb} root artifact comments (atomic batch)`)
        .argument("<commentIds...>", "Root comment IDs")
    )
  ).action(async (commentIds: string[], options: OutputOptions, cmd: Command) => {
    await runOneShotCommand(cmd, async ({ client }) => {
      const outputMode = resolveOutputMode(options);

      await client.mutation(api.tasks.artifactComments.setStatus, {
        commentIds: commentIds.map((id) => parseId(id, "commentId")),
        status,
      });

      printOutput(outputMode, { commentIds, status }, (value) => {
        console.log(
          chalk.green(
            `${verb}d ${value.commentIds.length} comment${value.commentIds.length === 1 ? "" : "s"}.`
          )
        );
      });
    });
  });
}

export const resolveArtifactCommentsCommand = makeStatusCommand("resolve", "resolved", "Resolve");
export const unresolveArtifactCommentsCommand = makeStatusCommand("unresolve", "open", "Unresolve");
