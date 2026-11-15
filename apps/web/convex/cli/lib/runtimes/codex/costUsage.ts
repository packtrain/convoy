import type { CodexModelState } from "@/convex/lib/contracts/validators";
import type {
  CodexUsageCursor,
  ExtractedCostModelUsage,
  CostUsageExtraction,
} from "@/convex/lib/contracts/costUsage";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

type TokenCounts = Omit<CodexUsageCursor, "continuationId">;

/** Cumulative Codex usage, including replayed notifications. Spec: docs/specs/cost-tracking.md. */
export function extractCodexCostUsage(
  chunks: readonly RawCliChunk[],
  context: {
    cliModel?: string;
    continuationId?: string;
    usageCursor?: CodexUsageCursor;
    modelState?: CodexModelState;
  }
): CostUsageExtraction | null {
  let cursor = context.usageCursor;
  let nextUsageCursor: CodexUsageCursor | undefined;
  const configuredModel = readModel(context.cliModel);
  let modelState: CodexModelState = context.modelState ?? {
    ...(configuredModel ? { model: configuredModel } : {}),
    source: configuredModel ? "configured" : "unknown",
  };
  let sawModelEvidence = false;
  const byModel: ExtractedCostModelUsage[] = [];

  for (const chunk of chunks) {
    if (!["thread/started", "turn/started", "model/rerouted", "turn.completed", "thread/tokenUsage/updated"].includes(chunk.type)) continue;
    const parsed = parseRecord(chunk.data);
    if (!parsed) continue;
    if (chunk.type === "thread/started") {
      const model = readModel(parsed.model);
      if (model && modelState.source !== "runtime") {
        modelState = { ...modelState, model, source: "startup" };
        sawModelEvidence = true;
      }
      continue;
    }
    if (chunk.type === "turn/started") {
      const turnId = isRecord(parsed.turn) && typeof parsed.turn.id === "string" ? parsed.turn.id : undefined;
      if (turnId) {
        modelState = { ...modelState, turnId };
        sawModelEvidence = true;
      }
      continue;
    }
    if (chunk.type === "model/rerouted") {
      if (context.continuationId && parsed.threadId && parsed.threadId !== context.continuationId) continue;
      if (modelState.turnId && parsed.turnId && parsed.turnId !== modelState.turnId) continue;
      const model = readModel(parsed.toModel);
      if (model) {
        modelState = {
          ...modelState, model, source: "runtime",
          pendingChange: model !== modelState.model || modelState.pendingChange === true,
        };
        sawModelEvidence = true;
      }
      continue;
    }
    const tokenUsage = isRecord(parsed.tokenUsage) ? parsed.tokenUsage : null;
    const usage = chunk.type === "turn.completed" ? parsed.usage : tokenUsage?.total;
    const snapshot = isRecord(usage) ? readTokenCounts(usage) : null;
    if (!snapshot) continue;

    const continuationId = context.continuationId ?? cursor?.continuationId;
    const delta = deCumulate(snapshot, cursor, continuationId);
    nextUsageCursor = {
      ...(continuationId !== undefined ? { continuationId } : {}),
      ...snapshot,
    };
    cursor = nextUsageCursor;
    if (chunk.type === "thread/tokenUsage/updated" && parsed.convoyUsageBaseline === true) continue;
    if (delta.inputTokens + delta.outputTokens === 0) continue;

    // A reroute has no token boundary. Keep its crossing interval unknown.
    const model = modelState.pendingChange ? "unknown" : modelState.model ?? "unknown";
    if (modelState.pendingChange) modelState = { ...modelState, pendingChange: false };
    const writes = delta.cacheWriteInputTokens ?? 0;
    byModel.push({
      model,
      inputTokens: Math.max(0, delta.inputTokens - delta.cachedInputTokens - writes),
      cachedInputTokens: delta.cachedInputTokens + writes,
      cacheReadTokens: delta.cachedInputTokens,
      ...(delta.cacheWriteInputTokens !== undefined
        ? { cacheWriteTokens: writes } : {}),
      outputTokens: delta.outputTokens,
      costUsd: 0,
      reportedCost: false,
    });
  }

  if (!nextUsageCursor && !sawModelEvidence) return null;
  return {
    usage: { costUsd: 0, reportedCost: false, byModel },
    ...(nextUsageCursor ? { nextUsageCursor } : {}),
    ...(JSON.stringify(modelState) !== JSON.stringify(context.modelState) ? { nextModelState: modelState } : {}),
  };
}

function readModel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value !== "default" && value !== "unknown"
    ? value : undefined;
}

// A falling cumulative counter starts a new baseline; it cannot identify an old per-turn protocol.
function deCumulate(
  snapshot: TokenCounts,
  cursor: CodexUsageCursor | undefined,
  continuationId: string | undefined
): TokenCounts {
  const stale = cursor?.continuationId !== undefined &&
    continuationId !== undefined && cursor.continuationId !== continuationId;
  if (!cursor || stale) return snapshot;

  const delta: TokenCounts = {
    inputTokens: snapshot.inputTokens - cursor.inputTokens,
    cachedInputTokens: snapshot.cachedInputTokens - cursor.cachedInputTokens,
    outputTokens: snapshot.outputTokens - cursor.outputTokens,
    ...(snapshot.cacheWriteInputTokens !== undefined && cursor.cacheWriteInputTokens !== undefined
      ? { cacheWriteInputTokens: snapshot.cacheWriteInputTokens - cursor.cacheWriteInputTokens }
      : {}),
  };
  return Object.values(delta).some((count) => count < 0) ? snapshot : delta;
}

function readTokenCounts(usage: Record<string, unknown>): TokenCounts | null {
  const inputTokens = getFiniteNumber(usage.input_tokens) ?? getFiniteNumber(usage.inputTokens);
  const cachedInputTokens =
    getFiniteNumber(usage.cached_input_tokens) ?? getFiniteNumber(usage.cachedInputTokens);
  const outputTokens = getFiniteNumber(usage.output_tokens) ?? getFiniteNumber(usage.outputTokens);
  const cacheWriteInputTokens =
    getFiniteNumber(usage.cache_write_input_tokens) ?? getFiniteNumber(usage.cacheWriteInputTokens);
  if (inputTokens === undefined || cachedInputTokens === undefined || outputTokens === undefined) return null;
  const counts = {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
  };
  return Object.values(counts).some((count) => count < 0) ? null : counts;
}

function parseRecord(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
