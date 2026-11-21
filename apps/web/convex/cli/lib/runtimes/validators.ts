import { v, type Infer } from "convex/values";
import { availableClaudeCliValidator } from "./claudeCode/validators";
import { availableCodexCliValidator } from "./codex/validators";
import { availableOpencodeCliValidator } from "./opencode/validators";
import { availableAntigravityCliValidator } from "./antigravity/validators";

export const cliTypeValidator = v.union(
  v.literal("claude-code"),
  v.literal("codex"),
  v.literal("amp"),
  v.literal("opencode"),
  v.literal("droid"),
  v.literal("cursor"),
  v.literal("gemini"),
  v.literal("antigravity"),
  v.literal("coderabbit"),
  v.literal("github-copilot"),
  v.literal("other"),
);

export const availableGenericCliValidator = v.object({
  type: v.union(
    v.literal("amp"),
    v.literal("droid"),
    v.literal("cursor"),
    v.literal("gemini"),
    v.literal("coderabbit"),
    v.literal("github-copilot"),
    v.literal("other"),
  ),
  version: v.string(),
});

export const availableCliValidator = v.union(
  availableClaudeCliValidator,
  availableCodexCliValidator,
  availableOpencodeCliValidator,
  availableAntigravityCliValidator,
  availableGenericCliValidator,
);

/**
 * One slash command a runtime advertises (OS-1806). The stream's init event
 * carries names only, so `description`/`argumentHint` are present just for
 * runtimes that report the richer inventory — see
 * `docs/specs/cli-runtime-commands.md`.
 */
export const runtimeSlashCommandValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  argumentHint: v.optional(v.string()),
});

export type RuntimeSlashCommand = Infer<typeof runtimeSlashCommandValidator>;

/** A bare advertised name, or one with its description and argument hint. */
export function toRuntimeSlashCommand(value: unknown): RuntimeSlashCommand | null {
  if (typeof value === "string") {
    return value.length > 0 ? { name: value } : null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    return null;
  }

  return {
    name: entry.name,
    // Empty strings are what the SDK sends for "no hint" — dropped, so the
    // menu never renders a blank label.
    ...(typeof entry.description === "string" && entry.description.length > 0
      ? { description: entry.description }
      : {}),
    ...(typeof entry.argumentHint === "string" && entry.argumentHint.length > 0
      ? { argumentHint: entry.argumentHint }
      : {}),
  };
}
