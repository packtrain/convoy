import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

export const removeSkillCommand = addGlobalOptions(
  addOutputOptions(new Command("remove").description("Delete a Skill").argument("<skillId>", "Skill ID"))
).action(async (skill: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const skillId = parseId<"skills">(skill, "skillId");
    await client.mutation(api.skills.core.deleteSkill, { skillId });

    printOutput(outputMode, { skillId }, (value) => {
      console.log(chalk.green("✓") + " Skill deleted");
      console.log(`  ID: ${value.skillId}`);
      console.log();
    });
  });
});
