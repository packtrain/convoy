import * as path from "node:path";

export const INIT_TARGETS = ["claude", "codex", "opencode", "antigravity"] as const;
export type InitTarget = (typeof INIT_TARGETS)[number];

/** Targets `init mcp` writes when `--cli` is omitted. Antigravity's config is per user, so it must be named. */
export const DEFAULT_MCP_TARGETS: ReadonlyArray<InitTarget> = ["claude", "codex", "opencode"];

export const INIT_SCOPES = ["project", "user"] as const;
export type InitScope = (typeof INIT_SCOPES)[number];

export const CLAUDE_METHODS = ["plugin", "raw"] as const;
export type ClaudeMethod = (typeof CLAUDE_METHODS)[number];

export const SKILL_NAME = "convoy";
export const SKILL_RELATIVE_PATH = path.join("convoy", "skills", "convoy");

export type InstallStatus = "installed" | "skipped" | "failed";

export interface TargetInstallResult {
  target: InitTarget;
  label: string;
  status: InstallStatus;
  reason?: string;
}

export interface InitMcpConfig {
  convexUrl: string;
  apiKey: string;
  projectId: string;
  outputDir?: string;
  force?: boolean;
  cliTargets?: ReadonlyArray<InitTarget>;
}

export interface InitSkillConfig {
  cliTargets?: InitTarget[];
  scope?: InitScope;
  claudeMethods?: ClaudeMethod[];
  baseDir?: string;
  force?: boolean;
}
