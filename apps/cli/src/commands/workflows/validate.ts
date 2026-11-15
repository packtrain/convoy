import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { assertRunnable, printValidation } from "./formatters.js";
import { readDefinitionFile } from "./parsers.js";

interface ValidateWorkflowOptions extends OutputOptions {
  definitionFile?: string;
}

// Dry run of the checks a run start applies; nothing is saved or started.
export const validateWorkflowCommand = addGlobalOptions(
  addOutputOptions(
    new Command("validate")
      .description("Check that a Workflow's draft (or a definition file) could start a run")
      .argument("<workflowId>", "Workflow whose draft, or whose project, to check against")
      .option("--definition-file <path>", "Check this definition instead of the stored draft")
  )
).action(async (workflow: string, options: ValidateWorkflowOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const definition = options.definitionFile !== undefined ? readDefinitionFile(options.definitionFile) : undefined;
    const result = await client.query(api.workflows.core.validate, {
      workflowId: parseId<"workflows">(workflow, "workflowId"),
      ...(definition !== undefined && { definition }),
    });

    printOutput(outputMode, result, printValidation);
    assertRunnable(result);
  });
});
