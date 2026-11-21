import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import {
  getAntigravityMcpConfigPath,
  hasAntigravityConvoyServer,
  readAntigravityMcpConfig,
  upsertAntigravityConvoyServer,
  writeAntigravityMcpConfig,
} from "../config/antigravity-mcp.js";
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

/** Project scope shares Codex's `.agents/skills` copy. Spec: docs/specs/cli-init-command.md. */
export function getAntigravitySkillDestination(scope: InitScope, baseDir: string): string {
  if (scope === "project") {
    return path.join(path.resolve(baseDir), ".agents", "skills", SKILL_NAME);
  }
  return path.join(os.homedir(), ".gemini", "config", "skills", SKILL_NAME);
}

async function configureAntigravityMcp(input: ConfigureMcpInput): Promise<void> {
  const filePath = getAntigravityMcpConfigPath();
  const existing = readAntigravityMcpConfig();
  const hadExisting = hasAntigravityConvoyServer(existing);

  if (hadExisting && !input.force) {
    const overwrite = await input.confirmOverwrite(
      `Existing convoy MCP config found in ${filePath}. Overwrite?`,
    );
    if (!overwrite) {
      input.log.info(chalk.dim(`  - Skipped ${filePath} update`));
      return;
    }
  }

  writeAntigravityMcpConfig(
    upsertAntigravityConvoyServer(existing, {
      disabled: false,
      headers: { Authorization: `Bearer ${input.apiKey}` },
      serverUrl: input.mcpUrl,
    }),
  );

  input.log.info(
    chalk.green("  ✓") + ` ${hadExisting ? "Updated" : "Created"} ${chalk.cyan(filePath)}`,
  );
  input.log.info(
    chalk.dim("    Antigravity reads MCP servers per user, so every agy session uses this project."),
  );
}

async function installAntigravitySkill(input: InstallSkillInput): Promise<TargetInstallResult[]> {
  const sourceDir = path.join(input.marketplaceDir, SKILL_RELATIVE_PATH);
  if (!fs.existsSync(sourceDir)) {
    return [
      {
        target: "antigravity",
        label: "Antigravity",
        status: "failed",
        reason: `Skill source not found at ${sourceDir}`,
      },
    ];
  }

  return [
    await copyDirectoryWithOverwrite({
      target: "antigravity",
      label: "Antigravity",
      sourceDir,
      destinationDir: getAntigravitySkillDestination(input.scope, input.baseDir),
      force: input.force,
      confirmOverwrite: input.confirmOverwrite,
      preparedDestinations: input.preparedDestinations,
    }),
  ];
}

export const antigravityDriver: InitTargetDriver = {
  id: "antigravity",
  label: "Antigravity",
  configureMcp: configureAntigravityMcp,
  installSkill: installAntigravitySkill,
};
