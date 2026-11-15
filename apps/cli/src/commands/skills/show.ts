import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { formatSkillSource } from "./formatters.js";

export const showSkillCommand = addGlobalOptions(
  addOutputOptions(new Command("show").description("Show a Skill with its SKILL.md and file list").argument("<skillId>", "Skill ID"))
).action(async (skillId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const skill = await client.query(api.skills.core.get, {
      skillId: parseId<"skills">(skillId, "skillId"),
    });

    if (!skill) {
      throw new Error("Skill not found or not accessible.");
    }

    printOutput(outputMode, skill, (value) => {
      console.log(chalk.bold(`\n/${value.name}`) + chalk.dim(` v${value.version}`));
      console.log(`  ID: ${value._id}`);
      console.log(`  Description: ${value.description ?? "None"}`);
      console.log(`  Category: ${value.category ?? "None"}`);
      console.log(`  Copied from: ${value.source ? formatSkillSource(value.source) : "None"}`);
      console.log(`  Updated: ${new Date(value.updatedAt).toISOString()}`);
      console.log();
      console.log(value.skillMd);
      console.log();
      console.log(chalk.bold(`Files (${value.files.length})`));
      for (const file of value.files) {
        console.log(`  ${file.path}`);
      }
      console.log();
    });
  });
});
