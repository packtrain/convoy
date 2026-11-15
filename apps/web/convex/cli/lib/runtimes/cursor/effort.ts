import type { CliRuntimeEffortOption } from "../contracts";
import type { CliRuntimeEffortContext } from "../registry";
import { isCursorModelSlot, type CursorModelSlot } from "./models";

/**
 * Cursor encodes reasoning inside `--model`, using bracket parameters for
 * current models and legacy suffixes for older entries. Options vary by model.
 */

const DEFAULT_EFFORT_OPTION: CliRuntimeEffortOption = {
  value: "default",
  label: "Default",
  description: "Use the model's default reasoning",
};

/** Anthropic 1M models: effort tiers plus an extended-thinking variant. */
const ANTHROPIC_EFFORT_OPTIONS: CliRuntimeEffortOption[] = [
  { value: "low", label: "Low", description: "Light reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Very deep reasoning",
  },
  {
    value: "max",
    label: "Max",
    description: "Maximum reasoning for the hardest problems",
  },
  {
    value: "thinking",
    label: "Thinking",
    description: "Extended thinking before responding",
  },
];

const GPT_EFFORT_OPTIONS: CliRuntimeEffortOption[] = [
  { value: "low", label: "Low", description: "Light reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Maximum reasoning for the hardest problems",
  },
];

const GPT_56_EFFORT_OPTIONS: CliRuntimeEffortOption[] = [
  { value: "none", label: "None", description: "No reasoning" },
  { value: "low", label: "Low", description: "Light reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
  { value: "xhigh", label: "Extra high", description: "Very deep reasoning" },
  {
    value: "max",
    label: "Max",
    description: "Maximum reasoning for the hardest problems",
  },
];

const GROK_45_EFFORT_OPTIONS: CliRuntimeEffortOption[] = [
  { value: "low", label: "Low", description: "Light reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
];

const GROK_46_EFFORT_OPTIONS: CliRuntimeEffortOption[] = [
  ...GROK_45_EFFORT_OPTIONS,
  { value: "xhigh", label: "Extra high", description: "Very deep reasoning" },
];

const CURSOR_MODEL_EFFORT_OPTIONS: Record<
  CursorModelSlot,
  CliRuntimeEffortOption[]
> = {
  default: [],
  auto: [],
  "composer-2.5": [],
  "gemini-3.1-pro": [],
  "gemini-3.7-flash": [],
  "gemini-3.5-flash": [],
  "gpt-5-mini": [],
  "kimi-k2.7-code": [],
  "grok-build-0.1": [],
  // CLI effort variants need verification; see docs/specs/cli-cursor-runtime.md.
  "claude-sonnet-5-5": [],
  "claude-sonnet-5": ANTHROPIC_EFFORT_OPTIONS,
  "claude-opus-5-5": [],
  "claude-opus-5": ANTHROPIC_EFFORT_OPTIONS,
  "claude-opus-4-8": ANTHROPIC_EFFORT_OPTIONS,
  "claude-fable-5-2": [],
  "claude-fable-5-1": ANTHROPIC_EFFORT_OPTIONS,
  "claude-fable-5": ANTHROPIC_EFFORT_OPTIONS,
  "claude-haiku-5-5": [],
  "gpt-5.6-sol": GPT_56_EFFORT_OPTIONS,
  "gpt-5.6-terra": GPT_56_EFFORT_OPTIONS,
  "gpt-5.6-luna": GPT_56_EFFORT_OPTIONS,
  "gpt-5.5": GPT_EFFORT_OPTIONS,
  "gpt-5.4": GPT_EFFORT_OPTIONS,
  "gpt-5.3-codex": GPT_EFFORT_OPTIONS,
  "grok-4.6": GROK_46_EFFORT_OPTIONS,
  "grok-4.5": GROK_45_EFFORT_OPTIONS,
  // GLM ships two tiers only: glm-5.2-high (canonical) and glm-5.2-max.
  "glm-5.2": [
    {
      value: "max",
      label: "Max",
      description: "Maximum reasoning for the hardest problems",
    },
  ],
};

function getModelEffortOptions(
  context: CliRuntimeEffortContext | undefined,
): CliRuntimeEffortOption[] {
  const model = context?.cliModel;
  if (!isCursorModelSlot(model)) {
    return [];
  }
  return CURSOR_MODEL_EFFORT_OPTIONS[model];
}

export function getCursorEffortOptions(
  context: CliRuntimeEffortContext | undefined,
): CliRuntimeEffortOption[] {
  const options = getModelEffortOptions(context);
  if (options.length === 0) {
    return [];
  }
  return [DEFAULT_EFFORT_OPTION, ...options];
}

/**
 * Without a model context, acceptance is lenient (any single token): model and
 * effort are stored separately, so storage normalization must let a pair
 * survive a round-trip even when the tiers shift. Callers that know the
 * selected model pass it as context and get the same rule
 * `resolveCursorRunEffort` applies — only efforts that model offers.
 */
export function isCursorEffortSupported(
  value: unknown,
  context?: CliRuntimeEffortContext,
): value is string {
  if (typeof value !== "string" || !/^\S+$/.test(value)) {
    return false;
  }

  if (context?.cliModel === undefined) {
    return true;
  }

  return getCursorEffortOptions(context).some(
    (option) => option.value === value,
  );
}

export function normalizeCursorStoredEffort(
  value: string | undefined,
): string | undefined {
  return isCursorEffortSupported(value) ? value : undefined;
}

export function resolveCursorRunEffort(
  value: string | undefined,
  context: CliRuntimeEffortContext | undefined,
): string | undefined {
  if (!isCursorEffortSupported(value) || value === "default") {
    return undefined;
  }

  // An effort the selected model does not offer never leaks into the run
  // (stale stored value after a model switch).
  const options = getModelEffortOptions(context);
  return options.some((option) => option.value === value) ? value : undefined;
}
