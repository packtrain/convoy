import chalk from "chalk";
import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

export type WorktreeSetupRow = FunctionReturnType<typeof api.cli.worktreeSetups.list>[number];

const APPROVAL_LABELS: Record<NonNullable<WorktreeSetupRow["setup"]>["approval"], string> = {
  approved: "approved",
  never: chalk.yellow("needs your approval"),
  changed: chalk.yellow("changed since you approved"),
};

function formatRow({ repoKey, setup }: WorktreeSetupRow): string {
  if (!setup) return `${repoKey} ${chalk.dim("no script")}`;
  const date = new Date(setup.updatedAt).toISOString().slice(0, 10);
  return `${repoKey} ${chalk.dim(`r${setup.revision} ${setup.updatedByName ?? "unknown"} ${date}`)} ${APPROVAL_LABELS[setup.approval]}`;
}

export const listWorktreeSetupsCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List the project's worktree setup scripts")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: OutputOptions & { org?: string }, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const rows = await client.query(api.cli.worktreeSetups.list, { projectId });

    printOutput(outputMode, rows, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("No worktree setups found."));
        return;
      }
      for (const row of value) console.log(`  ${formatRow(row)}`);
    });
  });
});
