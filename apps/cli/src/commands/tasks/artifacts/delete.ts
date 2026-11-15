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

type DeleteTaskArtifactOptions = OutputOptions;

export const deleteTaskArtifactCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Delete an artifact")
      .argument("<artifactId>", "Artifact ID")
  )
).action(async (artifactId: string, options: DeleteTaskArtifactOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const parsedArtifactId = parseId(artifactId, "artifactId");
    await client.mutation(api.tasks.artifacts.deleteTaskArtifact, {
      artifactId: parsedArtifactId,
    });

    const payload = {
      artifactId: parsedArtifactId,
    };

    printOutput(outputMode, payload, () => {
      console.log(chalk.green("✓") + " Artifact deleted");
      console.log(`  ID: ${parsedArtifactId}`);
      console.log();
    });
  });
});
