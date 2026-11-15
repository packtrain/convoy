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
import { resolveRequiredStringInput } from "./parsers.js";

interface ReplaceTaskArtifactOptions extends OutputOptions {
  oldString?: string;
  oldStringFile?: string;
  newString?: string;
  newStringFile?: string;
  replaceAll?: boolean;
}

export const replaceTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("replace")
      .description("Replace an exact string in artifact content")
      .argument("<artifactId>", "Artifact ID")
      .option("--old-string <text>", "Exact existing string to replace")
      .option("--old-string-file <path>", "Read exact existing string from a file")
      .option("--new-string <text>", "Replacement string")
      .option("--new-string-file <path>", "Read replacement string from a file")
      .option("--replace-all", "Replace every occurrence")
  )
).action(async (artifactId: string, options: ReplaceTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const oldString = resolveRequiredStringInput({
      inlineValue: options.oldString,
      filePath: options.oldStringFile,
      inlineLabel: "--old-string",
      fileLabel: "--old-string-file",
      displayName: "old string",
    });
    const newString = resolveRequiredStringInput({
      inlineValue: options.newString,
      filePath: options.newStringFile,
      inlineLabel: "--new-string",
      fileLabel: "--new-string-file",
      displayName: "new string",
    });

    if (oldString.length === 0) {
      throw new Error("oldString must be non-empty.");
    }

    const parsedArtifactId = parseId(artifactId, "artifactId");
    const mutationArgs: Omit<
      FunctionArgs<typeof api.tasks.artifacts.replaceInTaskArtifact>,
      "apiKey"
    > = {
      artifactId: parsedArtifactId,
      oldString,
      newString,
      replaceAll: options.replaceAll === true,
    };

    await client.mutation(api.tasks.artifacts.replaceInTaskArtifact, mutationArgs);

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
