import type {
  CostMetadata,
  CostModelUsage,
  CostTotal,
  ResolvedCostTotal,
} from "@/convex/costs/lib/validators";
import {
  addCost,
  emptyCostMetadata,
  metadataOrLegacy,
} from "@/convex/costs/lib/modelUsage";

export type CostByModel = CostModelUsage;

export function sumCostTotals(rows: readonly CostTotal[]): ResolvedCostTotal {
  return rows.reduce<ResolvedCostTotal>((total, row) => addCost(total, row), {
    costUsd: 0,
    costMetadata: emptyCostMetadata(),
  });
}

/** Up to four decimals below $1 keep small follow-up costs visible. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 1) {
    const amount = value.toFixed(4);
    return `$${value < 0.01 ? amount : amount.replace(/0{1,2}$/, "")}`;
  }
  return `$${value.toFixed(2)}`;
}

export function totalModelTokens(entry: CostByModel): number {
  return entry.inputTokens + entry.cachedInputTokens + entry.outputTokens;
}

// Bedrock cross-region inference profiles prefix the vendor model id with a
// geo scope (e.g. "us.anthropic.claude-opus-4-8"). Trim it for display only —
// the raw model id stays the key for color/data mapping.
const MODEL_LABEL_PREFIX = /^(us|eu|apac|apne|apse|use|usw)\./;

/** Human-friendly model label: drops the cross-region inference prefix. */
export function formatModelLabel(model: string): string {
  return model.replace(MODEL_LABEL_PREFIX, "");
}

export type ModelTokenShare = CostByModel & {
  tokens: number;
  /** Share of all models' tokens, 0-100 (0 when there are no tokens). */
  shareOfTokens: number;
};

/** Per-model token totals with % share, largest first. */
export function modelTokenShares(
  byModel: readonly CostByModel[]
): ModelTokenShare[] {
  const grandTotal = byModel.reduce(
    (sum, entry) => sum + totalModelTokens(entry),
    0
  );
  return byModel
    .map((entry) => {
      const tokens = totalModelTokens(entry);
      return {
        ...entry,
        tokens,
        shareOfTokens: grandTotal > 0 ? (tokens / grandTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Stable model → categorical color-slot assignment (alphabetical by model
 * id, capped at the theme's 5 slots). Alphabetical keeps a model's color
 * stable across date-range changes; only a brand-new model can shift
 * assignments.
 */
export function assignModelColors(
  models: readonly string[]
): Map<string, string> {
  const sorted = [...new Set(models)].sort();
  return new Map(
    sorted.map((model, index) => [
      model,
      `var(--chart-${Math.min(index + 1, 5)})`,
    ])
  );
}

/** Shared cost wording: the label is the amount, the description names source and coverage. */
export function describeCost(cost: CostTotal) {
  const metadata = metadataOrLegacy(cost.costMetadata);
  const known =
    metadata.hasReported || metadata.hasEstimated || metadata.hasLegacy;
  const notes: string[] = [];
  if (metadata.hasEstimated) {
    notes.push(
      "Estimates use standard short-context API-equivalent token rates. They do not represent subscription charges or invoices and exclude provider adjustments and non-token fees."
    );
    if (metadata.pricingSnapshot)
      notes.push(`Pricing snapshot: ${metadata.pricingSnapshot}.`);
  }
  if (metadata.hasReported) {
    notes.push(
      "Reported by the runtime, not verified against a provider invoice. A reported zero does not establish free provider billing."
    );
  }
  if (metadata.hasUnpriced)
    notes.push(
      "Some usage is not priced. The amount includes only known costs."
    );
  if (metadata.hasLegacy)
    notes.push("Historical cost source and pricing coverage are unknown.");
  if (metadata.hasDataGap)
    notes.push(
      "Historical usage was excluded. Totals, tokens and run counts have a data gap."
    );
  if (metadata.modelAllocationIncomplete)
    notes.push(
      "Model breakdown is incomplete and may not add up to the total."
    );
  const label =
    !known &&
    (metadata.hasUnpriced || metadata.hasDataGap) &&
    cost.costUsd === 0
      ? "Not priced"
      : formatUsd(cost.costUsd);
  return { label, description: notes.join(" ") };
}

export function hasCostEvidence(metadata?: CostMetadata): boolean {
  return (
    !!metadata &&
    (metadata.hasReported ||
      metadata.hasEstimated ||
      metadata.hasUnpriced ||
      metadata.hasLegacy ||
      !!metadata.hasDataGap)
  );
}

export function canCompareCosts(
  current?: CostMetadata,
  previous?: CostMetadata
): boolean {
  const complete = (metadata?: CostMetadata) =>
    !!metadata &&
    !metadata.hasUnpriced &&
    !metadata.hasLegacy &&
    !metadata.hasDataGap;
  return complete(current) && complete(previous);
}
