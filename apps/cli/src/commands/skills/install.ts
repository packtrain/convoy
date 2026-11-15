import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand, type AccessibleProject } from "../../lib/project-resolution.js";
import type { Skill } from "./formatters.js";

interface InstallSkillOptions extends OutputOptions {
  org?: string;
}

export const installSkillCommand = addGlobalOptions(
  addOutputOptions(
    new Command("install")
      .description("Install an organization Skill into the project as an independent copy")
      .argument("<name>", "Organization Skill name")
      // `--project` alone is ambiguous when the same alias exists in two
      // organizations, and that resolver error tells the user to pass this.
      .option("--org <org>", "Organization ID or slug")
  )
).action(async (name: string, options: InstallSkillOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    // The template is looked up in the project's own organization: an install
    // crosses no organization boundary (docs/specs/skills.md#scope-and-install-model).
    const { projects, projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    // A configured project the caller has since lost access to resolves but is not
    // in the list, so its organization is genuinely unknown here.
    const project = projects.find((candidate: AccessibleProject) => candidate._id === projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" is not accessible, so its organization's skills cannot be listed.`);
    }

    const skills: Skill[] = await client.query(api.skills.core.listByOrganization, {
      organizationId: parseId<"organizations">(project.organizationId, "organizationId"),
    });
    // Names render as `/name` everywhere, so that is the form users paste.
    const normalizedName = name.trim().replace(/^\//, "").toLowerCase();
    const skill = skills.find((candidate) => candidate.normalizedName === normalizedName);
    if (!skill) {
      throw new Error(`Organization skill "${name}" was not found. Run 'convoy skills list --scope organization' to see them.`);
    }

    const skillId = await client.mutation(api.skills.core.copyFromSkill, { projectId, skillId: skill._id });

    printOutput(outputMode, { skillId, sourceSkillId: skill._id }, (value) => {
      console.log(chalk.green("✓") + " Skill installed");
      console.log(`  /${normalizedName}`);
      console.log(`  ID: ${value.skillId}`);
      console.log();
    });
  });
});
