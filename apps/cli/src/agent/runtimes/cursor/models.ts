/**
 * Stored model slots. Keep in sync with
 * `apps/web/convex/cli/lib/runtimes/cursor/models.ts`; no shared package
 * crosses the CLI/Convex boundary.
 */
const CURSOR_MODEL_SLOTS = [
  "default",
  "auto",
  "composer-2.5",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-haiku-5-5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5-mini",
  "gpt-5.3-codex",
  "gemini-3.1-pro",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "glm-5.2",
  "kimi-k2.7-code",
  "grok-4.6",
  "grok-4.5",
  "grok-build-0.1",
] as const;

export function isCursorModelSlot(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (CURSOR_MODEL_SLOTS as readonly string[]).includes(value)
  );
}

const ANTHROPIC_BASE_MODELS = new Set([
  "claude-sonnet-5",
  "claude-opus-4-8",
  "claude-fable-5",
]);

const ANTHROPIC_EFFORT_SUFFIXES = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const PARAMETERIZED_MODEL_EFFORTS: Record<string, Set<string>> = {
  "claude-fable-5-1": new Set([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "thinking",
  ]),
  "claude-opus-5": new Set([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "thinking",
  ]),
  "gpt-5.6-sol": new Set([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
  "gpt-5.6-terra": new Set([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
  "gpt-5.6-luna": new Set([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]),
  "grok-4.6": new Set(["low", "medium", "high", "xhigh"]),
  "grok-4.5": new Set(["low", "medium", "high"]),
};

/**
 * Combines a stored model slot and effort into Cursor's `--model` value.
 * Current models use bracket parameters; legacy models retain suffixed ids.
 */
export function resolveCursorModelName(
  baseModel: string,
  reasoning?: string,
): string {
  const parameterizedEfforts = PARAMETERIZED_MODEL_EFFORTS[baseModel];
  if (parameterizedEfforts) {
    if (
      !reasoning ||
      reasoning === "default" ||
      !parameterizedEfforts.has(reasoning)
    ) {
      return baseModel;
    }
    if (reasoning === "thinking") {
      return `${baseModel}[thinking=true,effort=high]`;
    }
    return `${baseModel}[effort=${reasoning}]`;
  }

  if (ANTHROPIC_BASE_MODELS.has(baseModel)) {
    // Canonical id ("Sonnet 5 1M" etc.) is the -high tier.
    if (reasoning === undefined || reasoning === "default") {
      return `${baseModel}-high`;
    }
    // Extended thinking rides its own family; canonical tier is -high too.
    if (reasoning === "thinking") {
      return `${baseModel}-thinking-high`;
    }
    if (ANTHROPIC_EFFORT_SUFFIXES.has(reasoning)) {
      return `${baseModel}-${reasoning}`;
    }
    return `${baseModel}-high`;
  }

  switch (baseModel) {
    case "gpt-5.5":
      // Canonical "GPT-5.5 1M" is the -medium tier; xhigh is spelled
      // "extra-high" in this family only.
      if (reasoning === "low" || reasoning === "high") {
        return `${baseModel}-${reasoning}`;
      }
      if (reasoning === "xhigh") {
        return `${baseModel}-extra-high`;
      }
      return `${baseModel}-medium`;
    case "gpt-5.4":
      // Canonical "GPT-5.4 1M" is the -medium tier.
      if (
        reasoning === "low" ||
        reasoning === "high" ||
        reasoning === "xhigh"
      ) {
        return `${baseModel}-${reasoning}`;
      }
      return `${baseModel}-medium`;
    case "gpt-5.3-codex":
      // The unsuffixed base name is the canonical medium tier.
      if (
        reasoning === "low" ||
        reasoning === "high" ||
        reasoning === "xhigh"
      ) {
        return `${baseModel}-${reasoning}`;
      }
      return baseModel;
    case "glm-5.2":
      // Two tiers only; bare "glm-5.2" is not a valid id.
      return reasoning === "max" ? `${baseModel}-max` : `${baseModel}-high`;
    default:
      // auto, composer-2.5, gemini-*, gpt-5-mini, kimi-k2.7-code,
      // grok-build-0.1: plain ids, no reasoning tiers.
      return baseModel;
  }
}
