import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { resolveLabelId } from "./resolve.js";

interface UpdateLabelOptions extends OutputOptions {
  name?: string;
  color?: string;
  org?: string;
}

export const updateLabelCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Rename or recolor a project label")
      .argument("<label>", "Label ID or exact name")
      .option("--name <name>", "New label name")
      .option("--color <hex>", "New label color from the extended palette")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (label: string, options: UpdateLabelOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const name = parseOptionalNonEmptyString(options.name, "Name");
    const color = parseOptionalNonEmptyString(options.color, "Color");

    if (name === undefined && color === undefined) {
      throw new Error("No updates provided. Pass --name and/or --color.");
    }

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const labelId = await resolveLabelId(client, projectId, label);

    await client.mutation(api.tasks.labels.update, {
      labelId,
      ...(name !== undefined && { name }),
      ...(color !== undefined && { color }),
    });

    printOutput(outputMode, { labelId }, (value) => {
      console.log(chalk.green("✓") + " Label updated");
      console.log(`  ID: ${value.labelId}`);
      console.log();
    });
  });
});
