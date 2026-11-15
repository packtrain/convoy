import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode } from "../../lib/output.js";
import { addScopeOptions, resolveScopeTarget, type ScopeOptions } from "../../lib/scope-resolution.js";
import { formatSkillLine, type Skill } from "./formatters.js";

export const listSkillsCommand = addGlobalOptions(
  addOutputOptions(
    addScopeOptions(new Command("list").description("List Skills for a project or an organization"), "Skill")
  )
).action(async (options: ScopeOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const target = await resolveScopeTarget(client, config, cmd, options);

    const skills: Skill[] =
      target.scope === "organization"
        ? await client.query(api.skills.core.listByOrganization, { organizationId: target.organizationId })
        : await client.query(api.skills.core.listByProject, { projectId: target.projectId });

    printOutput(outputMode, skills, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim(`\nNo ${target.scope} skills found.`));
        return;
      }

      console.log(chalk.bold(`\nFound ${value.length} skill(s):\n`));
      for (const skill of value) {
        console.log(`  ${formatSkillLine(skill)}`);
      }
      console.log();
    });
  });
});
