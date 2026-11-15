import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import {
  resolveProfile,
  addPathToProfile,
  removePathFromProfile,
} from "../../lib/config/index.js";
import { addGlobalOptions } from "../../cli.js";

function runListPaths(cmd: Command): void {
  const cwd = process.cwd();
  const resolution = resolveProfile(cwd, {
    profile: cmd.optsWithGlobals().profile,
  });

  if (!resolution.profile || !resolution.key) {
    console.log(chalk.yellow("\nNo profile resolved for this directory."));
    console.log(chalk.dim("Run 'convoy setup' to create a profile."));
    return;
  }

  console.log(
    chalk.bold(`\nPaths for profile "${resolution.key}":\n`)
  );
  for (const p of resolution.profile.paths) {
    console.log(`  ${chalk.dim(p)}`);
  }
  console.log();
}

/**
 * List paths for the resolved profile
 */
const listCommand = addGlobalOptions(
  new Command("list")
    .alias("ls")
    .description("List paths for the resolved profile")
).action(async (_options, cmd: Command) => {
    runListPaths(cmd);
  });

/**
 * Add a path to the resolved profile
 */
const addCommand = addGlobalOptions(
  new Command("add")
    .description("Add a path to the resolved profile")
    .argument("[path]", "Path to add (defaults to current directory)")
).action(async (targetPath: string | undefined, _options, cmd: Command) => {
    const cwd = process.cwd();
    const resolution = resolveProfile(cwd, {
      profile: cmd.optsWithGlobals().profile,
    });

    if (!resolution.profile || !resolution.key) {
      console.log(chalk.yellow("\nNo profile resolved for this directory."));
      console.log(chalk.dim("Run 'convoy setup' to create a profile."));
      return;
    }

    const resolvedPath = path.resolve(targetPath ?? cwd);

    try {
      addPathToProfile(resolution.key, resolvedPath);
      console.log(
        chalk.green("✓") +
          ` Added ${chalk.dim(resolvedPath)} to profile "${resolution.key}"`
      );
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  });

/**
 * Remove a path from the resolved profile
 */
const removeCommand = addGlobalOptions(
  new Command("remove")
    .alias("rm")
    .description("Remove a path from the resolved profile")
    .argument("<path>", "Path to remove")
).action(async (targetPath: string, _options, cmd: Command) => {
    const cwd = process.cwd();
    const resolution = resolveProfile(cwd, {
      profile: cmd.optsWithGlobals().profile,
    });

    if (!resolution.profile || !resolution.key) {
      console.log(chalk.yellow("\nNo profile resolved for this directory."));
      console.log(chalk.dim("Run 'convoy setup' to create a profile."));
      return;
    }

    try {
      removePathFromProfile(resolution.key, targetPath);
      console.log(
        chalk.green("✓") +
          ` Removed ${chalk.dim(targetPath)} from profile "${resolution.key}"`
      );
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  });

export const pathsCommand = addGlobalOptions(
  new Command("paths")
    .description("Manage profile paths")
    .addCommand(listCommand)
    .addCommand(addCommand)
    .addCommand(removeCommand)
).action(async (_options, cmd: Command) => {
    // Default: show paths list (call directly to preserve global options)
    runListPaths(cmd);
  });
