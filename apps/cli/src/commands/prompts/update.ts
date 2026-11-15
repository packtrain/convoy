import { Command } from "commander";
import chalk from "chalk";
import { api } from "../../convex/_generated/api.js";
import { addGlobalOptions } from "../../cli.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import {
  addOutputOptions,
  printOutput,
  resolveOutputMode,
  type OutputOptions,
} from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { validateNoConflict } from "../tasks/parsers.js";

interface UpdatePromptOptions extends OutputOptions {
  key?: string;
  content?: string;
  description?: string;
  category?: string;
  clearDescription?: boolean;
  clearCategory?: boolean;
  autoExpand?: boolean;
  autoSubmit?: boolean;
}

// No scope flags: the stored prompt already carries its scope, and the backend
// derives permissions from it.
export const updatePromptCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Edit a prompt")
      .argument("<promptId>", "Prompt ID")
      .option("--key <key>", "New prompt key without the leading slash")
      .option("--content <content>", "New prompt content")
      .option("--description <description>", "New short description")
      .option("--clear-description", "Clear the description")
      .option("--category <category>", "New category label")
      .option("--clear-category", "Clear the category")
      .option("--auto-expand", "Expand the prompt into the composer on selection")
      .option("--no-auto-expand", "Stop expanding the prompt into the composer")
      .option("--auto-submit", "Submit the message when the prompt is selected")
      .option("--no-auto-submit", "Stop submitting the message on selection")
  )
).action(async (prompt: string, options: UpdatePromptOptions, cmd: Command) => {
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

    const key = parseOptionalNonEmptyString(options.key, "Key");
    const content = parseOptionalNonEmptyString(options.content, "Content");
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");

    const updates = {
      ...(key !== undefined && { key }),
      ...(content !== undefined && { content }),
      ...(description !== undefined && { description }),
      ...(options.clearDescription === true && { description: null }),
      ...(category !== undefined && { category }),
      ...(options.clearCategory === true && { category: null }),
      ...(options.autoExpand !== undefined && { autoExpand: options.autoExpand }),
      ...(options.autoSubmit !== undefined && { autoSubmit: options.autoSubmit }),
    };

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    const promptId = parseId<"slashCommands">(prompt, "promptId");
    await client.mutation(api.slashCommands.core.update, {
      slashCommandId: promptId,
      ...updates,
    });

    printOutput(outputMode, { promptId }, (value) => {
      console.log(chalk.green("✓") + " Prompt updated");
      console.log(`  ID: ${value.promptId}`);
      console.log();
    });
  });
});
