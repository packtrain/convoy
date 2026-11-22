import type { ExtractedCostUsage } from "@/convex/lib/contracts/costUsage";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

/**
 * The run's tokens from `convoy/acp_prompt_result`, sent once per run, under the effective
 * model the CLI read from agy. No cost is reported. Spec: docs/specs/cli-antigravity-runtime.md#usage.
 */
export function extractAntigravityCostUsage(chunks: readonly RawCliChunk[]): ExtractedCostUsage | null {
  const chunk = chunks.findLast((candidate) => candidate.type === "convoy/acp_prompt_result");
  if (!chunk) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(chunk.data);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.usage)) return null;
  const usage = parsed.usage;
  const inputTokens = getFiniteNumber(usage.inputTokens);
  // Includes thoughtTokens; verified against totalTokens on agy 1.5.14.
  const outputTokens = getFiniteNumber(usage.outputTokens);
  const cacheReadTokens = getFiniteNumber(usage.cachedReadTokens);
  const cacheWriteTokens = getFiniteNumber(usage.cachedWriteTokens);
  const entry = {
    model: typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : "unknown",
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: outputTokens ?? 0,
    quantitiesIncomplete: inputTokens === undefined || outputTokens === undefined,
    costUsd: 0,
    reportedCost: false,
  };
  if (entry.inputTokens + entry.cachedInputTokens + entry.outputTokens <= 0) return null;
  return { costUsd: 0, reportedCost: false, byModel: [entry] };
}
