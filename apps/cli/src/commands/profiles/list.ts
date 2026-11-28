import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveProjectFromCommand } from "../../lib/project-resolution.js";

/**
 * Spelled out rather than inferred: `api.d.ts` imports convex modules this
 * package doesn't mirror, so `FunctionReturnType` degrades to `any` here and
 * would not have caught formatting an object as a string. Source of truth is
 * `cliProfileItemValidator` in `apps/web/convex/cli/profiles.ts`.
 */
interface CliRuntime {
  type: string;
  version: string;
}

interface CliProfilePath {
  id: string;
  path: string;
  label: string;
  kind?: "worktree" | "repo";
}

interface CliProfile {
  _id: string;
  name: string;
  hostname?: string;
  paths: CliProfilePath[];
  isOnline: boolean;
  availableClis: CliRuntime[];
  appVersion?: string;
}

interface ListCliProfilesOptions extends OutputOptions {
  org?: string;
}

/**
 * Each `availableClis` entry is an object (`availableCliValidator`), so it needs
 * formatting — the same `type`/`version` pair the web hover card shows.
 */
function formatRuntimes(availableClis: CliProfile["availableClis"]): string {
  if (availableClis.length === 0) {
    return "none";
  }

  return availableClis.map((cli) => `${cli.type} ${cli.version}`).join(", ");
}

function formatProfile(profile: CliProfile): string {
  const state = profile.isOnline ? chalk.green("online") : chalk.dim("offline");
  const version = profile.appVersion ? ` v${profile.appVersion}` : "";
  const host = profile.hostname ?? "Unknown";
  return `${chalk.cyan(profile.name)} ${chalk.dim(`(${profile._id})`)} ${state} ${chalk.dim(`${host}${version} [${formatRuntimes(profile.availableClis)}]`)}`;
}

export const listCliProfilesCommand = addGlobalOptions(
  addOutputOptions(
    new Command("list")
      .description("List the caller's CLI profiles in a project, with online state")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (options: ListCliProfilesOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const { projectId } = await resolveProjectFromCommand(client, config, cmd, options.org);

    const profiles: CliProfile[] = await client.query(api.cli.profiles.listByProject, {
      projectId,
    });

    printOutput(outputMode, profiles, (value) => {
      if (value.length === 0) {
        console.log(chalk.dim("\nNo CLI profiles found."));
        return;
      }

      console.log(chalk.bold(`\nFound ${value.length} CLI profile(s):\n`));
      for (const profile of value) {
        console.log(`  ${formatProfile(profile)}`);
        // Paths are the other half of a spawn target, so they belong in the row.
        for (const path of profile.paths) {
          // A repo or worktree entry names its kind, so a repo's pathId reads as one.
          const note = [path.label, path.kind].filter(Boolean).join(", ");
          console.log(`    ${chalk.dim(path.id)} ${path.path}${note ? chalk.dim(` (${note})`) : ""}`);
        }
      }
      console.log();
    });
  });
});
