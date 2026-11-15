import type {
  CliRuntimeModel,
  CliRuntimeModelOption,
} from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import {
  CLAUDE_CODE_MODEL_SLOTS,
  CLAUDE_CODE_PROVIDERS,
  CLAUDE_CODE_SELECTABLE_MODEL_SLOTS,
  type ClaudeCodeAvailableCli,
  type ClaudeCodeModelSlot,
  type ClaudeCodeProvider,
} from "./contracts";

export type ClaudeCodeResolvedModel = {
  label: string;
  runModel?: string;
};

const GENERIC_MODEL_OPTIONS: Record<
  ClaudeCodeModelSlot,
  ClaudeCodeResolvedModel
> = {
  default: { label: "Default" },
  sonnet: { label: "Sonnet", runModel: "sonnet" },
  "sonnet-1m": { label: "Sonnet (1M)", runModel: "sonnet[1m]" },
  "sonnet-5-5": { label: "Sonnet 5.5", runModel: "claude-sonnet-5-5" },
  "opus-5-5": { label: "Opus 5.5", runModel: "claude-opus-5-5" },
  "opus-5": { label: "Opus 5", runModel: "claude-opus-5" },
  opus: { label: "Opus", runModel: "opus" },
  "opus-1m": { label: "Opus (1M)", runModel: "opus[1m]" },
  "opus-4-7": { label: "Opus 4.7", runModel: "claude-opus-4-7" },
  "opus-4-7-1m": {
    label: "Opus 4.7 (1M)",
    runModel: "claude-opus-4-7[1m]",
  },
  "fable-5-2": { label: "Fable 5.2", runModel: "claude-fable-5-2" },
  "fable-5-1": { label: "Fable 5.1", runModel: "claude-fable-5-1" },
  fable: { label: "Fable 5", runModel: "claude-fable-5" },
  "haiku-5-5": { label: "Haiku 5.5", runModel: "claude-haiku-5-5" },
  haiku: { label: "Haiku", runModel: "haiku" },
};

const CLAUDE_CODE_MODEL_DESCRIPTIONS: Record<ClaudeCodeModelSlot, string> = {
  default: "Use Claude Code's default model",
  sonnet: "Balanced speed and quality",
  "sonnet-1m": "Long-context Sonnet session",
  "sonnet-5-5": "Sonnet 5.5, balanced speed and quality with 1M context",
  "opus-5-5": "Opus 5.5 for agentic coding and long-running work",
  "opus-5": "Opus 5 for agentic coding and long-running work",
  opus: "High-capability Opus 4.8 model",
  "opus-1m": "Long-context Opus 4.8 session",
  "opus-4-7": "Legacy Opus 4.7 model",
  "opus-4-7-1m": "Legacy long-context Opus 4.7 session",
  "fable-5-2": "Latest Fable for demanding reasoning and long-horizon work",
  "fable-5-1": "Fable 5.1 for demanding reasoning and long-horizon work",
  fable: "Next-generation intelligence for long-running agents",
  "haiku-5-5": "Haiku 5.5, fastest model with effort levels and 1M context",
  haiku: "Fastest lightweight model",
};

type ProviderModelOptions = Partial<
  Record<ClaudeCodeModelSlot, ClaudeCodeResolvedModel>
>;

const BEDROCK_MODEL_OPTIONS: ProviderModelOptions = {
  sonnet: {
    label: "Sonnet 5",
    runModel: "us.anthropic.claude-sonnet-5",
  },
  "sonnet-1m": {
    label: "Sonnet 5 (1M)",
    runModel: "us.anthropic.claude-sonnet-5[1m]",
  },
  "sonnet-5-5": {
    label: "Sonnet 5.5",
    runModel: "us.anthropic.claude-sonnet-5-5",
  },
  "opus-5-5": {
    label: "Opus 5.5",
    runModel: "us.anthropic.claude-opus-5-5",
  },
  "opus-5": {
    label: "Opus 5",
    runModel: "us.anthropic.claude-opus-5",
  },
  opus: {
    label: "Opus 4.8",
    runModel: "us.anthropic.claude-opus-4-8",
  },
  "opus-1m": {
    label: "Opus 4.8 (1M)",
    runModel: "us.anthropic.claude-opus-4-8[1m]",
  },
  "opus-4-7": {
    label: "Opus 4.7",
    runModel: "us.anthropic.claude-opus-4-7",
  },
  "opus-4-7-1m": {
    label: "Opus 4.7 (1M)",
    runModel: "us.anthropic.claude-opus-4-7[1m]",
  },
  "fable-5-2": {
    label: "Fable 5.2",
    runModel: "us.anthropic.claude-fable-5-2",
  },
  "fable-5-1": {
    label: "Fable 5.1",
    runModel: "us.anthropic.claude-fable-5-1",
  },
  fable: {
    label: "Fable 5",
    runModel: "us.anthropic.claude-fable-5",
  },
  "haiku-5-5": {
    label: "Haiku 5.5",
    runModel: "us.anthropic.claude-haiku-5-5",
  },
  haiku: {
    label: "Haiku 4.5",
    runModel: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
};

// Mantle proxies Bedrock but rejects the `us.` cross-region prefix, so its
// catalog is the Bedrock one with that prefix stripped from each runModel.
// Slots whose Mantle ID does not follow that rule are listed as overrides.
const MANTLE_RUN_MODEL_OVERRIDES: Partial<Record<ClaudeCodeModelSlot, string>> =
  {
    // Bedrock's dated/versioned Haiku ID; Mantle exposes the short alias.
    haiku: "anthropic.claude-haiku-4-5",
  };

const MANTLE_MODEL_OPTIONS: ProviderModelOptions = Object.fromEntries(
  Object.entries(BEDROCK_MODEL_OPTIONS).map(([slot, model]) => [
    slot,
    {
      ...model,
      runModel:
        MANTLE_RUN_MODEL_OVERRIDES[slot as ClaudeCodeModelSlot] ??
        model.runModel?.replace(/^us\./, ""),
    },
  ]),
);

const PROVIDER_MODEL_OPTIONS: Record<
  Exclude<ClaudeCodeProvider, "unknown">,
  ProviderModelOptions
> = {
  anthropic: {
    sonnet: { label: "Sonnet 5", runModel: "claude-sonnet-5" },
    "sonnet-1m": {
      label: "Sonnet 5 (1M)",
      runModel: "claude-sonnet-5[1m]",
    },
    "sonnet-5-5": { label: "Sonnet 5.5", runModel: "claude-sonnet-5-5" },
    "opus-5-5": { label: "Opus 5.5", runModel: "claude-opus-5-5" },
    "opus-5": { label: "Opus 5", runModel: "claude-opus-5" },
    opus: { label: "Opus 4.8", runModel: "claude-opus-4-8" },
    "opus-1m": {
      label: "Opus 4.8 (1M)",
      runModel: "claude-opus-4-8[1m]",
    },
    "opus-4-7": {
      label: "Opus 4.7",
      runModel: "claude-opus-4-7",
    },
    "opus-4-7-1m": {
      label: "Opus 4.7 (1M)",
      runModel: "claude-opus-4-7[1m]",
    },
    "fable-5-2": {
      label: "Fable 5.2",
      runModel: "claude-fable-5-2",
    },
    "fable-5-1": {
      label: "Fable 5.1",
      runModel: "claude-fable-5-1",
    },
    fable: {
      label: "Fable 5",
      runModel: "claude-fable-5",
    },
    "haiku-5-5": { label: "Haiku 5.5", runModel: "claude-haiku-5-5" },
    haiku: {
      label: "Haiku 4.5",
      runModel: "claude-haiku-4-5-20251001",
    },
  },
  bedrock: BEDROCK_MODEL_OPTIONS,
  mantle: MANTLE_MODEL_OPTIONS,
};

export function isClaudeCodeProvider(
  value: unknown,
): value is ClaudeCodeProvider {
  return CLAUDE_CODE_PROVIDERS.includes(value as ClaudeCodeProvider);
}

export function isClaudeCodeModelSlot(
  value: unknown,
): value is ClaudeCodeModelSlot {
  return CLAUDE_CODE_MODEL_SLOTS.includes(value as ClaudeCodeModelSlot);
}

export function getClaudeAvailableCli(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): ClaudeCodeAvailableCli | undefined {
  return availableClis?.find(
    (cli): cli is ClaudeCodeAvailableCli => cli.type === "claude-code",
  );
}

export function getProviderAwareClaudeModel(
  slot: ClaudeCodeModelSlot,
  provider: ClaudeCodeProvider | undefined,
): ClaudeCodeResolvedModel {
  if (!provider || provider === "unknown") {
    return GENERIC_MODEL_OPTIONS[slot];
  }

  return PROVIDER_MODEL_OPTIONS[provider][slot] ?? GENERIC_MODEL_OPTIONS[slot];
}

export function resolveClaudeRunModelFromProvider(
  slot: ClaudeCodeModelSlot | undefined,
  provider: ClaudeCodeProvider | undefined,
): string | undefined {
  if (!slot || slot === "default") {
    return undefined;
  }

  return getProviderAwareClaudeModel(slot, provider).runModel;
}

export function normalizeClaudeCodeModel(
  cliModel: CliRuntimeModel | undefined,
): ClaudeCodeModelSlot | undefined {
  return isClaudeCodeModelSlot(cliModel) ? cliModel : undefined;
}

export function resolveClaudeRunModel(
  cliModel: CliRuntimeModel | undefined,
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): string | undefined {
  const slot = normalizeClaudeCodeModel(cliModel);
  if (!slot) {
    return undefined;
  }

  return resolveClaudeRunModelFromProvider(
    slot,
    getClaudeAvailableCli(availableClis)?.provider,
  );
}

export function getClaudeModelOptions(
  availableClis?: readonly CliRuntimeAvailableCli[],
): Array<CliRuntimeModelOption> {
  const provider = getClaudeAvailableCli(availableClis)?.provider;

  return CLAUDE_CODE_SELECTABLE_MODEL_SLOTS.map((slot) => {
    const providerModel = getProviderAwareClaudeModel(slot, provider);
    return {
      value: slot,
      label: providerModel.label,
      description: CLAUDE_CODE_MODEL_DESCRIPTIONS[slot],
      runModel: providerModel.runModel,
    };
  });
}

/**
 * Resolve a single slot to its option, covering retired slots that are no
 * longer selectable so stored drafts/messages keep rendering their labels.
 */
export function getClaudeModelOption(
  value: CliRuntimeModel | undefined,
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModelOption | undefined {
  const slot = normalizeClaudeCodeModel(value);
  if (!slot) {
    return undefined;
  }

  const provider = getClaudeAvailableCli(availableClis)?.provider;
  const providerModel = getProviderAwareClaudeModel(slot, provider);
  return {
    value: slot,
    label: providerModel.label,
    description: CLAUDE_CODE_MODEL_DESCRIPTIONS[slot],
    runModel: providerModel.runModel,
  };
}
