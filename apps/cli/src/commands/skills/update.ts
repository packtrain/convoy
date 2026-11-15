import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveAbsentableStringInput } from "../../lib/text-input.js";
import { validateNoConflict } from "../tasks/parsers.js";

interface UpdateSkillOptions extends OutputOptions {
  name?: string;
  content?: string;
  contentFile?: string;
  description?: string;
  category?: string;
  clearDescription?: boolean;
  clearCategory?: boolean;
}

// No --org: the stored Skill carries its own scope, and the backend derives
// permissions from it.
export const updateSkillCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Edit a Skill's name, description, category, or SKILL.md")
      .argument("<skillId>", "Skill ID")
      .option("--name <name>", "New Skill name")
      .option("--content <content>", "New SKILL.md content")
      .option("--content-file <path>", "Read new SKILL.md content from a file")
      .option("--description <description>", "New short description")
      .option("--clear-description", "Clear the description")
      .option("--category <category>", "New category label")
      .option("--clear-category", "Clear the category")
  )
).action(async (skill: string, options: UpdateSkillOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    validateNoConflict(
      options.clearDescription === true,
      options.description !== undefined,
      "Cannot use --description and --clear-description together"
    );
    validateNoConflict(
      options.clearCategory === true,
      options.category !== undefined,
      "Cannot use --category and --clear-category together"
    );

    const name = parseOptionalNonEmptyString(options.name, "Name");
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    // Neither trimmed nor emptiness-checked: SKILL.md is stored verbatim and the
    // backend owns the "must not be blank" rule.
    const content = resolveAbsentableStringInput({
      inlineValue: options.content,
      filePath: options.contentFile,
      inlineLabel: "--content",
      fileLabel: "--content-file",
      displayName: "SKILL.md",
    });

    const updates = {
      ...(name !== undefined && { name }),
      ...(content !== undefined && { content }),
      ...(description !== undefined && { description }),
      ...(options.clearDescription === true && { description: null }),
      ...(category !== undefined && { category }),
      ...(options.clearCategory === true && { category: null }),
    };

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    const skillId = parseId<"skills">(skill, "skillId");
    await client.mutation(api.skills.core.update, { skillId, ...updates });

    printOutput(outputMode, { skillId }, (value) => {
      console.log(chalk.green("✓") + " Skill updated");
      console.log(`  ID: ${value.skillId}`);
      console.log();
    });
  });
});
