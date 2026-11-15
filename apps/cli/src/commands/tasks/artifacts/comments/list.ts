import { Command } from "commander";
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
import { groupCommentThreads, printCommentThreads } from "./formatters.js";
import { parseCommentStatus } from "./parsers.js";

interface ListArtifactCommentsOptions extends OutputOptions {
  status?: string;
}

export const listArtifactCommentsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List an artifact's comment threads")
      .argument("<artifactId>", "Artifact ID")
      .option("--status <status>", "Only threads with this root status (open|resolved)")
  )
).action(async (artifactId: string, options: ListArtifactCommentsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const status = options.status === undefined ? undefined : parseCommentStatus(options.status);

    const comments = await client.query(api.tasks.artifactComments.listByArtifact, {
      artifactId: parseId(artifactId, "artifactId"),
      ...(status !== undefined && { status }),
    });
    const threads = groupCommentThreads(comments);

    printOutput(outputMode, threads, printCommentThreads);
  });
});
