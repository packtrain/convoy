import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import { addGlobalOptions } from "../../../cli.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../../lib/output.js";

import { parseCommentStatus } from "./comments/parsers.js";
import {
  groupCommentThreads,
  printCommentThreads,
  type ArtifactCommentThread,
} from "./comments/formatters.js";

interface GetTaskArtifactOptions extends OutputOptions {
  comments?: boolean;
  commentsStatus?: string;
}

export const getTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("get")
      .description("Get a document artifact by ID")
      .argument("<artifactId>", "Artifact ID")
      .option("--comments", "Include the artifact's comment threads")
      .option(
        "--comments-status <status>",
        "With --comments, only threads with this root status (open|resolved)"
      )
  )
).action(async (artifactId: string, options: GetTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const id = parseId<"taskArtifacts">(artifactId, "artifactId");
    const artifact = await client.query(api.tasks.artifacts.getTaskArtifact, {
      artifactId: id,
    });

    if (!artifact) {
      throw new Error("Artifact not found or not accessible.");
    }

    let threads: ArtifactCommentThread[] | undefined;
    if (options.comments) {
      const status =
        options.commentsStatus === undefined
          ? undefined
          : parseCommentStatus(options.commentsStatus);
      const comments = await client.query(api.tasks.artifactComments.listByArtifact, {
        artifactId: id,
        ...(status !== undefined && { status }),
      });
      threads = groupCommentThreads(comments);
    }

    printOutput(
      outputMode,
      threads === undefined ? artifact : { ...artifact, comments: threads },
      (value) => {
        console.log(chalk.bold(`\n${value.name}`));
        console.log(`  ID: ${value._id}`);
        console.log(`  Task ID: ${value.taskId}`);
        console.log(`  File: ${value.fileName}`);
        console.log(`  Type: ${value.contentType ?? "markdown"}`);
        console.log(`  Source: ${value.source}`);
        console.log(`  Run ID: ${value.runId ?? "None"}`);
        console.log(`  Updated: ${new Date(value.updatedAt).toISOString()}`);
        console.log();
        console.log(value.content.length > 0 ? value.content : "(empty)");
        console.log();
        if (threads !== undefined) {
          console.log(chalk.bold(`Comments (${threads.length})`));
          printCommentThreads(threads);
        }
      }
    );
  });
});
