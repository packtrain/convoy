import { v } from "convex/values";

export const claudeCodeModelValidator = v.union(
  v.literal("default"),
  v.literal("sonnet"),
  v.literal("sonnet-1m"),
  v.literal("sonnet-5-5"),
  v.literal("opus-5-5"),
  v.literal("opus-5"),
  v.literal("opus"),
  v.literal("opus-1m"),
  v.literal("opus-4-7"),
  v.literal("opus-4-7-1m"),
  v.literal("fable-5-2"),
  v.literal("fable-5-1"),
  v.literal("fable"),
  v.literal("haiku-5-5"),
  v.literal("haiku"),
);

export const claudeCodeProviderValidator = v.union(
  v.literal("bedrock"),
  v.literal("mantle"),
  v.literal("anthropic"),
  v.literal("unknown"),
);

export const claudeCodeAvailableModelValidator = v.object({
  slot: claudeCodeModelValidator,
  label: v.string(),
  runModel: v.optional(v.string()),
});

export const availableClaudeCliValidator = v.object({
  type: v.literal("claude-code"),
  version: v.string(),
  provider: v.optional(claudeCodeProviderValidator),
  models: v.optional(v.array(claudeCodeAvailableModelValidator)),
});
