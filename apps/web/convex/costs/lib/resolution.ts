import { estimateTokenCost } from "./pricing/resolution";
import {
  emptyCostMetadata,
  mergeCostMetadata,
  mergeModelUsage,
  metadataOrLegacy,
} from "./modelUsage";
import {
  toCostModelUsage,
  type ExtractedCostUsage,
  type CostModelUsage,
  type CostUsage,
} from "./validators";

/** Resolve one event before aggregation. Legacy events retain their original numbers. */
export function resolveCostUsage(
  usage: ExtractedCostUsage,
  estimate = estimateTokenCost
): CostUsage {
  if (usage.reportedCost === undefined) {
    return {
      costUsd: usage.costUsd,
      costMetadata: metadataOrLegacy(),
      byModel: mergeModelUsage([], usage.byModel.map((entry) => ({
        ...toCostModelUsage(entry),
        costMetadata: metadataOrLegacy(),
      }))),
    };
  }
  const authoritative = usage.reportedCost;
  const byModel = usage.byModel.map((entry): CostModelUsage => {
    const { reportedCost, quantitiesIncomplete } = entry;
    const tokens = toCostModelUsage(entry);
    const metadata = {
      ...emptyCostMetadata(),
      modelAllocationIncomplete: entry.model === "unknown",
    };
    if (reportedCost === true) {
      return { ...tokens, costMetadata: { ...metadata, hasReported: true } };
    }
    if (reportedCost === undefined) {
      return { ...tokens, costMetadata: metadataOrLegacy() };
    }
    if (!authoritative && !quantitiesIncomplete) {
      try {
        const result = estimate(entry.model, {
          input: entry.inputTokens,
          cacheRead: entry.cacheReadTokens,
          cacheWrite: entry.cacheWriteTokens,
          output: entry.outputTokens,
        });
        if (result.status === "priced") {
          return {
            ...tokens,
            costUsd: result.costUsd,
            costMetadata: {
              ...metadata,
              hasEstimated: true,
              pricingSnapshot: result.snapshotVersion,
              tariffBasis: result.tariffBasis,
            },
          };
        }
      } catch {
        // Preserve tokens if the catalog cannot price this contribution.
      }
    }
    return { ...tokens, costUsd: 0, costMetadata: { ...metadata, hasUnpriced: true } };
  });
  const modelCostUsd = byModel.reduce((sum, entry) => sum + entry.costUsd, 0);
  const costMetadata = authoritative
    ? {
        ...emptyCostMetadata(),
        hasReported: true,
        modelAllocationIncomplete:
          byModel.length === 0 ||
          byModel.some(
            (entry) =>
              entry.costMetadata?.hasUnpriced ||
              entry.costMetadata?.hasLegacy ||
              entry.costMetadata?.modelAllocationIncomplete
          ) ||
          Math.abs(modelCostUsd - usage.costUsd) > 1e-9 * Math.max(1, Math.abs(usage.costUsd)),
      }
    : byModel.reduce(
        (metadata, entry) => mergeCostMetadata(metadata, entry.costMetadata),
        emptyCostMetadata()
      );
  return {
    costUsd: authoritative ? usage.costUsd : modelCostUsd,
    costMetadata,
    byModel: mergeModelUsage([], byModel),
  };
}
