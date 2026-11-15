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
import { resolveTaskIdForCommand } from "../resolve.js";

interface MoveTaskArtifactOptions extends OutputOptions {
  org?: string;
  toTask: string;
}

export const moveTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("move")
      .description("Move an artifact to another task in the same project")
      .argument("<artifactId>", "Artifact ID")
      .requiredOption("--to-task <taskId>", "Target task ID or ref")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (artifactId: string, options: MoveTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const parsedArtifactId = parseId(artifactId, "artifactId");
    const targetTaskId = await resolveTaskIdForCommand({
      client,
      config,
      cmd,
      taskIdOrRef: options.toTask,
      org: options.org,
    });
    await client.mutation(api.tasks.artifacts.moveTaskArtifact, {
      artifactId: parsedArtifactId,
      taskId: targetTaskId,
    });

    const payload = {
      artifactId: parsedArtifactId,
      taskId: targetTaskId,
    };

    printOutput(outputMode, payload, () => {
      console.log(chalk.green("✓") + " Artifact moved");
      console.log(`  ID: ${parsedArtifactId}`);
      console.log(`  Task: ${targetTaskId}`);
      console.log();
    });
  });
});
