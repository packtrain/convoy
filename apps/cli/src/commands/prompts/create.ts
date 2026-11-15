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
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { addScopeOptions, resolveScopeTarget, type ScopeOptions } from "../../lib/scope-resolution.js";

interface CreatePromptOptions extends ScopeOptions {
  key: string;
  content: string;
  description?: string;
  category?: string;
  autoExpand?: boolean;
  autoSubmit?: boolean;
}

export const createPromptCommand = addGlobalOptions(
  addOutputOptions(
    addScopeOptions(
      new Command("create")
        .description("Create a prompt in a project or an organization")
        .requiredOption("--key <key>", "Prompt key without the leading slash (2-40 chars)")
        .requiredOption("--content <content>", "Prompt content")
        .option("--description <description>", "Short description")
        .option("--category <category>", "Category label")
        .option("--auto-expand", "Expand the prompt into the composer on selection")
        .option("--auto-submit", "Submit the message when the prompt is selected"),
      "Prompt"
    )
  )
).action(async (options: CreatePromptOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    const target = await resolveScopeTarget(client, config, cmd, options);

    const shared = {
      key: options.key,
      content: options.content,
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(options.autoExpand !== undefined && { autoExpand: options.autoExpand }),
      ...(options.autoSubmit !== undefined && { autoSubmit: options.autoSubmit }),
    };

    const promptId =
      target.scope === "organization"
        ? await client.mutation(api.slashCommands.core.createInOrganization, {
            organizationId: target.organizationId,
            ...shared,
          })
        : await client.mutation(api.slashCommands.core.createInProject, {
            projectId: target.projectId,
            ...shared,
          });

    printOutput(outputMode, { promptId }, (value) => {
      console.log(chalk.green("✓") + ` Prompt created (${target.scope})`);
      console.log(`  /${options.key}`);
      console.log(`  ID: ${value.promptId}`);
      console.log();
    });
  });
});
