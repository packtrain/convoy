import chalk from "chalk";
import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

interface ListProjectAgentsOptions extends OutputOptions {
  org?: string;
}

type ProjectAgent = FunctionReturnType<typeof api.agents.projectAgents.listByProject>[number];

function formatProjectAgent(agent: ProjectAgent): string {
  const category = agent.category ? ` category=${agent.category}` : "";
  const automation = agent.automation ? ` automation=${agent.automation.enabled ? "enabled" : "disabled"}` : "";
  return `${agent.name} ${chalk.dim(`(${agent._id}) color=${agent.appearance.color}${category}${automation}`)}`;
}

export const listProjectAgentsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list").description("List Project agents").option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: ListProjectAgentsOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const agents = await client.query(api.agents.projectAgents.listByProject, { projectId });

    printOutput(outputMode, agents, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("No Project agents found."));
        return;
      }
      console.log(chalk.bold(`Project agents (${value.length}):`));
      for (const agent of value) {
        console.log(`  ${formatProjectAgent(agent)}`);
      }
    });
  });
});
