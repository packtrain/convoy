import { Command } from "commander";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import {
  getAllProfiles,
  getConfigPath,
  configExists,
  deleteProfileByKey,
  resolveProfile,
  setDefaultProfile,
  getDefaultProfileKey,
} from "../../lib/config/index.js";
import { addGlobalOptions } from "../../cli.js";

/**
 * List all profiles
 */
const listCommand = new Command("list")
  .alias("ls")
  .description("List all configured profiles")
  .action(async () => {
    const profiles = getAllProfiles();
    const configPath = getConfigPath();
    const defaultKey = getDefaultProfileKey();

    if (profiles.length === 0) {
      console.log(chalk.yellow("\nNo profiles configured."));
      console.log(chalk.dim(`Config file: ${configPath}`));
      console.log(chalk.dim("\nRun 'convoy setup' to create a profile."));
      return;
    }

    console.log(chalk.bold("\nConfigured Profiles:\n"));

    for (const { key, profile } of profiles) {
      const isDefault = key === defaultKey;
      const defaultMarker = isDefault ? chalk.yellow(" (default)") : "";
      const maskedKey = profile.api_key
        ? `${profile.api_key.substring(0, 10)}...${profile.api_key.substring(profile.api_key.length - 4)}`
        : "???";

      console.log(`  ${chalk.green(key)}${defaultMarker}`);
      console.log(`    Name:       ${profile.name}`);
      console.log(`    URL:        ${chalk.cyan(profile.url)}`);
      console.log(`    Project ID: ${chalk.dim(profile.project_id)}`);
      console.log(`    Paths:`);
      for (const p of profile.paths) {
        console.log(`      ${chalk.dim(p)}`);
      }
      console.log(`    API Key:    ${chalk.dim(maskedKey)}`);
      console.log();
    }

    console.log(chalk.dim(`Config file: ${configPath}`));
  });

/**
 * Show resolved profile for current directory
 */
const showCommand = addGlobalOptions(
  new Command("show")
    .description("Show resolved profile for current directory")
).action(async (_options, cmd: Command) => {
    const cwd = process.cwd();
    const resolution = resolveProfile(cwd, {
      profile: cmd.optsWithGlobals().profile,
    });

    console.log(chalk.bold("\nProfile Resolution\n"));
    console.log(`  Current directory: ${chalk.dim(cwd)}`);
    console.log();

    if (!resolution.profile) {
      console.log(chalk.yellow("  No profile matches this directory."));
      console.log(
        chalk.dim("\n  Run 'convoy setup' to create a profile for this folder,")
      );
      console.log(
        chalk.dim("  or 'convoy connect' to select an existing profile.")
      );
      return;
    }

    console.log(`  Matched profile: ${chalk.green(resolution.key)}`);
    console.log(`  Resolution:      via ${chalk.cyan(resolution.source)}`);
    console.log();
    console.log(chalk.underline("  Profile Details:"));
    console.log(`    Name:       ${resolution.profile.name}`);
    console.log(`    URL:        ${chalk.cyan(resolution.profile.url)}`);
    console.log(`    Project ID: ${chalk.dim(resolution.profile.project_id)}`);
    console.log(`    Paths:`);
    for (const p of resolution.profile.paths) {
      console.log(`      ${chalk.dim(p)}`);
    }
  });

/**
 * Delete a profile
 */
const deleteCommand = new Command("delete")
  .alias("rm")
  .description("Delete a profile")
  .argument("<key>", "Profile key to delete")
  .option("-f, --force", "Skip confirmation")
  .action(async (key: string, options: { force?: boolean }) => {
    const profiles = getAllProfiles();
    const profile = profiles.find((p) => p.key === key);

    if (!profile) {
      console.error(chalk.red(`\nProfile "${key}" not found.`));
      console.log(chalk.dim("\nAvailable profiles:"));
      for (const p of profiles) {
        console.log(`  - ${p.key}`);
      }
      process.exit(1);
    }

    if (!options.force) {
      const shouldDelete = await confirm({
        message: `Delete profile "${key}" (${profile.profile.name})?`,
        default: false,
      });

      if (!shouldDelete) {
        console.log(chalk.dim("\nCancelled."));
        return;
      }
    }

    deleteProfileByKey(key);
    console.log(chalk.green("✓") + ` Profile "${key}" deleted.`);
  });

/**
 * Set default profile
 */
const defaultCommand = new Command("default")
  .description("Set the default profile")
  .argument("<key>", "Profile key to set as default")
  .action(async (key: string) => {
    const profiles = getAllProfiles();
    const profile = profiles.find((p) => p.key === key);

    if (!profile) {
      console.error(chalk.red(`\nProfile "${key}" not found.`));
      console.log(chalk.dim("\nAvailable profiles:"));
      for (const p of profiles) {
        console.log(`  - ${p.key}`);
      }
      process.exit(1);
    }

    setDefaultProfile(key);
    console.log(chalk.green("✓") + ` Default profile set to "${key}".`);
  });

export const configCommand = new Command("config")
  .description("Manage profiles")
  .addCommand(listCommand)
  .addCommand(showCommand)
  .addCommand(deleteCommand)
  .addCommand(defaultCommand)
  .action(async () => {
    // Default action: show help
    if (!configExists()) {
      console.log(chalk.yellow("\nNo config file found."));
      console.log(chalk.dim(`Expected at: ${getConfigPath()}`));
      console.log(chalk.dim("\nRun 'convoy setup' to create a profile."));
      return;
    }

    // Show summary
    const profiles = getAllProfiles();
    console.log(chalk.bold("\nProfile Summary\n"));
    console.log(`  ${profiles.length} profile(s) configured`);
    console.log(chalk.dim(`  Config: ${getConfigPath()}`));
    console.log();
    console.log("Commands:");
    console.log("  convoy config list     List all profiles");
    console.log("  convoy config show     Show resolved profile for cwd");
    console.log("  convoy config delete   Delete a profile");
    console.log("  convoy config default  Set default profile");
  });
