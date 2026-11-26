import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { resolveRepoKey } from "./parsers.js";

export const deleteWorktreeSetupCommand = addGlobalOptions(
  addOutputOptions(
    new Command("delete")
      .description("Remove a repo's worktree setup script")
      .argument("[repo]", "owner/repo (default: the current directory's origin remote)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (repo: string | undefined, options: OutputOptions & { org?: string }, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const repoKey = await resolveRepoKey(repo);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    await client.mutation(api.cli.worktreeSetups.remove, { projectId, repoKey });

    printOutput(outputMode, { repoKey, deleted: true }, (value) => {
      console.log(chalk.green("✓") + ` Removed the worktree setup for ${value.repoKey}`);
    });
  });
});
