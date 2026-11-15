import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

interface CreateLabelOptions extends OutputOptions {
  name: string;
  color?: string;
  org?: string;
}

export const createLabelCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a project label")
      .requiredOption("--name <name>", "Label name (unique per project, max 50 chars)")
      .option("--color <hex>", "Label color from the extended palette (default: blue)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: CreateLabelOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const color = parseOptionalNonEmptyString(options.color, "Color");

    const labelId = await client.mutation(api.tasks.labels.create, {
      projectId,
      name: options.name,
      ...(color !== undefined && { color }),
    });

    printOutput(outputMode, { labelId }, (value) => {
      console.log(chalk.green("✓") + " Label created");
      console.log(`  ${options.name}`);
      console.log(`  ID: ${value.labelId}`);
      console.log();
    });
  });
});
