import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

const SKILL_NAME = "convoy";

export const CONVOY_SKILLS_SH_INSTALL_COMMAND =
  "npx skills add https://github.com/packtrain/convoy/tree/main/plugins/convoy/skills --skill convoy";

const warnedProjectSkillPaths = new Set<string>();

function hasSkillFile(skillDir: string): boolean {
  return fs.existsSync(path.join(skillDir, "SKILL.md"));
}

export function getProjectSkillDirectories(baseDir: string): string[] {
  const resolvedBaseDir = path.resolve(baseDir);
  return [
    path.join(resolvedBaseDir, ".agents", "skills", SKILL_NAME),
    path.join(resolvedBaseDir, ".claude", "skills", SKILL_NAME),
  ];
}

export function hasProjectConvoySkill(baseDir: string): boolean {
  return getProjectSkillDirectories(baseDir).some((skillDir) =>
    hasSkillFile(skillDir)
  );
}

export function logSkillsShAlternative(): void {
  console.log(chalk.dim("\nAlternative installer with skills.sh:"));
  console.log(chalk.dim(`  ${CONVOY_SKILLS_SH_INSTALL_COMMAND}`));
}

export function maybeLogMissingProjectSkillHint(paths: string[]): void {
  const projectPath = paths[0] ?? process.cwd();
  const resolvedProjectPath = path.resolve(projectPath);
  if (warnedProjectSkillPaths.has(resolvedProjectPath)) {
    return;
  }

  if (hasProjectConvoySkill(resolvedProjectPath)) {
    return;
  }

  warnedProjectSkillPaths.add(resolvedProjectPath);

  console.log(
    chalk.yellow("Optional: Convoy task skill was not found for this project.")
  );
  console.log(chalk.dim("Install it with:"));
  console.log(chalk.dim("  convoy init skill --scope project"));
  console.log(chalk.dim("Or with skills.sh:"));
  console.log(chalk.dim(`  ${CONVOY_SKILLS_SH_INSTALL_COMMAND}`));
  console.log("");
}
