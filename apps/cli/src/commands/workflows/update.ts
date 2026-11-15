import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { validateNoConflict } from "../tasks/parsers.js";
import { assertRunnable, printValidation } from "./formatters.js";
import { readDefinitionFile } from "./parsers.js";

interface UpdateWorkflowOptions extends OutputOptions {
  name?: string;
  description?: string;
  clearDescription?: boolean;
  category?: string;
  clearCategory?: boolean;
  color?: string;
  clearColor?: boolean;
  definitionFile?: string;
  validate?: boolean;
}

export const updateWorkflowCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Edit a Workflow's identity fields or replace its draft definition")
      .argument("<workflowId>", "Workflow ID")
      .option("--name <name>", "New name")
      .option("--description <description>", "New short description")
      .option("--clear-description", "Clear the description")
      .option("--category <category>", "New category label")
      .option("--clear-category", "Clear the category")
      .option("--color <color>", "New agent palette color")
      .option("--clear-color", "Clear the color")
      .option("--definition-file <path>", "Replace the draft definition (bare JSON, or a `workflows get` dump)")
      .option("--validate", "Run the version-cut checks after saving; exits non-zero when the draft is not runnable")
  )
).action(async (workflow: string, options: UpdateWorkflowOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    validateNoConflict(options.clearDescription === true, options.description !== undefined, "Cannot use --description and --clear-description together");
    validateNoConflict(options.clearCategory === true, options.category !== undefined, "Cannot use --category and --clear-category together");
    validateNoConflict(options.clearColor === true, options.color !== undefined, "Cannot use --color and --clear-color together");

    const name = parseOptionalNonEmptyString(options.name, "Name");
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    const color = parseOptionalNonEmptyString(options.color, "Color");

    const updates = {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(options.clearDescription === true && { description: null }),
      ...(category !== undefined && { category }),
      ...(options.clearCategory === true && { category: null }),
      ...(color !== undefined && { color }),
      ...(options.clearColor === true && { color: null }),
      ...(options.definitionFile !== undefined && { definition: readDefinitionFile(options.definitionFile) }),
    };

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    const workflowId = parseId<"workflows">(workflow, "workflowId");
    await client.mutation(api.workflows.core.update, { workflowId, ...updates });

    // One payload for both modes: JSON output must stay a single object.
    const validation = options.validate ? await client.query(api.workflows.core.validate, { workflowId }) : undefined;

    printOutput(outputMode, { workflowId, ...(validation && { validation }) }, (value) => {
      console.log(chalk.green("✓") + " Workflow updated");
      console.log(`  ID: ${value.workflowId}`);
      console.log();
      if (value.validation) {
        printValidation(value.validation);
      }
    });

    if (validation) {
      assertRunnable(validation);
    }
  });
});
