import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";
import { resolveRequiredStringInput } from "../../lib/text-input.js";
import { resolveRepoKey } from "./parsers.js";

interface SetWorktreeSetupOptions extends OutputOptions {
  org?: string;
  file?: string;
  script?: string;
}

export const setWorktreeSetupCommand = addGlobalOptions(
  addOutputOptions(
    new Command("set")
      .description("Save a repo's worktree setup script; it runs only after you approve it in the web")
      .argument("[repo]", "owner/repo (default: the current directory's origin remote)")
      .option("--file <path>", "Read the script from a file")
      .option("--script <text>", "Script text")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (repo: string | undefined, options: SetWorktreeSetupOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const script = resolveRequiredStringInput({
      inlineValue: options.script,
      filePath: options.file,
      inlineLabel: "--script",
      fileLabel: "--file",
      displayName: "script",
    });
    const repoKey = await resolveRepoKey(repo);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);
    const saved = await client.mutation(api.cli.worktreeSetups.save, { projectId, repoKey, script });

    printOutput(outputMode, { repoKey, ...saved }, (value) => {
      if (!value.changed) {
        console.log(chalk.green("✓") + ` No change to the worktree setup for ${value.repoKey} (revision ${value.revision})`);
        return;
      }
      console.log(chalk.green("✓") + ` Saved the worktree setup for ${value.repoKey} (revision ${value.revision})`);
      console.log(`  ${value.settingsUrl}`);
      console.log("  Approve it in the web before it runs. New worktrees for this repo fail for everyone until they approve it.");
    });
  });
});
