import snapshot from "./catalog.json";
import type { PricingCatalog, PricingQuantities, TokenCategory } from "./validators";

export const pricingCatalog = snapshot as PricingCatalog;

// Reviewed spellings only. Bedrock geo and Mantle IDs are catalog rows with AWS rates.
export const modelAliases: Readonly<Record<string, string>> = {
  "openai/gpt-6.2-astra": "gpt-6.2-astra",
  "openai/gpt-6.2-sol": "gpt-6.2-sol",
  "openai/gpt-6-astra": "gpt-6-astra",
  "openai/gpt-6.1-sol": "gpt-6.1-sol",
  "openai/gpt-6-sol": "gpt-6-sol",
  "openai/gpt-6-luna": "gpt-6-luna",
  "openai/gpt-5.3-codex": "gpt-5.3-codex",
  // Codex on Mantle reports bare model IDs (OS-2105); LiteLLM keys Mantle rates by provider.
  "openai.gpt-6.2-astra": "bedrock_mantle/openai.gpt-6.2-astra",
  "openai.gpt-6.2-sol": "bedrock_mantle/openai.gpt-6.2-sol",
  "openai.gpt-6-astra": "bedrock_mantle/openai.gpt-6-astra",
  "openai.gpt-6-sol": "bedrock_mantle/openai.gpt-6-sol",
  "openai.gpt-6-luna": "bedrock_mantle/openai.gpt-6-luna",
  "openai.gpt-5.6-sol": "bedrock_mantle/openai.gpt-5.6-sol",
  "openai.gpt-5.6-terra": "bedrock_mantle/openai.gpt-5.6-terra",
  "openai.gpt-5.6-luna": "bedrock_mantle/openai.gpt-5.6-luna",
  "anthropic/claude-fable-5-2": "claude-fable-5-2",
  "anthropic.claude-fable-5-2": "claude-fable-5-2",
  "anthropic/claude-opus-5-5": "claude-opus-5-5",
  "anthropic.claude-opus-5-5": "claude-opus-5-5",
  "anthropic/claude-sonnet-5-5": "claude-sonnet-5-5",
  "anthropic.claude-sonnet-5-5": "claude-sonnet-5-5",
  "anthropic/claude-haiku-5-5": "claude-haiku-5-5",
  "anthropic.claude-haiku-5-5": "claude-haiku-5-5",
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
  "anthropic.claude-sonnet-5": "claude-sonnet-5",
  "anthropic/claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
  "anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4-5-20250929",
  "vertex_ai/claude-sonnet-4-5@20250929": "claude-sonnet-4-5-20250929",
  // Antigravity reports bare Gemini IDs (OS-2481); the catalog keeps the direct Gemini API rows.
  "gemini-4-neon": "gemini/gemini-4-neon",
  "gemini-4-argon": "gemini/gemini-4-argon",
  "gemini-4-hydrogen": "gemini/gemini-4-hydrogen",
  "gemini-3.8-flash": "gemini/gemini-3.8-flash",
};

export function resolveModelPricing(model: string, catalog: PricingCatalog = pricingCatalog) {
  const modelKey = Object.hasOwn(catalog.models, model) ? model : Object.hasOwn(modelAliases, model) ? modelAliases[model] : undefined;
  if (!modelKey || !Object.hasOwn(catalog.models, modelKey)) {
    return { status: "unpriced", reason: "unknown-model", model } as const;
  }
  return {
    status: "resolved" as const,
    modelKey,
    match: modelKey === model ? ("exact" as const) : ("alias" as const),
    rates: catalog.models[modelKey],
    snapshotVersion: catalog.snapshotVersion,
    tariffBasis: catalog.tariffBasis,
  };
}

export function estimateTokenCost(model: string, quantities: PricingQuantities, catalog: PricingCatalog = pricingCatalog) {
  const resolved = resolveModelPricing(model, catalog);
  if (resolved.status === "unpriced") return resolved;
  const categories: TokenCategory[] = ["input", "cacheRead", "cacheWrite", "output"];
  const missingQuantities: TokenCategory[] = [];
  const missingRates: TokenCategory[] = [];
  const fallbackCategories: TokenCategory[] = [];
  const categoryCosts: Partial<Record<TokenCategory, number>> = {};
  for (const category of categories) {
    const quantity = quantities[category];
    if (quantity === undefined) {
      missingQuantities.push(category);
      continue;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      return { ...resolved, status: "unpriced", reason: "invalid-quantity", category } as const;
    }
    // An explicit zero quantity costs zero even if its rate is unavailable.
    if (quantity === 0) {
      categoryCosts[category] = 0;
      continue;
    }
    let rate = resolved.rates[category];
    if (rate === undefined && (category === "cacheRead" || category === "cacheWrite")) {
      rate = resolved.rates.input;
      if (rate !== undefined) fallbackCategories.push(category);
    }
    if (rate === undefined) {
      missingRates.push(category);
      continue;
    }
    if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(quantity * rate)) {
      return { ...resolved, status: "unpriced", reason: "invalid-rate", category } as const;
    }
    categoryCosts[category] = quantity * rate;
  }
  const provenance = { ...resolved, categoryCosts, fallbackCategories };
  if (missingQuantities.length || missingRates.length) {
    return { ...provenance, status: "unpriced", reason: "incomplete-usage", missingQuantities, missingRates } as const;
  }
  const costUsd = Object.values(categoryCosts).reduce((sum, cost) => sum + cost, 0);
  if (!Number.isFinite(costUsd)) {
    return { ...provenance, status: "unpriced", reason: "invalid-total" } as const;
  }
  return { ...provenance, status: "priced", costUsd } as const;
}
