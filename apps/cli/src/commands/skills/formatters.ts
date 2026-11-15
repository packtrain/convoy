import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";

export type Skill = FunctionReturnType<typeof api.skills.core.listByOrganization>[number];

/**
 * Every field is optional, so this prints what was recorded: the repository with its
 * subpath, then the commit — the version — with the ref it came from.
 */
export function formatSkillSource(source: NonNullable<Skill["source"]>): string {
  const repo = source.repoUrl ? `${source.repoUrl}${source.subpath ? `/${source.subpath}` : ""}` : (source.subpath ?? "");
  const version = [source.commitSha, source.ref && `(${source.ref})`].filter(Boolean).join(" ");

  return [repo, version].filter(Boolean).join(repo && source.commitSha ? "@" : " ") || "None";
}

export function formatSkillLine(skill: Skill): string {
  const description = skill.description ? ` - ${skill.description}` : "";
  const category = skill.category ? ` ${chalk.dim(`[${skill.category}]`)}` : "";
  return `${chalk.dim(`v${skill.version}`)} /${skill.name}${description}${category} ${chalk.dim(`(${skill._id})`)}`;
}
