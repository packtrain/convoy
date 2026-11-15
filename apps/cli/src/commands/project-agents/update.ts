import chalk from "chalk";
import { Command } from "commander";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { validateNoConflict } from "../tasks/parsers.js";
import { parseProjectAgentAutomation, type ProjectAgentAutomationOptions } from "./parsers.js";

interface UpdateProjectAgentOptions extends OutputOptions, ProjectAgentAutomationOptions {
  name?: string;
  color?: string;
  description?: string;
  clearDescription?: boolean;
  prompt?: string;
  clearPrompt?: boolean;
  category?: string;
  clearCategory?: boolean;
}

type UpdateProjectAgentFields = Omit<FunctionArgs<typeof api.agents.projectAgents.update>, "apiKey" | "projectAgentId">;

export const updateProjectAgentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("update")
      .description("Update a Project agent")
      .argument("<projectAgentId>", "Project-agent ID")
      .option("--name <name>", "Project-agent name")
      .option("--color <color>", "Agent palette color")
      .option("--description <text>", "Short description")
      .option("--clear-description", "Clear the description")
      .option("--prompt <text>", "Working prompt")
      .option("--clear-prompt", "Clear the working prompt")
      .option("--category <category>", "Category label")
      .option("--clear-category", "Clear the category")
      .option("--automation <state>", "Replace assignment automation: enabled|disabled")
      .option("--automation-prompt <text>", "Automation composer prompt")
      .option("--automation-cli-type <type>", "Preferred CLI runtime")
      .option("--automation-cli-model <model>", "Preferred CLI model")
      .option("--automation-cli-effort <effort>", "Preferred reasoning effort")
      .option("--automation-mode <mode>", "Preferred CLI mode")
      .option("--automation-workspace <workspace>", "Preferred workspace: local|worktree")
      .option("--clear-automation", "Clear assignment automation")
  )
).action(async (projectAgentId: string, options: UpdateProjectAgentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    validateNoConflict(
      options.clearDescription === true,
      options.description !== undefined,
      "Cannot use --description and --clear-description together"
    );
    validateNoConflict(options.clearPrompt === true, options.prompt !== undefined, "Cannot use --prompt and --clear-prompt together");
    validateNoConflict(
      options.clearCategory === true,
      options.category !== undefined,
      "Cannot use --category and --clear-category together"
    );

    const automation = parseProjectAgentAutomation(options, true);
    const updates: UpdateProjectAgentFields = {};
    const name = parseOptionalNonEmptyString(options.name, "Name");
    const color = parseOptionalNonEmptyString(options.color, "Color");
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const prompt = parseOptionalNonEmptyString(options.prompt, "Prompt");
    const category = parseOptionalNonEmptyString(options.category, "Category");

    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.appearance = { color };
    if (description !== undefined) updates.description = description;
    if (options.clearDescription === true) updates.description = null;
    if (prompt !== undefined) updates.prompt = prompt;
    if (options.clearPrompt === true) updates.prompt = null;
    if (category !== undefined) updates.category = category;
    if (options.clearCategory === true) updates.category = null;
    if (automation !== undefined) updates.automation = automation;

    if (Object.keys(updates).length === 0) {
      throw new Error("No updates provided. Pass at least one field to change.");
    }

    const parsedProjectAgentId = parseId<"projectAgents">(projectAgentId, "projectAgentId");
    await client.mutation(api.agents.projectAgents.update, {
      projectAgentId: parsedProjectAgentId,
      ...updates,
    });

    printOutput(outputMode, { projectAgentId: parsedProjectAgentId }, (value) => {
      console.log(chalk.green("✓") + " Project agent updated");
      console.log(`  ID: ${value.projectAgentId}`);
    });
  });
});
