import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { summarizeOrganizations } from "../../lib/project-resolution.js";

type ListOrgsOptions = OutputOptions;

export const listOrgsCommand = addGlobalOptions(
  addOutputOptions(new Command("list").description("List accessible organizations"))
).action(async (options: ListOrgsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const [organizations, projects] = await Promise.all([
      client.query(api.organizations.core.listForUser, {}),
      client.query(api.projects.core.listAccessible, {}),
    ]);
    const rows = summarizeOrganizations(organizations, projects);

    printOutput(outputMode, rows, (rows) => {
      if (rows.length === 0) {
        console.log(chalk.dim("\nNo organizations found."));
        return;
      }

      console.log(chalk.bold(`\nFound ${rows.length} organization(s):\n`));
      for (const org of rows) {
        console.log(
          `  ${org.organizationName} (${org.organizationSlug}) ${chalk.dim(`[${org.organizationId}]`)} - ${org.projectCount} project(s)`
        );
      }
      console.log();
    });
  });
});
