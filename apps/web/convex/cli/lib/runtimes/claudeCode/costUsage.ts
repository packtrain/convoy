import type { ExtractedCostModelUsage, ExtractedCostUsage } from "@/convex/lib/contracts/costUsage";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import { pricingCatalog } from "@/convex/costs/lib/pricing/resolution";
import type { RawCliChunk } from "../contracts";

/**
 * Extract the run's spend from Claude Code `result` chunks (OS-1132).
 *
 * `total_cost_usd` is cumulative per process and each run forks a fresh one, so
 * the LAST result chunk covers exactly this run — earlier ones are superseded,
 * not summed.
 */
export function extractClaudeCostUsage(chunks: readonly RawCliChunk[]): ExtractedCostUsage | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk.type !== "result") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk.data);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) {
      return null;
    }
    const result = parsed;

    const cost = getFiniteNumber(result.total_cost_usd);
    const reportedCost = cost !== undefined && cost >= 0;
    const costUsd = reportedCost ? cost : 0;
    const byModel = extractByModel(result, costUsd, reportedCost);
    if (!reportedCost && byModel.length === 0) {
      return null;
    }
    // A repriced entry no longer sums to the reported total, so the total becomes the model sum.
    const repriced = isRecord(result.modelUsage) && Object.entries(result.modelUsage)
      .some(([model, usage]) => isRecord(usage) && awsPricingKey(model, usage) !== undefined);
    return { costUsd, reportedCost: reportedCost && !repriced, byModel };
  }
  return null;
}

function extractByModel(
  result: Record<string, unknown>,
  totalCostUsd: number,
  reportedCost: boolean
): ExtractedCostModelUsage[] {
  // Preferred: per-model breakdown with tokens and USD per model.
  if (isRecord(result.modelUsage)) {
    const entries: ExtractedCostModelUsage[] = [];
    for (const [model, value] of Object.entries(result.modelUsage)) {
      if (!isRecord(value)) {
        continue;
      }
      const usage = value;
      const inputTokens = getFiniteNumber(usage.inputTokens);
      const outputTokens = getFiniteNumber(usage.outputTokens);
      const cost = getFiniteNumber(usage.costUSD);
      const hasCost = cost !== undefined && cost >= 0;
      const cacheReadTokens = getFiniteNumber(usage.cacheReadInputTokens);
      const cacheWriteTokens = getFiniteNumber(usage.cacheCreationInputTokens);
      const awsModel = awsPricingKey(model, usage);
      entries.push({
        model: awsModel ?? model,
        inputTokens: inputTokens ?? 0,
        cachedInputTokens: (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens: outputTokens ?? 0,
        costUsd: hasCost && !awsModel ? cost : 0,
        reportedCost: hasCost && !awsModel,
        quantitiesIncomplete: inputTokens === undefined || outputTokens === undefined,
      });
    }
    if (entries.length > 0) {
      return entries;
    }
  }

  // Fallback: aggregate usage without model attribution.
  if (!isRecord(result.usage)) {
    return [];
  }
  const usage = result.usage;
  const inputTokens = getFiniteNumber(usage.input_tokens);
  const cacheReadTokens = getFiniteNumber(usage.cache_read_input_tokens);
  const cacheWriteTokens = getFiniteNumber(usage.cache_creation_input_tokens);
  const cachedInputTokens = (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  const outputTokens = getFiniteNumber(usage.output_tokens);
  if ((inputTokens ?? 0) + cachedInputTokens + (outputTokens ?? 0) <= 0) {
    return [];
  }
  return [
    {
      model: "unknown",
      inputTokens: inputTokens ?? 0,
      cachedInputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens: outputTokens ?? 0,
      costUsd: totalCostUsd,
      reportedCost,
      quantitiesIncomplete: inputTokens === undefined || outputTokens === undefined,
    },
  ];
}

/**
 * Catalog key for usage Claude Code priced at list rates on Bedrock or Mantle, which
 * miss the AWS geo/Mantle uplift. Managed (org-set) prices and unpriced IDs stay as reported.
 */
function awsPricingKey(model: string, usage: Record<string, unknown>): string | undefined {
  if (usage.costBasis !== "list") return undefined;
  const key = usage.provider === "bedrock" ? model : usage.provider === "mantle" ? `bedrock_mantle/${model}` : undefined;
  return key !== undefined && Object.hasOwn(pricingCatalog.models, key) ? key : undefined;
}
