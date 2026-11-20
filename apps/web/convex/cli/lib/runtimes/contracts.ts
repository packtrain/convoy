export const CLI_RUNTIME_SLUGS = [
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

export type CliRuntimeSlug = (typeof CLI_RUNTIME_SLUGS)[number];

/** The runtime the product assumes when none is picked (composers, workflow lanes). */
export const DEFAULT_FALLBACK_CLI_TYPE: CliRuntimeSlug = "claude-code";

export const GENERIC_CLI_RUNTIME_SLUGS = [
  "amp",
  "droid",
  "cursor",
  "gemini",
  "antigravity",
  "coderabbit",
  "github-copilot",
  "other",
] as const;

export type GenericCliRuntimeSlug = (typeof GENERIC_CLI_RUNTIME_SLUGS)[number];

export type GenericAvailableCli<
  T extends GenericCliRuntimeSlug = GenericCliRuntimeSlug,
> = {
  type: T;
  version: string;
};

export type CliRuntimeModel = string;

export type CliRuntimeModelOption = {
  value: CliRuntimeModel;
  label: string;
  description: string;
  runModel?: string;
};

export type CliRuntimeEffortOption = {
  value: string;
  label: string;
  description: string;
};

export type RawCliChunk = {
  type: string;
  data: string;
};

export type ParseResult<T> =
  | { success: true; value: T }
  | { success: false; message: string };
