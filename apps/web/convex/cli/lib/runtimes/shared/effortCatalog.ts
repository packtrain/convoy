import type { CliRuntimeEffortOption } from "../contracts";

/**
 * Reasoning-effort catalog shared by runtimes. Slots are stored verbatim
 * (provider-agnostic at the schema boundary); "default" means "use the
 * connected machine's configured effort" and never resolves to a run value.
 */
export type CliRuntimeEffortCatalog = {
  isSupportedEffort: (value: unknown) => value is string;
  getDefaultEffort: () => string;
  getEffortOptions: () => Array<CliRuntimeEffortOption>;
  normalizeStoredEffort: (value: string | undefined) => string | undefined;
  resolveRunEffort: (value: string | undefined) => string | undefined;
};

export function createEffortCatalog(
  options: ReadonlyArray<CliRuntimeEffortOption>,
): CliRuntimeEffortCatalog {
  const values = new Set(options.map((option) => option.value));
  const isSupportedEffort = (value: unknown): value is string =>
    typeof value === "string" && values.has(value);

  return {
    isSupportedEffort,
    getDefaultEffort: () => "default",
    getEffortOptions: () => [...options],
    normalizeStoredEffort: (value) =>
      isSupportedEffort(value) ? value : undefined,
    resolveRunEffort: (value) =>
      isSupportedEffort(value) && value !== "default" ? value : undefined,
  };
}
