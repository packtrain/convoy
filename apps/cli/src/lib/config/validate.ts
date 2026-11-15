import chalk from "chalk";
import type { ResolvedConfig, RequiredConfig } from "./types.js";

/**
 * Custom error for configuration issues
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate that credentials are present in the config
 * Throws ConfigError if validation fails
 */
export function requireCredentials(
  config: ResolvedConfig
): asserts config is RequiredConfig {
  if (!config.convexUrl) {
    throw new ConfigError(
      "No Convex URL configured",
      "Run 'convoy setup' to configure a profile"
    );
  }

  if (!config.apiKey) {
    throw new ConfigError(
      "No API key configured",
      "Run 'convoy setup' to configure a profile"
    );
  }
}

/**
 * Validate that a project is configured
 * Throws ConfigError if validation fails
 */
export function requireProject(
  config: ResolvedConfig
): asserts config is RequiredConfig & { projectId: string } {
  requireCredentials(config);

  if (!config.projectId) {
    throw new ConfigError(
      "No project configured",
      "Run 'convoy setup' to configure a profile with a project"
    );
  }
}

/**
 * Handle a ConfigError by printing a user-friendly message and exiting
 * Returns the exit code (for testing) or exits the process
 */
export function handleConfigError(error: unknown, exit = true): number {
  if (error instanceof ConfigError) {
    console.error(chalk.red(`Error: ${error.message}`));
    if (error.hint) {
      console.log(chalk.dim(error.hint));
    }
    if (exit) {
      process.exit(1);
    }
    return 1;
  }

  // Re-throw non-ConfigError errors
  throw error;
}

/**
 * Run a validation function and handle ConfigError with user-friendly output
 * Usage: withConfigError(() => requireCredentials(config))
 */
export function withConfigError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    handleConfigError(error);
    throw error; // unreachable but satisfies TS
  }
}
