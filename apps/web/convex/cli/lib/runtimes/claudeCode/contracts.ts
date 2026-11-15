export const CLAUDE_CODE_MODEL_SLOTS = [
  "default",
  "sonnet",
  "sonnet-1m",
  "sonnet-5-5",
  "opus-5-5",
  "opus-5",
  "opus",
  "opus-1m",
  "opus-4-7",
  "opus-4-7-1m",
  "fable-5-2",
  "fable-5-1",
  "fable",
  "haiku-5-5",
  "haiku",
] as const;

export type ClaudeCodeModelSlot = (typeof CLAUDE_CODE_MODEL_SLOTS)[number];

// Retired Opus 4.7/4.8 and Haiku 4.5 slots stay valid for stored selections.
// See docs/specs/cli-thread-model-selection.md.
export const CLAUDE_CODE_SELECTABLE_MODEL_SLOTS: readonly ClaudeCodeModelSlot[] = [
  "default",
  "sonnet",
  "sonnet-1m",
  "sonnet-5-5",
  "opus-5-5",
  "opus-5",
  "fable-5-2",
  "fable-5-1",
  "fable",
  "haiku-5-5",
];

export const CLAUDE_CODE_PROVIDERS = [
  "bedrock",
  // Mantle proxies Bedrock but rejects the `us.` cross-region prefix, so it
  // needs its own catalog (see PROVIDER_MODEL_OPTIONS).
  "mantle",
  "anthropic",
  "unknown",
] as const;

export type ClaudeCodeProvider = (typeof CLAUDE_CODE_PROVIDERS)[number];

export type ClaudeCodeAvailableModel = {
  slot: ClaudeCodeModelSlot;
  label: string;
  runModel?: string;
};

export type ClaudeCodeAvailableCli = {
  type: "claude-code";
  version: string;
  provider?: ClaudeCodeProvider;
  models?: Array<ClaudeCodeAvailableModel>;
};
