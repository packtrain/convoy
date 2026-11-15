import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import {
  getCodexMcpConfigPath,
  hasCodexConvoyServer,
  isCodexMcpConfigGitignored,
  readCodexMcpConfig,
  upsertCodexConvoyServer,
  writeCodexMcpConfig,
} from "../config/codex-mcp.js";
import { copyDirectoryWithOverwrite } from "../io/file-copy.js";
import {
  SKILL_NAME,
  SKILL_RELATIVE_PATH,
  type InitScope,
  type TargetInstallResult,
} from "../types.js";
import type {
  ConfigureMcpInput,
  InitTargetDriver,
  InstallSkillInput,
} from "./driver.js";

function resolveCodexHome(): string {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0) {
    return path.resolve(process.env.CODEX_HOME);
  }
  return path.join(os.homedir(), ".codex");
}

export function getCodexSkillDestination(scope: InitScope, baseDir: string): string {
  if (scope === "project") {
    return path.join(path.resolve(baseDir), ".agents", "skills", SKILL_NAME);
  }
  return path.join(resolveCodexHome(), "skills", SKILL_NAME);
}

async function configureCodexMcp(input: ConfigureMcpInput): Promise<void> {
  const existing = readCodexMcpConfig(input.baseDir);
  const hadExisting = hasCodexConvoyServer(existing);

  let shouldOverwrite = true;
  if (hadExisting && !input.force) {
    shouldOverwrite = await input.confirmOverwrite(
      "Existing convoy MCP config found in .codex/config.toml. Overwrite?"
    );
  }

  if (!shouldOverwrite) {
    input.log.info(chalk.dim("  - Skipped .codex/config.toml update"));
    return;
  }

  const merged = upsertCodexConvoyServer(existing, {
    url: input.mcpUrl,
    http_headers: { Authorization: `Bearer ${input.apiKey}` },
  });
  writeCodexMcpConfig(input.baseDir, merged);

  const filePath = getCodexMcpConfigPath(input.baseDir);
  input.log.info(
    chalk.green("  \u2713") +
      ` ${hadExisting ? "Updated" : "Created"} ${chalk.cyan(filePath)}`
  );

  if (!isCodexMcpConfigGitignored(input.baseDir)) {
    input.log.warn(
      chalk.yellow(
        "\n  \u26a0 .codex/config.toml contains API keys. Add it to .gitignore:"
      )
    );
    input.log.info(chalk.dim("    echo '.codex/config.toml' >> .gitignore"));
  }

  return;
}

async function installCodexSkill(input: InstallSkillInput): Promise<TargetInstallResult[]> {
  const sourceDir = path.join(input.marketplaceDir, SKILL_RELATIVE_PATH);
  if (!fs.existsSync(sourceDir)) {
    return [
      {
        target: "codex",
        label: "Codex",
        status: "failed",
        reason: `Skill source not found at ${sourceDir}`,
      },
    ];
  }

  return [
    await copyDirectoryWithOverwrite({
      target: "codex",
      label: "Codex",
      sourceDir,
      destinationDir: getCodexSkillDestination(input.scope, input.baseDir),
      force: input.force,
      confirmOverwrite: input.confirmOverwrite,
      preparedDestinations: input.preparedDestinations,
    }),
  ];
}

export const codexDriver: InitTargetDriver = {
  id: "codex",
  label: "Codex",
  configureMcp: configureCodexMcp,
  installSkill: installCodexSkill,
};
