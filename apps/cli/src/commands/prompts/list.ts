import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
} from "../../lib/output.js";
import { addScopeOptions, resolveScopeTarget, type ScopeOptions } from "../../lib/scope-resolution.js";
import { formatPromptLine, type Prompt } from "./formatters.js";

export const listPromptsCommand = addGlobalOptions(
  addOutputOptions(
    addScopeOptions(
      new Command("list").description("List prompts for a project or an organization"),
      "Prompt"
    )
  )
).action(async (options: ScopeOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const target = await resolveScopeTarget(client, config, cmd, options);

    const prompts: Prompt[] =
      target.scope === "organization"
        ? await client.query(api.slashCommands.core.listByOrganization, {
            organizationId: target.organizationId,
          })
        : await client.query(api.slashCommands.core.listByProject, {
            projectId: target.projectId,
          });

    printOutput(outputMode, prompts, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim(`\nNo ${target.scope} prompts found.`));
        return;
      }

      console.log(chalk.bold(`\nFound ${value.length} prompt(s):\n`));
      for (const prompt of value) {
        console.log(`  ${formatPromptLine(prompt)}`);
      }
      console.log();
    });
  });
});
