import type { CliRuntimeModel, CliRuntimeModelOption } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import type { CodexAvailableCli } from "./validators";

export const CODEX_MODEL_SLOTS = [
  "default",
  "gpt-6.2-astra",
  "gpt-6.2-sol",
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
] as const;

export type CodexModelSlot = (typeof CODEX_MODEL_SLOTS)[number];

// Retired models stay valid for stored selections.
const RETIRED_CODEX_MODEL_SLOTS: readonly CodexModelSlot[] = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
];
const CODEX_SELECTABLE_MODEL_SLOTS = CODEX_MODEL_SLOTS.filter(
  (slot) => !RETIRED_CODEX_MODEL_SLOTS.includes(slot),
);

type CodexResolvedModel = {
  label: string;
  description: string;
  runModel?: string;
};

const CODEX_MODEL_OPTIONS: Record<CodexModelSlot, CodexResolvedModel> = {
  default: {
    label: "Default",
    description: "Use the connected machine's configured Codex model",
  },
  "gpt-6.2-astra": {
    label: "GPT-6.2 Astra",
    description: "Latest flagship model",
    runModel: "gpt-6.2-astra",
  },
  "gpt-6.2-sol": {
    label: "GPT-6.2 Sol",
    description: "Latest workhorse model for coding and everyday work",
    runModel: "gpt-6.2-sol",
  },
  "gpt-6-astra": {
    label: "GPT-6 Astra",
    description: "Previous flagship model",
    runModel: "gpt-6-astra",
  },
  "gpt-6.1-sol": {
    label: "GPT-6.1 Sol",
    description: "Previous workhorse model",
    runModel: "gpt-6.1-sol",
  },
  "gpt-6-sol": {
    label: "GPT-6 Sol",
    description: "Previous workhorse model",
    runModel: "gpt-6-sol",
  },
  "gpt-6-luna": {
    label: "GPT-6 Luna",
    description: "Fast and affordable model for easier tasks",
    runModel: "gpt-6-luna",
  },
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol",
    description: "Previous flagship model",
    runModel: "gpt-5.6-sol",
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra",
    description: "Balanced flagship model",
    runModel: "gpt-5.6-terra",
  },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna",
    description: "Faster lightweight model",
    runModel: "gpt-5.6-luna",
  },
  "gpt-5.5": {
    label: "GPT-5.5",
    description: "Previous flagship model",
    runModel: "gpt-5.5",
  },
  "gpt-5.4": {
    label: "GPT-5.4",
    description: "Older flagship model",
    runModel: "gpt-5.4",
  },
  "gpt-5.4-mini": {
    label: "GPT-5.4 Mini",
    description: "Faster lightweight model",
    runModel: "gpt-5.4-mini",
  },
  "gpt-5.3-codex-spark": {
    label: "GPT-5.3 Codex Spark",
    description: "Ultra-fast coding model",
    runModel: "gpt-5.3-codex-spark",
  },
};

export function isCodexModelSlot(value: unknown): value is CodexModelSlot {
  return typeof value === "string" && (CODEX_MODEL_SLOTS as readonly string[]).includes(value);
}

export function normalizeCodexModel(cliModel: CliRuntimeModel | undefined): string | undefined {
  return isCodexModelSlot(cliModel) ? cliModel : undefined;
}

/**
 * AWS-hosted slots (OS-2105): Mantle takes model IDs, Bedrock Runtime takes
 * `global.` inference profiles. Saved slots stay the same across providers.
 */
const AWS_CODEX_MODEL_SLOTS = [
  "gpt-6.2-astra",
  "gpt-6.2-sol",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
] as const satisfies readonly CodexModelSlot[];
const AWS_RUN_MODEL_PREFIX = { mantle: "openai.", bedrock: "global.openai." } as const;

export function getCodexAvailableCli(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): CodexAvailableCli | undefined {
  return availableClis?.find((cli): cli is CodexAvailableCli => cli.type === "codex");
}

/** The assigned AWS provider; undefined for native (or unrecognized) Codex. */
export function getCodexAwsProvider(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): "mantle" | "bedrock" | undefined {
  const provider = getCodexAvailableCli(availableClis)?.provider;
  return provider === "mantle" || provider === "bedrock" ? provider : undefined;
}

export function isAwsCodexModelSlot(value: unknown): boolean {
  return (AWS_CODEX_MODEL_SLOTS as readonly unknown[]).includes(value);
}

function toOption(
  slot: CodexModelSlot,
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): CliRuntimeModelOption {
  const provider = getCodexAwsProvider(availableClis);
  const option = CODEX_MODEL_OPTIONS[slot];
  return {
    value: slot,
    label: option.label,
    description: option.description,
    // Unsupported slots stay readable on AWS but never resolve to a run model.
    runModel: !provider
      ? option.runModel
      : isAwsCodexModelSlot(slot)
        ? `${AWS_RUN_MODEL_PREFIX[provider]}${slot}`
        : undefined,
  };
}

export function getCodexModelOptions(
  availableClis?: readonly CliRuntimeAvailableCli[],
): Array<CliRuntimeModelOption> {
  const slots = getCodexAwsProvider(availableClis) ? AWS_CODEX_MODEL_SLOTS : CODEX_SELECTABLE_MODEL_SLOTS;
  return slots.map((slot) => toOption(slot, availableClis));
}

export function getCodexModelOption(
  value: CliRuntimeModel | undefined,
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModelOption | undefined {
  return isCodexModelSlot(value) ? toOption(value, availableClis) : undefined;
}

export function resolveCodexRunModel(
  cliModel: CliRuntimeModel | undefined,
  availableClis?: readonly CliRuntimeAvailableCli[],
): string | undefined {
  return getCodexModelOption(cliModel, availableClis)?.runModel;
}
