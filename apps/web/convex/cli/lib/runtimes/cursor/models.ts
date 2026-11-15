import type { CliRuntimeModel, CliRuntimeModelOption } from "../contracts";

/**
 * Curated Cursor model slots, refreshed from Cursor's model catalog in
 * August 2026. Cursor does not advertise this inventory in its stream.
 */
export const CURSOR_MODEL_SLOTS = [
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

export type CursorModelSlot = (typeof CURSOR_MODEL_SLOTS)[number];

// Retired models stay valid for stored selections.
const CURSOR_SELECTABLE_MODEL_SLOTS = CURSOR_MODEL_SLOTS.filter(
  (slot) => slot !== "claude-opus-4-8",
);

type CursorResolvedModel = {
  label: string;
  description: string;
  runModel?: string;
};

const CURSOR_MODEL_OPTIONS: Record<CursorModelSlot, CursorResolvedModel> = {
  default: {
    label: "Default",
    description: "Use the connected machine's configured Cursor model",
  },
  auto: {
    label: "Auto",
    description: "Cursor picks the best model per request",
    runModel: "auto",
  },
  "composer-2.5": {
    label: "Composer 2.5",
    description: "Cursor's fast agentic coding model",
    runModel: "composer-2.5",
  },
  "claude-sonnet-5-5": {
    label: "Sonnet 5.5",
    description: "Anthropic Sonnet 5.5, runtime-default reasoning, up to 1M context",
    runModel: "claude-sonnet-5-5",
  },
  "claude-sonnet-5": {
    label: "Sonnet 5",
    description: "Anthropic's balanced model (1M context)",
    runModel: "claude-sonnet-5",
  },
  "claude-opus-5-5": {
    label: "Opus 5.5",
    description: "Anthropic Opus 5.5, runtime-default reasoning, up to 1M context",
    runModel: "claude-opus-5-5",
  },
  "claude-opus-5": {
    label: "Opus 5",
    description: "Anthropic's Opus 5 model (1M context)",
    runModel: "claude-opus-5",
  },
  "claude-opus-4-8": {
    label: "Opus 4.8",
    description: "Anthropic's most capable Opus model (1M context)",
    runModel: "claude-opus-4-8",
  },
  "claude-fable-5-2": {
    label: "Fable 5.2",
    description:
      "Anthropic Fable 5.2, runtime-default reasoning (1M context, no zero-data-retention)",
    runModel: "claude-fable-5-2",
  },
  "claude-fable-5-1": {
    label: "Fable 5.1",
    description:
      "Anthropic's frontier model (1M context, no zero-data-retention)",
    runModel: "claude-fable-5-1",
  },
  "claude-fable-5": {
    label: "Fable 5",
    description: "Anthropic's frontier model (1M context, no zero-data-retention)",
    runModel: "claude-fable-5",
  },
  "claude-haiku-5-5": {
    label: "Haiku 5.5",
    description: "Anthropic Haiku 5.5, runtime-default reasoning, up to 1M context",
    runModel: "claude-haiku-5-5",
  },
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol",
    description: "OpenAI's flagship model (1M context)",
    runModel: "gpt-5.6-sol",
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra",
    description: "OpenAI model balancing intelligence and cost",
    runModel: "gpt-5.6-terra",
  },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna",
    description: "OpenAI's fast, cost-sensitive model",
    runModel: "gpt-5.6-luna",
  },
  "gpt-5.5": {
    label: "GPT-5.5",
    description: "OpenAI flagship model (1M context)",
    runModel: "gpt-5.5",
  },
  "gpt-5.4": {
    label: "GPT-5.4",
    description: "Previous OpenAI flagship model",
    runModel: "gpt-5.4",
  },
  "gpt-5-mini": {
    label: "GPT-5 Mini",
    description: "Fast lightweight OpenAI model",
    runModel: "gpt-5-mini",
  },
  "gpt-5.3-codex": {
    label: "Codex 5.3",
    description: "OpenAI coding model",
    runModel: "gpt-5.3-codex",
  },
  "gemini-3.1-pro": {
    label: "Gemini 3.1 Pro",
    description: "Google's flagship model",
    runModel: "gemini-3.1-pro",
  },
  "gemini-3.7-flash": {
    label: "Gemini 3.7 Flash",
    description: "Google's latest fast model (1M context)",
    runModel: "gemini-3.7-flash",
  },
  "gemini-3.5-flash": {
    label: "Gemini 3.5 Flash",
    description: "Google's fast model",
    runModel: "gemini-3.5-flash",
  },
  "glm-5.2": {
    label: "GLM 5.2",
    description: "Z.ai's flagship coding model",
    runModel: "glm-5.2",
  },
  "kimi-k2.7-code": {
    label: "Kimi K2.7 Code",
    description: "Moonshot's coding model",
    runModel: "kimi-k2.7-code",
  },
  "grok-4.6": {
    label: "Grok 4.6",
    description: "Cursor and xAI's frontier agentic model",
    runModel: "grok-4.6",
  },
  "grok-4.5": {
    label: "Grok 4.5",
    description: "Cursor and xAI's long-running agent model",
    runModel: "grok-4.5",
  },
  "grok-build-0.1": {
    label: "Grok Build 0.1",
    description: "xAI's agentic coding model (1M context)",
    runModel: "grok-build-0.1",
  },
};

export function isCursorModelSlot(value: unknown): value is CursorModelSlot {
  return (
    typeof value === "string" &&
    (CURSOR_MODEL_SLOTS as readonly string[]).includes(value)
  );
}

export function normalizeCursorModel(
  cliModel: CliRuntimeModel | undefined,
): string | undefined {
  return isCursorModelSlot(cliModel) ? cliModel : undefined;
}

export function getCursorModelOptions(): Array<CliRuntimeModelOption> {
  return CURSOR_SELECTABLE_MODEL_SLOTS.map((slot) => ({
    value: slot,
    label: CURSOR_MODEL_OPTIONS[slot].label,
    description: CURSOR_MODEL_OPTIONS[slot].description,
    runModel: CURSOR_MODEL_OPTIONS[slot].runModel,
  }));
}

export function getCursorModelOption(
  value: CliRuntimeModel | undefined,
): CliRuntimeModelOption | undefined {
  if (!isCursorModelSlot(value)) {
    return undefined;
  }
  return {
    value,
    label: CURSOR_MODEL_OPTIONS[value].label,
    description: CURSOR_MODEL_OPTIONS[value].description,
    runModel: CURSOR_MODEL_OPTIONS[value].runModel,
  };
}

export function resolveCursorRunModel(
  cliModel: CliRuntimeModel | undefined,
): string | undefined {
  return getCursorModelOption(cliModel)?.runModel;
}
