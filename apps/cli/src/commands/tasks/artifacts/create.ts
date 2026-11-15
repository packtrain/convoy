import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../../cli.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../../lib/output.js";
import { resolveTaskIdForCommand } from "../resolve.js";
import { resolveArtifactContent } from "./parsers.js";

const ARTIFACT_CONTENT_TYPES = ["markdown", "html"] as const;
type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

function parseContentType(value: string | undefined): ArtifactContentType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(ARTIFACT_CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new Error(`--content-type must be one of: ${ARTIFACT_CONTENT_TYPES.join(", ")}`);
  }
  return value as ArtifactContentType;
}

interface CreateTaskArtifactOptions extends OutputOptions {
  org?: string;
  name: string;
  content?: string;
  contentFile?: string;
  contentType?: string;
  runId?: string;
}

export const createTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a document artifact (markdown or html) on a task")
      .argument("<taskId>", "Task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .requiredOption("--name <name>", "Artifact name")
      .option("--content <content>", "Artifact content")
      .option("--content-file <path>", "Read artifact content from a file")
      .option(
        "--content-type <type>",
        "Artifact content type: markdown or html (default: markdown)"
      )
      .option("--run-id <id>", "Optional run identifier")
  )
).action(async (taskId: string, options: CreateTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const content = resolveArtifactContent(options, false);
    const contentType = parseContentType(options.contentType);
    const resolvedTaskId = await resolveTaskIdForCommand({
      client,
      config,
      cmd,
      taskIdOrRef: taskId,
      org: options.org,
    });
    const createArgs: Omit<
      FunctionArgs<typeof api.tasks.artifacts.createTaskArtifact>,
      "apiKey"
    > = {
      taskId: resolvedTaskId,
      name: options.name,
    };

    if (content !== undefined) {
      createArgs.content = content;
    }
    if (contentType !== undefined) {
      createArgs.contentType = contentType;
    }
    if (options.runId !== undefined) {
      createArgs.runId = options.runId;
    }

    const artifactId = await client.mutation(
      api.tasks.artifacts.createTaskArtifact,
      createArgs
    );

    const artifact = await client.query(api.tasks.artifacts.getTaskArtifact, {
      artifactId,
    });

    if (!artifact) {
      throw new Error("Artifact created but could not be reloaded.");
    }

    const payload = {
      artifactId,
      artifact,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Artifact created");
      console.log(`  ${value.artifact.name}`);
      console.log(`  ID: ${value.artifactId}`);
      console.log();
    });
  });
});
