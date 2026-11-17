import type { CliRuntimeEffortContext } from "../registry";
import { createEffortCatalog } from "../shared/effortCatalog";
import { getCodexAwsProvider, isAwsCodexModelSlot } from "./models";

/** Older Codex models keep their existing low..xhigh catalog. */
const baseEffortCatalog = createEffortCatalog([
  {
    value: "default",
    label: "Default",
    description: "Use the machine's configured Codex effort",
  },
  { value: "low", label: "Low", description: "Light reasoning" },
  { value: "medium", label: "Medium", description: "Balanced reasoning" },
  { value: "high", label: "High", description: "Deep reasoning" },
  {
    value: "xhigh",
    label: "Extra high",
    description: "Very deep reasoning",
  },
]);

const maxEffortCatalog = createEffortCatalog([
  ...baseEffortCatalog.getEffortOptions(),
  { value: "max", label: "Max", description: "Maximum reasoning depth" },
]);

const ultraEffortCatalog = createEffortCatalog([
  ...maxEffortCatalog.getEffortOptions(),
  {
    value: "ultra",
    label: "Ultra",
    description: "Maximum reasoning with automatic task delegation",
  },
]);

/** GPT-6 efforts per Codex's model catalog. See docs/specs/cli-codex-runtime.md. */
function catalogForModel(context?: CliRuntimeEffortContext) {
  // Codex's Bedrock catalog stops at `max` for every AWS slot (OS-2105).
  if (getCodexAwsProvider(context?.availableClis)) {
    return isAwsCodexModelSlot(context?.cliModel) ? maxEffortCatalog : baseEffortCatalog;
  }
  switch (context?.cliModel) {
    case "gpt-6.2-astra":
    case "gpt-6.2-sol":
    case "gpt-6-astra":
    case "gpt-6.1-sol":
    case "gpt-6-sol":
      return ultraEffortCatalog;
    case "gpt-6-luna":
      return maxEffortCatalog;
    default:
      return baseEffortCatalog;
  }
}

function isSupportedEffort(
  value: unknown,
  context?: CliRuntimeEffortContext,
): value is string {
  // Model-less storage must retain GPT-6 efforts. Run resolution needs a model.
  const catalog = context?.cliModel === undefined
    ? ultraEffortCatalog
    : catalogForModel(context);
  return catalog.isSupportedEffort(value);
}

export const codexEffortCatalog = {
  getDefaultEffort: baseEffortCatalog.getDefaultEffort,
  isSupportedEffort,
  getEffortOptions: (context?: CliRuntimeEffortContext) =>
    catalogForModel(context).getEffortOptions(),
  normalizeStoredEffort: (value: string | undefined, context?: CliRuntimeEffortContext) =>
    isSupportedEffort(value, context) ? value : undefined,
  resolveRunEffort: (value: string | undefined, context?: CliRuntimeEffortContext) =>
    catalogForModel(context).resolveRunEffort(value),
};
