import chalk from "chalk";
import { Command } from "commander";
import type { FunctionArgs } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { parseOptionalNonEmptyString } from "../../lib/parsers.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { parseProjectAgentAutomation, type ProjectAgentAutomationOptions } from "./parsers.js";

interface CreateProjectAgentOptions extends OutputOptions, ProjectAgentAutomationOptions {
  name: string;
  color: string;
  org?: string;
  description?: string;
  prompt?: string;
  category?: string;
}

export const createProjectAgentCommand = addGlobalOptions(
  addOutputOptions(
    new Command("create")
      .description("Create a Project agent")
      .requiredOption("--name <name>", "Project-agent name")
      .requiredOption("--color <color>", "Agent palette color")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
      .option("--description <text>", "Short description")
      .option("--prompt <text>", "Working prompt")
      .option("--category <category>", "Category label")
      .option("--automation <state>", "Assignment automation state: enabled|disabled")
      .option("--automation-prompt <text>", "Automation composer prompt")
      .option("--automation-cli-type <type>", "Preferred CLI runtime")
      .option("--automation-cli-model <model>", "Preferred CLI model")
      .option("--automation-cli-effort <effort>", "Preferred reasoning effort")
      .option("--automation-mode <mode>", "Preferred CLI mode")
      .option("--automation-workspace <workspace>", "Preferred workspace: local|worktree")
  )
).action(async (options: CreateProjectAgentOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const automation = parseProjectAgentAutomation(options, false);
    const name = parseOptionalNonEmptyString(options.name, "Name");
    const color = parseOptionalNonEmptyString(options.color, "Color");
    const description = parseOptionalNonEmptyString(options.description, "Description");
    const prompt = parseOptionalNonEmptyString(options.prompt, "Prompt");
    const category = parseOptionalNonEmptyString(options.category, "Category");
    if (name === undefined || color === undefined) {
      throw new Error("--name and --color are required.");
    }
    const args: Omit<FunctionArgs<typeof api.agents.projectAgents.create>, "apiKey"> = {
      projectId,
      name,
      appearance: { color },
      ...(description !== undefined && { description }),
      ...(prompt !== undefined && { prompt }),
      ...(category !== undefined && { category }),
      ...(automation !== undefined && automation !== null && { automation }),
    };

    const projectAgentId = await client.mutation(api.agents.projectAgents.create, args);
    printOutput(outputMode, { projectAgentId }, (value) => {
      console.log(chalk.green("✓") + " Project agent created");
      console.log(`  ID: ${value.projectAgentId}`);
    });
  });
});
