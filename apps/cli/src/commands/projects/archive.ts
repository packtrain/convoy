import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { parseId } from "../../lib/id.js";
import { resolveProjectId, type AccessibleProject } from "../../lib/project-resolution.js";

interface ArchiveProjectOptions extends OutputOptions {
  org?: string;
}

/**
 * `listAccessible` needs a project membership, but org admins may archive without
 * one, so an unlisted ID goes to the server to decide. Aliases are 2-5 chars.
 */
function resolveArchiveTarget(projects: AccessibleProject[], projectRef: string, orgRef?: string): string {
  try {
    return resolveProjectId({ projects, projectRef, orgRef });
  } catch (error) {
    if (projectRef.trim().length <= 5) {
      throw error;
    }
    return projectRef.trim();
  }
}

/** `projects archive` and `projects unarchive`. Spec: docs/specs/project-archive.md */
function setArchivedCommand(name: "archive" | "unarchive", isArchived: boolean) {
  return addGlobalOptions(
    addOutputOptions(
      new Command(name)
        .description(isArchived ? "Hide a project from the sidebar and project pickers" : "Show an archived project again")
        .argument("<project>", "Project ID or alias")
        .option("--org <org>", "Organization ID or slug, when the alias exists in several")
    )
  ).action(async (projectRef: string, options: ArchiveProjectOptions, cmd: Command) => {
    await runOneShotCommand(cmd, async ({ client }) => {
      const outputMode = resolveOutputMode(options);
      const projects = await client.query(api.projects.core.listAccessible, {});
      const id = parseId<"projects">(resolveArchiveTarget(projects, projectRef, options.org), "projectId");
      await client.mutation(api.projects.core.setArchived, { id, isArchived });

      const alias = projects.find((project: AccessibleProject) => project._id === id)?.alias ?? id;
      printOutput(outputMode, { projectId: id, isArchived }, () => {
        console.log(chalk.green("✓") + ` ${isArchived ? "Archived" : "Unarchived"} ${alias}`);
      });
    });
  });
}

export const archiveProjectCommand = setArchivedCommand("archive", true);
export const unarchiveProjectCommand = setArchivedCommand("unarchive", false);
