import { Command } from "commander";
import chalk from "chalk";
import {
  resolveProfile,
  resolveConfigFromProfileCommand,
  getConfigPath,
  configExists,
  getAllProfiles,
} from "../../lib/config/index.js";
import { ENV_URL, ENV_API_KEY, ENV_PROFILE } from "../../lib/constants.js";
import { addGlobalOptions } from "../../cli.js";

export const statusCommand = addGlobalOptions(
  new Command("status")
    .description("Show configuration and connection status")
).action(async (_options, cmd: Command) => {
    const cwd = process.cwd();
    const resolution = resolveProfile(cwd, {
      profile: cmd.optsWithGlobals().profile,
    });
    const config = resolveConfigFromProfileCommand(cmd, cwd);

    console.log(chalk.bold("\nConfiguration Status\n"));

    // Config file
    console.log(chalk.underline("Config File:"));
    const configPath = getConfigPath();
    console.log(
      `  ${configExists() ? chalk.green(configPath) : chalk.dim(`${configPath} (not found)`)}`
    );
    console.log();

    // Profile resolution
    console.log(chalk.underline("Profile Resolution:"));
    console.log(`  Current directory: ${chalk.dim(cwd)}`);
    if (resolution.profile) {
      console.log(
        `  Matched profile:   ${chalk.green(resolution.key)} (via ${resolution.source})`
      );
      console.log(`  Profile name:      ${chalk.cyan(resolution.profile.name)}`);
      console.log(`  Profile paths:`);
      for (const p of resolution.profile.paths) {
        console.log(`    ${chalk.dim(p)}`);
      }
    } else {
      console.log(`  Matched profile:   ${chalk.yellow("none")}`);
    }
    console.log();

    // Resolved values
    console.log(chalk.underline("Resolved Configuration:"));
    console.log(
      `  Convex URL: ${config.convexUrl ? chalk.cyan(config.convexUrl) : chalk.red("not set")}`
    );
    console.log(
      `  Project ID: ${config.projectId ? chalk.cyan(config.projectId) : chalk.dim("not set")}`
    );
    console.log(
      `  API Key:    ${config.apiKey ? chalk.green("configured") : chalk.red("not configured")}`
    );
    console.log();

    // All profiles
    const allProfiles = getAllProfiles();
    if (allProfiles.length > 0) {
      console.log(chalk.underline("All Profiles:"));
      for (const { key, profile } of allProfiles) {
        const isCurrent = key === resolution.key;
        const marker = isCurrent ? chalk.green("→") : " ";
        const keyDisplay = isCurrent ? chalk.green(key) : key;
        const pathSummary = profile.paths.length === 1
          ? profile.paths[0]
          : `${profile.paths.length} paths`;
        console.log(`  ${marker} ${keyDisplay.padEnd(20)} ${chalk.dim(pathSummary)}`);
      }
      console.log();
    }

    // Environment overrides
    const envOverrides: string[] = [];
    if (process.env[ENV_API_KEY]) envOverrides.push(ENV_API_KEY);
    if (process.env[ENV_PROFILE]) envOverrides.push(ENV_PROFILE);
    if (process.env[ENV_URL]) envOverrides.push(ENV_URL);

    if (envOverrides.length > 0) {
      console.log(chalk.underline("Environment Overrides:"));
      for (const env of envOverrides) {
        console.log(`  ${chalk.yellow(env)}`);
      }
      console.log();
    }

    // Ready check
    if (config.convexUrl && config.apiKey && config.projectId) {
      console.log(
        chalk.green("✓") +
          " Ready to connect. Run " +
          chalk.cyan("convoy connect")
      );
    } else {
      console.log(chalk.yellow("Missing required configuration:"));
      if (!config.convexUrl || !config.apiKey || !config.projectId) {
        console.log("  Run " + chalk.cyan("convoy setup") + " to configure.");
      }
    }
  });
