import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../../convex/_generated/api.js";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../../cli.js";
import { parseId } from "../../../lib/id.js";
import { runOneShotCommand } from "../../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../../lib/output.js";
import { resolveArtifactContent, validateRunIdOptions } from "./parsers.js";

interface UpdateTaskArtifactOptions extends OutputOptions {
  name?: string;
  content?: string;
  contentFile?: string;
  clearContent?: boolean;
  runId?: string;
  clearRunId?: boolean;
}

export const updateTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Update artifact fields")
      .argument("<artifactId>", "Artifact ID")
      .option("--name <name>", "Artifact name")
      .option("--content <content>", "Artifact content")
      .option("--content-file <path>", "Read artifact content from a file")
      .option("--clear-content", "Clear artifact content")
      .option("--run-id <id>", "Optional run identifier")
      .option("--clear-run-id", "Clear run identifier")
  )
).action(async (artifactId: string, options: UpdateTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const content = resolveArtifactContent(options, true);
    validateRunIdOptions(options);

    const updates = {
      ...(options.name !== undefined && { name: options.name }),
      ...(content !== undefined && { content }),
      ...(options.runId !== undefined && { runId: options.runId }),
      ...(options.clearRunId === true && { runId: null }),
    };

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    const parsedArtifactId = parseId(artifactId, "artifactId");
    const mutationArgs: Omit<
      FunctionArgs<typeof api.tasks.artifacts.updateTaskArtifact>,
      "apiKey"
    > = {
      artifactId: parsedArtifactId,
      ...updates,
    };

    await client.mutation(api.tasks.artifacts.updateTaskArtifact, mutationArgs);

    const artifact = await client.query(api.tasks.artifacts.getTaskArtifact, {
      artifactId: parsedArtifactId,
    });

    if (!artifact) {
      throw new Error("Artifact updated but could not be reloaded.");
    }

    const payload = {
      artifactId: parsedArtifactId,
      artifact,
    };

    printOutput(outputMode, payload, (value) => {
      console.log(chalk.green("✓") + " Artifact updated");
      console.log(`  ${value.artifact.name}`);
      console.log(`  ID: ${value.artifactId}`);
      console.log();
    });
  });
});
