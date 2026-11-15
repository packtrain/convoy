import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import {
  getOpencodeMcpConfigPath,
  hasOpencodeConvoyServer,
  isOpencodeMcpConfigGitignored,
  readOpencodeMcpConfig,
  upsertOpencodeConvoyServer,
  writeOpencodeMcpConfig,
} from "../config/opencode-mcp.js";
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

function resolveOpencodeConfigHome(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const configRoot =
    xdgConfigHome && xdgConfigHome.length > 0
      ? path.resolve(xdgConfigHome)
      : path.join(os.homedir(), ".config");
  return path.join(configRoot, "opencode");
}

export function getOpencodeSkillDestination(
  scope: InitScope,
  baseDir: string,
): string {
  if (scope === "project") {
    return path.join(path.resolve(baseDir), ".opencode", "skills", SKILL_NAME);
  }
  return path.join(resolveOpencodeConfigHome(), "skills", SKILL_NAME);
}

async function configureOpencodeMcp(input: ConfigureMcpInput): Promise<void> {
  const existing = readOpencodeMcpConfig(input.baseDir);
  const hadExisting = hasOpencodeConvoyServer(existing);

  let shouldOverwrite = true;
  if (hadExisting && !input.force) {
    shouldOverwrite = await input.confirmOverwrite(
      "Existing convoy MCP config found in opencode.json. Overwrite?",
    );
  }

  if (!shouldOverwrite) {
    input.log.info(chalk.dim("  - Skipped opencode.json update"));
    return;
  }

  const merged = upsertOpencodeConvoyServer(existing, {
    type: "remote",
    url: input.mcpUrl,
    headers: { Authorization: `Bearer ${input.apiKey}` },
    oauth: false,
  });
  writeOpencodeMcpConfig(input.baseDir, merged);

  const filePath = getOpencodeMcpConfigPath(input.baseDir);
  input.log.info(
    chalk.green("  ✓") +
      ` ${hadExisting ? "Updated" : "Created"} ${chalk.cyan(filePath)}`,
  );

  if (!isOpencodeMcpConfigGitignored(input.baseDir)) {
    input.log.warn(
      chalk.yellow(
        "\n  ⚠ opencode.json contains API keys. Add it to .gitignore:",
      ),
    );
    input.log.info(chalk.dim("    echo 'opencode.json' >> .gitignore"));
  }
}

async function installOpencodeSkill(
  input: InstallSkillInput,
): Promise<TargetInstallResult[]> {
  const sourceDir = path.join(input.marketplaceDir, SKILL_RELATIVE_PATH);
  if (!fs.existsSync(sourceDir)) {
    return [
      {
        target: "opencode",
        label: "OpenCode",
        status: "failed",
        reason: `Skill source not found at ${sourceDir}`,
      },
    ];
  }

  return [
    await copyDirectoryWithOverwrite({
      target: "opencode",
      label: "OpenCode",
      sourceDir,
      destinationDir: getOpencodeSkillDestination(input.scope, input.baseDir),
      force: input.force,
      confirmOverwrite: input.confirmOverwrite,
      preparedDestinations: input.preparedDestinations,
    }),
  ];
}

export const opencodeDriver: InitTargetDriver = {
  id: "opencode",
  label: "OpenCode",
  configureMcp: configureOpencodeMcp,
  installSkill: installOpencodeSkill,
};
