import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import type { WorktreeSetupRow } from "./list.js";
import { resolveRepoKey } from "./parsers.js";

export const getWorktreeSetupCommand = addGlobalOptions(
  addOutputOptions(
    new Command("get")
      .description("Print a repo's worktree setup script")
      .argument("[repo]", "owner/repo (default: the current directory's origin remote)")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (repo: string | undefined, options: OutputOptions & { org?: string }, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const repoKey = await resolveRepoKey(repo);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const rows = await client.query(api.cli.worktreeSetups.list, { projectId });
    const setup = rows.find((row: WorktreeSetupRow) => row.repoKey === repoKey)?.setup;
    if (!setup) throw new Error(`No worktree setup script for ${repoKey}.`);

    printOutput(outputMode, { repoKey, ...setup }, (value) => console.log(value.script));
  });
});
