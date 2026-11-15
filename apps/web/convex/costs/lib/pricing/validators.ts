import { v, type Infer } from "convex/values";

export const pricingRatesValidator = v.object({
  input: v.optional(v.number()),
  cacheRead: v.optional(v.number()),
  cacheWrite: v.optional(v.number()),
  output: v.optional(v.number()),
});
export type PricingRates = Infer<typeof pricingRatesValidator>;
export type TokenCategory = keyof PricingRates;

export const pricingCatalogValidator = v.object({
  snapshotVersion: v.string(),
  sourceUrl: v.string(),
  sourceRevision: v.string(),
  sourceSha256: v.string(),
  retrievedOn: v.string(),
  units: v.literal("USD/token"),
  tariffBasis: v.literal("standard-short-context-api-equivalent"),
  models: v.record(v.string(), pricingRatesValidator),
});
export type PricingCatalog = Infer<typeof pricingCatalogValidator>;

export const pricingQuantitiesValidator = pricingRatesValidator;
export type PricingQuantities = Infer<typeof pricingQuantitiesValidator>;

const sourceFields = {
  input: "input_cost_per_token",
  cacheRead: "cache_read_input_token_cost",
  cacheWrite: "cache_creation_input_token_cost",
  output: "output_cost_per_token",
} as const;

// Only base text-token rates enter the catalog; see docs/specs/cost-tracking.md.
export function toPricingRates(source: Record<string, unknown>): PricingRates {
  const rates: PricingRates = {};
  for (const category of Object.keys(sourceFields) as TokenCategory[]) {
    const field = sourceFields[category];
    if (!Object.hasOwn(source, field)) continue;
    const value = source[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid pricing rate: ${field}`);
    }
    rates[category] = value;
  }
  return rates;
}
