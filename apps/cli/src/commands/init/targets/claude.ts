import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  isMcpJsonGitignored,
  readMcpConfig,
  upsertConvoyServer,
  writeMcpConfig,
} from "../config/claude-mcp.js";
import {
  copyDirectoryWithOverwrite,
  symlinkDirectoryWithOverwrite,
} from "../io/file-copy.js";
import {
  SKILL_NAME,
  SKILL_RELATIVE_PATH,
  type ClaudeMethod,
  type InitScope,
  type TargetInstallResult,
} from "../types.js";
import type {
  ConfigureMcpInput,
  InitTargetDriver,
  InstallSkillInput,
} from "./driver.js";

const execFileAsync = promisify(execFile);

export function getClaudeSkillDestination(scope: InitScope, baseDir: string): string {
  if (scope === "project") {
    return path.join(path.resolve(baseDir), ".claude", "skills", SKILL_NAME);
  }
  return path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
}

async function installClaudePlugin(config: {
  scope: InitScope;
  marketplaceDir: string;
}): Promise<TargetInstallResult> {
  const spinner = ora("Installing Convoy plugin for Claude Code...").start();

  try {
    try {
      await execFileAsync("claude", [
        "plugin",
        "marketplace",
        "add",
        config.marketplaceDir,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("already installed")) {
        throw error;
      }
    }

    await execFileAsync("claude", [
      "plugin",
      "install",
      "convoy@convoy",
      "--scope",
      config.scope,
    ]);

    spinner.succeed("Convoy plugin installed for Claude Code");
    console.log(chalk.dim(`  Scope: ${config.scope}`));
    console.log(chalk.dim(`  Source: ${config.marketplaceDir}`));
    return {
      target: "claude",
      label: "Claude Code (plugin)",
      status: "installed",
    };
  } catch (error) {
    spinner.fail("Failed to install plugin via Claude Code CLI");

    const message = error instanceof Error ? error.message : String(error);
    const isCliMissing =
      message.includes("ENOENT") || message.includes("not found");

    return {
      target: "claude",
      label: "Claude Code (plugin)",
      status: "failed",
      reason: isCliMissing
        ? "The 'claude' command is not available on PATH.\n" +
          "  Install Claude Code: https://docs.anthropic.com/en/docs/claude-code\n" +
          "  Then run manually:\n" +
          `    claude plugin marketplace add ${config.marketplaceDir}\n` +
          `    claude plugin install convoy@convoy --scope ${config.scope}`
        : `${message}\n\n  You can install manually:\n` +
          `    claude plugin marketplace add ${config.marketplaceDir}\n` +
          `    claude plugin install convoy@convoy --scope ${config.scope}`,
    };
  }
}

function getCanonicalProjectSkillDestination(baseDir: string): string {
  return path.join(path.resolve(baseDir), ".agents", "skills", SKILL_NAME);
}

async function installClaudeRawSkill(config: {
  baseDir: string;
  scope: InitScope;
  marketplaceDir: string;
  force?: boolean;
  confirmOverwrite?: (message: string) => Promise<boolean>;
  preparedDestinations?: Set<string>;
}): Promise<TargetInstallResult> {
  const sourceDir = path.join(config.marketplaceDir, SKILL_RELATIVE_PATH);
  if (!fs.existsSync(sourceDir)) {
    return {
      target: "claude",
      label: "Claude Code (raw)",
      status: "failed",
      reason: `Skill source not found at ${sourceDir}`,
    };
  }

  if (config.scope === "project") {
    const canonicalDestination = getCanonicalProjectSkillDestination(config.baseDir);
    const canonicalResult = await copyDirectoryWithOverwrite({
      target: "claude",
      label: "Claude Code (raw source)",
      sourceDir,
      destinationDir: canonicalDestination,
      force: config.force,
      confirmOverwrite: config.confirmOverwrite,
      preparedDestinations: config.preparedDestinations,
    });

    if (canonicalResult.status === "failed") {
      return canonicalResult;
    }

    return symlinkDirectoryWithOverwrite({
      target: "claude",
      label: "Claude Code (raw)",
      sourceDir: canonicalDestination,
      destinationDir: getClaudeSkillDestination(config.scope, config.baseDir),
      force: config.force,
      confirmOverwrite: config.confirmOverwrite,
    });
  }

  return copyDirectoryWithOverwrite({
    target: "claude",
    label: "Claude Code (raw)",
    sourceDir,
    destinationDir: getClaudeSkillDestination(config.scope, config.baseDir),
    force: config.force,
    confirmOverwrite: config.confirmOverwrite,
    preparedDestinations: config.preparedDestinations,
  });
}

async function installClaudeSkills(input: InstallSkillInput): Promise<TargetInstallResult[]> {
  const methods: ClaudeMethod[] = input.claudeMethods ?? [];
  const results: TargetInstallResult[] = [];

  if (methods.includes("raw")) {
    results.push(
      await installClaudeRawSkill({
        baseDir: input.baseDir,
        scope: input.scope,
        marketplaceDir: input.marketplaceDir,
        force: input.force,
        confirmOverwrite: input.confirmOverwrite,
        preparedDestinations: input.preparedDestinations,
      })
    );
  }

  if (methods.includes("plugin")) {
    results.push(
      await installClaudePlugin({
        scope: input.scope,
        marketplaceDir: input.marketplaceDir,
      })
    );
  }

  if (results.length === 0) {
    results.push({
      target: "claude",
      label: "Claude Code",
      status: "failed",
      reason: "No Claude install methods selected.",
    });
  }

  return results;
}

async function configureClaudeMcp(input: ConfigureMcpInput): Promise<void> {
  const existing = readMcpConfig(input.baseDir);
  const hadExisting = existing?.mcpServers?.convoy !== undefined;

  let shouldOverwrite = true;
  if (hadExisting && !input.force) {
    shouldOverwrite = await input.confirmOverwrite(
      "Existing convoy MCP config found in .mcp.json. Overwrite?"
    );
  }

  if (!shouldOverwrite) {
    input.log.info(chalk.dim("  - Skipped .mcp.json update"));
    return;
  }

  const merged = upsertConvoyServer(existing, {
    type: "http",
    url: input.mcpUrl,
    headers: { Authorization: `Bearer ${input.apiKey}` },
  });
  writeMcpConfig(input.baseDir, merged);

  const filePath = path.join(input.baseDir, ".mcp.json");
  input.log.info(
    chalk.green("  \u2713") +
      ` ${hadExisting ? "Updated" : "Created"} ${chalk.cyan(filePath)}`
  );

  if (!isMcpJsonGitignored(input.baseDir)) {
    input.log.warn(
      chalk.yellow("\n  \u26a0 .mcp.json contains API keys. Add it to .gitignore:")
    );
    input.log.info(chalk.dim("    echo '.mcp.json' >> .gitignore"));
  }

  return;
}

export const claudeDriver: InitTargetDriver = {
  id: "claude",
  label: "Claude Code",
  configureMcp: configureClaudeMcp,
  installSkill: installClaudeSkills,
};
