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
import { filterProjectsByOrgRef } from "../../lib/project-resolution.js";

interface ListProjectsOptions extends OutputOptions {
  org?: string;
}

export const listProjectsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List projects")
      .option("--org <org>", "Filter by organization ID or slug")
  )
).action(async (options: ListProjectsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const projects = await client.query(api.projects.core.listAccessible, {});
    const filtered = options.org
      ? filterProjectsByOrgRef(projects, options.org)
      : projects;

    printOutput(outputMode, filtered, (rows) => {
      if (rows.length === 0) {
        console.log(chalk.dim("\nNo projects found."));
        return;
      }

      const byOrg = new Map<string, typeof rows>();
      for (const project of rows) {
        const key = project.organizationName;
        if (!byOrg.has(key)) {
          byOrg.set(key, []);
        }
        byOrg.get(key)!.push(project);
      }

      console.log(chalk.bold(`\nFound ${rows.length} project(s):\n`));
      for (const [orgName, orgProjects] of byOrg) {
        console.log(chalk.bold(orgName));
        for (const project of orgProjects) {
          console.log(
            `  ${chalk.cyan(project.alias.padEnd(6))} ${project.name} ${chalk.dim(`(${project._id})`)}`
          );
        }
        console.log();
      }
    });
  });
});
