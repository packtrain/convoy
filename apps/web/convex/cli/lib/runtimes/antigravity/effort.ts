import type { CliRuntimeEffortOption } from "../contracts";
import type { CliRuntimeEffortContext } from "../registry";
import { ANTIGRAVITY_DEFAULT_MODEL_SLOT, getAntigravityAvailableCli } from "./models";

/**
 * Thinking levels are per model, advertised by the CLI as the model's `variants` and
 * set through agy's `thought_level` config option. Rules mirror OpenCode's variants
 * (docs/specs/cli-thread-effort-selection.md#dynamic-catalogs).
 */

const DEFAULT_EFFORT_OPTION: CliRuntimeEffortOption = {
  value: "default",
  label: "Default",
  description: "Use the model's default thinking level",
};

const LEVEL_LABELS: Record<string, string> = { xhigh: "Extra high" };

/** The selected model's levels; undefined when the model is the default slot or not advertised. */
function getAdvertisedLevels(context: CliRuntimeEffortContext | undefined): string[] | undefined {
  const model = context?.cliModel;
  if (!model || model === ANTIGRAVITY_DEFAULT_MODEL_SLOT) return undefined;
  const advertised = getAntigravityAvailableCli(context?.availableClis)?.models?.find((entry) => entry.slug === model);
  return advertised ? (advertised.variants ?? []) : undefined;
}

export function getAntigravityEffortOptions(context?: CliRuntimeEffortContext): CliRuntimeEffortOption[] {
  const levels = getAdvertisedLevels(context);
  if (!levels || levels.length === 0) return [];
  return [
    DEFAULT_EFFORT_OPTION,
    ...levels.map((level) => {
      const label = LEVEL_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
      return { value: level, label, description: `${label} thinking` };
    }),
  ];
}

/** Lenient without a model or for an unadvertised one; an advertised model accepts only its levels. */
export function isAntigravityEffortSupported(value: unknown, context?: CliRuntimeEffortContext): value is string {
  if (typeof value !== "string" || !/^\S+$/.test(value)) return false;
  const levels = getAdvertisedLevels(context);
  if (levels === undefined) return true;
  return levels.length > 0 && (value === "default" || levels.includes(value));
}

export function normalizeAntigravityStoredEffort(value: string | undefined): string | undefined {
  return isAntigravityEffortSupported(value) ? value : undefined;
}

/** An unadvertised model passes the level through; the runner sets it only when agy offers it. */
export function resolveAntigravityRunEffort(
  value: string | undefined,
  context?: CliRuntimeEffortContext,
): string | undefined {
  if (!isAntigravityEffortSupported(value) || value === "default") return undefined;
  const levels = getAdvertisedLevels(context);
  return levels === undefined || levels.includes(value) ? value : undefined;
}
