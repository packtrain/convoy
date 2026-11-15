import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import ora from "ora";
import type { InitTarget, TargetInstallResult } from "../types.js";

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function shouldReplaceExisting(config: {
  destinationDir: string;
  force?: boolean;
  confirmOverwrite?: (message: string) => Promise<boolean>;
}): Promise<boolean> {
  if (config.force) {
    return true;
  }

  const confirmOverwrite = config.confirmOverwrite ?? (async () => false);
  return confirmOverwrite(
    `Existing Convoy skill found at ${config.destinationDir}. Overwrite?`
  );
}

export async function copyDirectoryWithOverwrite(config: {
  target: InitTarget;
  label: string;
  sourceDir: string;
  destinationDir: string;
  force?: boolean;
  confirmOverwrite?: (message: string) => Promise<boolean>;
  preparedDestinations?: Set<string>;
}): Promise<TargetInstallResult> {
  const preparedKey = path.resolve(config.destinationDir);
  if (config.preparedDestinations?.has(preparedKey)) {
    return {
      target: config.target,
      label: config.label,
      status: "installed",
    };
  }

  if (pathExists(config.destinationDir)) {
    const shouldOverwrite = await shouldReplaceExisting(config);
    if (!shouldOverwrite) {
      return {
        target: config.target,
        label: config.label,
        status: "skipped",
        reason: `Destination already exists: ${config.destinationDir}`,
      };
    }
    fs.rmSync(config.destinationDir, { recursive: true, force: true });
  }

  const spinner = ora(`Copying skill files for ${config.label}...`).start();
  try {
    fs.mkdirSync(path.dirname(config.destinationDir), { recursive: true });
    fs.cpSync(config.sourceDir, config.destinationDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    config.preparedDestinations?.add(preparedKey);
    spinner.succeed(`Skill files installed for ${config.label}`);
    console.log(chalk.dim(`  Destination: ${config.destinationDir}`));
    return {
      target: config.target,
      label: config.label,
      status: "installed",
    };
  } catch (error) {
    spinner.fail(`Failed to copy skill files for ${config.label}`);
    return {
      target: config.target,
      label: config.label,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function symlinkDirectoryWithOverwrite(config: {
  target: InitTarget;
  label: string;
  sourceDir: string;
  destinationDir: string;
  force?: boolean;
  confirmOverwrite?: (message: string) => Promise<boolean>;
}): Promise<TargetInstallResult> {
  const resolvedSource = path.resolve(config.sourceDir);
  const resolvedDestination = path.resolve(config.destinationDir);

  if (pathExists(resolvedDestination)) {
    const existing = fs.lstatSync(resolvedDestination);
    if (existing.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(resolvedDestination);
      const resolvedCurrentTarget = path.resolve(
        path.dirname(resolvedDestination),
        currentTarget
      );
      if (resolvedCurrentTarget === resolvedSource) {
        return {
          target: config.target,
          label: config.label,
          status: "installed",
        };
      }
    }

    const shouldOverwrite = await shouldReplaceExisting({
      destinationDir: resolvedDestination,
      force: config.force,
      confirmOverwrite: config.confirmOverwrite,
    });
    if (!shouldOverwrite) {
      return {
        target: config.target,
        label: config.label,
        status: "skipped",
        reason: `Destination already exists: ${resolvedDestination}`,
      };
    }
    fs.rmSync(resolvedDestination, { recursive: true, force: true });
  }

  const spinner = ora(`Linking skill files for ${config.label}...`).start();
  try {
    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    const symlinkTarget =
      process.platform === "win32"
        ? resolvedSource
        : path.relative(path.dirname(resolvedDestination), resolvedSource);
    fs.symlinkSync(
      symlinkTarget,
      resolvedDestination,
      process.platform === "win32" ? "junction" : "dir"
    );
    spinner.succeed(`Skill files linked for ${config.label}`);
    console.log(chalk.dim(`  Destination: ${resolvedDestination}`));
    console.log(chalk.dim(`  Source: ${resolvedSource}`));
    return {
      target: config.target,
      label: config.label,
      status: "installed",
    };
  } catch (error) {
    spinner.fail(`Failed to link skill files for ${config.label}`);
    return {
      target: config.target,
      label: config.label,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
