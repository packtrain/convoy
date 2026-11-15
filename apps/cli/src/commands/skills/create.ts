import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { addScopeOptions, resolveScopeTarget, type ScopeOptions } from "../../lib/scope-resolution.js";
import { resolveRequiredStringInput } from "../../lib/text-input.js";

interface CreateSkillOptions extends ScopeOptions {
  name: string;
  content?: string;
  contentFile?: string;
  description?: string;
  category?: string;
}

export const createSkillCommand = addGlobalOptions(
  addOutputOptions(
    addScopeOptions(
      new Command("create")
        .description("Create a Skill in a project or an organization")
        .requiredOption("--name <name>", "Skill name (2-64 lowercase letters, numbers, hyphens)")
        .option("--content <content>", "SKILL.md content")
        .option("--content-file <path>", "Read SKILL.md content from a file")
        .option("--description <description>", "Short description")
        .option("--category <category>", "Category label"),
      "Skill"
    )
  )
).action(async (options: CreateSkillOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const content = resolveRequiredStringInput({
      inlineValue: options.content,
      filePath: options.contentFile,
      inlineLabel: "--content",
      fileLabel: "--content-file",
      displayName: "SKILL.md",
    });
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    const target = await resolveScopeTarget(client, config, cmd, options);

    const shared = {
      name: options.name,
      content,
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
    };

    const skillId =
      target.scope === "organization"
        ? await client.mutation(api.skills.core.createInOrganization, {
            organizationId: target.organizationId,
            ...shared,
          })
        : await client.mutation(api.skills.core.createInProject, {
            projectId: target.projectId,
            ...shared,
          });

    printOutput(outputMode, { skillId }, (value) => {
      console.log(chalk.green("✓") + ` Skill created (${target.scope})`);
      console.log(`  /${options.name}`);
      console.log(`  ID: ${value.skillId}`);
      console.log();
    });
  });
});
