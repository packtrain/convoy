import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { validateNoConflict } from "../tasks/parsers.js";
import { assertRunnable, printValidation } from "./formatters.js";
import { readDefinitionFile } from "./parsers.js";

interface CreateWorkflowOptions extends OutputOptions {
  name: string;
  definitionFile?: string;
  from?: string;
  description?: string;
  category?: string;
  color?: string;
  org?: string;
  validate?: boolean;
}

export const createWorkflowCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a Workflow from a definition file or another Workflow's draft")
      .requiredOption("--name <name>", "Workflow name")
      .option("--definition-file <path>", "Definition JSON (bare, or a `workflows get` dump)")
      .option("--from <workflowId>", "Copy this Workflow's draft definition")
      .option("--description <description>", "Short description")
      .option("--category <category>", "Category label")
      .option("--color <color>", "Agent palette color")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--validate", "Run the version-cut checks after saving; exits non-zero when the draft is not runnable")
  )
).action(async (options: CreateWorkflowOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    validateNoConflict(options.definitionFile !== undefined, options.from !== undefined, "Cannot use --definition-file and --from together");
    if (options.definitionFile === undefined && options.from === undefined) {
      throw new Error("Pass --definition-file or --from.");
    }
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    const color = parseOptionalNonEmptyString(options.color, "Color");
    // Read the file before any network call so a bad file fails fast.
    let definition = options.definitionFile !== undefined ? readDefinitionFile(options.definitionFile) : undefined;

    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    if (definition === undefined) {
      const source = await client.query(api.workflows.core.get, { workflowId: parseId<"workflows">(options.from!, "--from") });
      if (!source) {
        throw new Error("Source workflow not found or not accessible.");
      }
      definition = source.draftDefinition;
    }

    const workflowId = await client.mutation(api.workflows.core.create, {
      projectId,
      name: options.name,
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(color !== undefined && { color }),
      definition,
    });

    // One payload for both modes: JSON output must stay a single object.
    const validation = options.validate ? await client.query(api.workflows.core.validate, { workflowId }) : undefined;

    printOutput(outputMode, { workflowId, ...(validation && { validation }) }, (value) => {
      console.log(chalk.green("✓") + " Workflow created");
      console.log(`  ${options.name}`);
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
