import { parseOptionalEnum } from "../../lib/parsers.js";

/** Mirrors `cliTypeValidator` in `apps/web/convex/cli/lib/runtimes/validators.ts`. */
export const CLI_TYPES = [
  "claude-code",
  "codex",
  "amp",
  "opencode",
  "droid",
  "cursor",
  "gemini",
  "antigravity",
  "coderabbit",
  "github-copilot",
  "other",
] as const;

export type CliType = (typeof CLI_TYPES)[number];

/** Rejected here so a typo names the valid runtimes instead of failing in the validator. */
export function parseCliType(value: string | undefined): CliType | undefined {
  return parseOptionalEnum(value, "--cli-type", CLI_TYPES);
}
