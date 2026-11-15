import type { CliRuntimeEffortOption } from "../contracts";
import type { CliRuntimeEffortContext } from "../registry";
import { OPENCODE_DEFAULT_MODEL_SLOT } from "./contracts";
import { getOpencodeAvailableCli } from "./models";

/**
 * OpenCode "efforts" are model variants: per-model, advertised by the CLI in
 * `availableClis` and passed to `promptAsync({ variant })`. Options only
 * exist for a concretely selected advertised model; the default model slot
 * exposes none (the machine decides which model runs).
 */

const DEFAULT_EFFORT_OPTION: CliRuntimeEffortOption = {
  value: "default",
  label: "Default",
  description: "Use the model's default variant",
};

/**
 * The advertised variant keys for the selected model. `undefined` when the
 * model is unknown/not advertised (offline machine, stale slug); an empty
 * array when the model is advertised without variants.
 */
export function getOpencodeAdvertisedVariants(
  context: CliRuntimeEffortContext | undefined,
): string[] | undefined {
  const model = context?.cliModel;
  if (!model || model === OPENCODE_DEFAULT_MODEL_SLOT) {
    return undefined;
  }

  const advertised = getOpencodeAvailableCli(context?.availableClis)?.models?.find(
    (advertisedModel) => advertisedModel.slug === model,
  );
  if (!advertised) {
    return undefined;
  }
  return advertised.variants ?? [];
}

function toVariantLabel(variant: string): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

export function getOpencodeEffortOptions(
  context: CliRuntimeEffortContext | undefined,
): CliRuntimeEffortOption[] {
  const variants = getOpencodeAdvertisedVariants(context);
  if (!variants || variants.length === 0) {
    return [];
  }

  return [
    DEFAULT_EFFORT_OPTION,
    ...variants.map((variant) => ({
      value: variant,
      label: toVariantLabel(variant),
      description: `${toVariantLabel(variant)} variant of the selected model`,
    })),
  ];
}

/**
 * Variant values are dynamic per machine/model, so without a model context any single
 * token is accepted — storage normalization must let a per-machine variant
 * round-trip. With one, the rule matches `resolveOpencodeRunEffort`: an advertised
 * model accepts only its own variants, an unadvertised one passes through because
 * OpenCode is the authority.
 */
export function isOpencodeEffortSupported(
  value: unknown,
  context?: CliRuntimeEffortContext,
): value is string {
  if (typeof value !== "string" || !/^\S+$/.test(value)) {
    return false;
  }

  if (context?.cliModel === undefined) {
    return true;
  }

  if (getOpencodeAdvertisedVariants(context) === undefined) {
    return true;
  }

  return getOpencodeEffortOptions(context).some(
    (option) => option.value === value,
  );
}

export function normalizeOpencodeStoredEffort(
  value: string | undefined,
): string | undefined {
  return isOpencodeEffortSupported(value) ? value : undefined;
}

export function resolveOpencodeRunEffort(
  value: string | undefined,
  context: CliRuntimeEffortContext | undefined,
): string | undefined {
  if (!isOpencodeEffortSupported(value) || value === "default") {
    return undefined;
  }

  const variants = getOpencodeAdvertisedVariants(context);
  if (variants === undefined) {
    // Model not advertised (offline/stale): pass through — OpenCode is the
    // authority and reports clearly if the variant is gone.
    return value;
  }
  // Advertised model: a variant it does not offer never leaks into the run.
  return variants.includes(value) ? value : undefined;
}
