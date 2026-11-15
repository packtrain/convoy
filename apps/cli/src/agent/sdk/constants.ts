import type { CleanupPolicy, RunLimits } from "./types.js";

export const DEFAULT_LIMITS: RunLimits = {
  maxConcurrentRuns: 4,
  maxRunsPerWorkingDir: 1,
  startupTimeoutMs: 20_000,
  idleTimeoutMs: 180_000,
  maxRunTimeoutMs: 1_800_000,
  terminateGraceMs: 3_000,
  forceKillGraceMs: 1_500,
  maxLineBytesStdout: 262_144,
  maxLineBytesStderr: 131_072,
  maxEventQueueDepth: 2_000,
  maxRawFrameBytes: 262_144,
  terminateAfterResultMs: 1_500,
};

export const DEFAULT_ISOLATION_CLEANUP_POLICY: CleanupPolicy = "on-success";

export const DEFAULT_PROVIDER_COMMANDS: Record<string, string[]> = {
  claude: ["claude", "claude-code"],
  codex: ["codex"],
  opencode: ["opencode"],
  amp: ["amp"],
  cursor: ["cursor-agent"],
  droid: ["droid"],
  factory: ["factory"],
  coderabbit: ["coderabbit", "code-rabbit"],
  gemini: ["gemini"],
  generic: [],
};

export const DEFAULT_ISOLATION_ROOT = ".convoy-cli-runs";
