import chalk from "chalk";
import { logSkillsShAlternative } from "../../lib/skill-install-guidance.js";
import type { TargetInstallResult } from "./types.js";

export function renderSkillInstallSummary(results: TargetInstallResult[]): void {
  console.log(chalk.underline("\nSkill installation summary"));
  for (const result of results) {
    if (result.status === "installed") {
      console.log(chalk.green(`  \u2713 ${result.label}: installed`));
      continue;
    }
    if (result.status === "skipped") {
      console.log(chalk.yellow(`  - ${result.label}: skipped`));
    } else {
      console.log(chalk.red(`  \u2717 ${result.label}: failed`));
    }
    if (result.reason) {
      console.log(chalk.dim(`    ${result.reason}`));
    }
  }
  logSkillsShAlternative();
}
