import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { resolveLabelId } from "./resolve.js";

// CLI-friendly tokens mapped to the backend resolution enum.
const RESOLUTIONS = {
  clear: "clear",
  reassign: "reassign",
  archive: "archiveTasks",
} as const;

type ResolutionToken = keyof typeof RESOLUTIONS;

interface DeleteLabelOptions extends OutputOptions {
  resolution?: string;
  reassignTo?: string;
  org?: string;
}

function parseResolution(value: string | undefined): ResolutionToken {
  if (value === undefined) {
    return "clear";
  }
  if (!(value in RESOLUTIONS)) {
    throw new Error(`Invalid resolution "${value}". Valid values: ${Object.keys(RESOLUTIONS).join(", ")}`);
  }
  return value as ResolutionToken;
}

export const deleteLabelCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Delete a project label, resolving every task that references it")
      .argument("<label>", "Label ID or exact name")
      .option("--resolution <mode>", "How to resolve referencing tasks: clear (default), reassign, archive")
      .option("--reassign-to <label>", "Target label ID or name (required for --resolution reassign)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (label: string, options: DeleteLabelOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const resolutionToken = parseResolution(options.resolution);

    if (resolutionToken === "reassign" && !options.reassignTo) {
      throw new Error("--reassign-to is required when --resolution is 'reassign'.");
    }

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const labelId = await resolveLabelId(client, projectId, label);
    const reassignToLabelId =
      options.reassignTo !== undefined ? await resolveLabelId(client, projectId, options.reassignTo, "--reassign-to") : undefined;

    const result = await client.mutation(api.tasks.labels.remove, {
      labelId,
      resolution: RESOLUTIONS[resolutionToken],
      ...(reassignToLabelId !== undefined && { reassignToLabelId }),
    });

    printOutput(outputMode, result, (value) => {
      console.log(chalk.green("✓") + " Label deleted");
      console.log(`  ${value.affectedTaskIds.length} task(s) resolved (${resolutionToken})`);
      console.log();
    });
  });
});
