import type { ExtractedCostUsage } from "@/convex/lib/contracts/costUsage";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

/**
 * Extract the run's spend from OpenCode `step-finish` parts (OS-1132). Each part
 * carries its step's incremental tokens and USD; OpenCode re-emits cumulative
 * snapshots, so entries dedupe by part id (last wins) before summing. No per-model
 * usage, so the caller's stored model attributes the total.
 */
export function extractOpencodeCostUsage(
  chunks: readonly RawCliChunk[],
  cliModel: string | undefined
): ExtractedCostUsage | null {
  const stepsById = new Map<string, Record<string, unknown>>();
  let unidentifiedIndex = 0;

  for (const chunk of chunks) {
    if (chunk.type !== "message.part.updated") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk.data);
    } catch {
      continue;
    }
    const properties = isRecord(parsed) && isRecord(parsed.properties) ? parsed.properties : null;
    const part = properties && isRecord(properties.part) ? properties.part : null;
    if (!part || part.type !== "step-finish") {
      continue;
    }
    const id = typeof part.id === "string" ? part.id : `no-id-${unidentifiedIndex++}`;
    stepsById.set(id, part);
  }

  const byModel = [...stepsById.values()]
    .map((part) => {
      const tokens = isRecord(part.tokens) ? part.tokens : {};
      const inputTokens = getFiniteNumber(tokens.input);
      const outputTokens = getFiniteNumber(tokens.output);
      const cache = isRecord(tokens.cache) ? tokens.cache : {};
      const cacheReadTokens = getFiniteNumber(cache.read);
      const cacheWriteTokens = getFiniteNumber(cache.write);
      const cost = getFiniteNumber(part.cost);
      const reportedCost = cost !== undefined && cost >= 0;
      return {
        model: cliModel ?? "unknown",
        inputTokens: inputTokens ?? 0,
        cachedInputTokens: (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens: (outputTokens ?? 0) + (getFiniteNumber(tokens.reasoning) ?? 0),
        quantitiesIncomplete: inputTokens === undefined || outputTokens === undefined,
        costUsd: reportedCost ? cost : 0,
        reportedCost,
      };
    })
    .filter(
      (entry) =>
        entry.reportedCost || entry.inputTokens + entry.cachedInputTokens + entry.outputTokens > 0
    );
  if (byModel.length === 0) return null;
  return {
    costUsd: byModel.reduce((sum, entry) => sum + entry.costUsd, 0),
    reportedCost: byModel.every((entry) => entry.reportedCost),
    byModel,
  };
}
