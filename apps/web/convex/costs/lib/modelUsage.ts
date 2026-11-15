import type { CostModelUsage, CostMetadata, CostTotal, ResolvedCostTotal } from "./validators";

/** Merge per-model usage entries, summing token counts and cost by model id. */
export function mergeModelUsage(
  base: readonly CostModelUsage[],
  additions: readonly CostModelUsage[]
): CostModelUsage[] {
  const merged = new Map<string, CostModelUsage>();
  for (const entry of [...base, ...additions]) {
    const existing = merged.get(entry.model);
    if (!existing) {
      merged.set(entry.model, { ...entry, costMetadata: metadataOrLegacy(entry.costMetadata) });
      continue;
    }
    existing.costMetadata = mergeCostMetadata(existing.costMetadata, entry.costMetadata);
    existing.inputTokens += entry.inputTokens;
    existing.cachedInputTokens += entry.cachedInputTokens;
    existing.cacheReadTokens = sumOptional(existing.cacheReadTokens, entry.cacheReadTokens);
    existing.cacheWriteTokens = sumOptional(existing.cacheWriteTokens, entry.cacheWriteTokens);
    existing.outputTokens += entry.outputTokens;
    existing.costUsd += entry.costUsd;
  }
  return [...merged.values()];
}

/** Sum that stays absent unless both sides reported the split. */
function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a + b;
}

export function emptyCostMetadata(): CostMetadata {
  return {
    hasReported: false,
    hasEstimated: false,
    hasUnpriced: false,
    hasLegacy: false,
    modelAllocationIncomplete: false,
  };
}

export function metadataOrLegacy(metadata?: CostMetadata): CostMetadata {
  return metadata ?? { ...emptyCostMetadata(), hasLegacy: true, modelAllocationIncomplete: true };
}

function mergeVersion(a?: string, b?: string): string | undefined {
  return a === undefined ? b : b === undefined || a === b ? a : "mixed";
}

/** Source and coverage merge independently; absent metadata means legacy evidence. */
export function mergeCostMetadata(a?: CostMetadata, b?: CostMetadata): CostMetadata {
  const left = metadataOrLegacy(a);
  const right = metadataOrLegacy(b);
  return {
    hasReported: left.hasReported || right.hasReported,
    hasEstimated: left.hasEstimated || right.hasEstimated,
    hasUnpriced: left.hasUnpriced || right.hasUnpriced,
    hasLegacy: left.hasLegacy || right.hasLegacy,
    modelAllocationIncomplete: left.modelAllocationIncomplete || right.modelAllocationIncomplete,
    ...(left.hasDataGap || right.hasDataGap ? { hasDataGap: true } : {}),
    pricingSnapshot: mergeVersion(left.pricingSnapshot, right.pricingSnapshot),
    tariffBasis: mergeVersion(left.tariffBasis, right.tariffBasis),
  };
}

export function addCost(base: CostTotal | undefined, addition: CostTotal): ResolvedCostTotal {
  return {
    costUsd: (base?.costUsd ?? 0) + addition.costUsd,
    costMetadata: mergeCostMetadata(
      base ? base.costMetadata : emptyCostMetadata(),
      addition.costMetadata
    ),
  };
}
