import * as path from "node:path";
import { confirm } from "@inquirer/prompts";
import { InitError } from "./errors.js";
import { getMarketplaceDir } from "./marketplace.js";
import { resolveClaudeMethods, resolveScope, resolveSkillTargets } from "./prompts.js";
import { renderSkillInstallSummary } from "./summary.js";
import { getInitDrivers } from "./targets/registry.js";
import { type InitSkillConfig, type TargetInstallResult } from "./types.js";

export async function runInitSkill(config: InitSkillConfig): Promise<void> {
  const marketplaceDir = getMarketplaceDir();
  const targets = await resolveSkillTargets(config.cliTargets);
  const scope = await resolveScope(config.scope);
  const baseDir = path.resolve(config.baseDir ?? process.cwd());

  const claudeMethods =
    targets.includes("claude")
      ? await resolveClaudeMethods(config.claudeMethods)
      : undefined;

  const drivers = getInitDrivers(targets);
  const results: TargetInstallResult[] = [];
  const preparedDestinations = new Set<string>();

  for (const driver of drivers) {
    results.push(
      ...(await driver.installSkill({
        baseDir,
        scope,
        marketplaceDir,
        force: config.force,
        confirmOverwrite: (message: string) => confirm({ message, default: true }),
        preparedDestinations,
        claudeMethods,
      }))
    );
  }

  renderSkillInstallSummary(results);

  const allFailed = results.every((result) => result.status === "failed");
  if (allFailed) {
    throw new InitError("All skill installations failed. Check the errors above.");
  }
}
