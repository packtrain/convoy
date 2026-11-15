import { v, type Infer } from "convex/values";
import type { CodexModelState, ExtractedCostUsage } from "./validators";

// Pure contracts shared by runtime extraction, schema, and the cost recorder.
export {
  costModelUsageValidator,
  type CostModelUsage,
  type ExtractedCostModelUsage,
  type ExtractedCostUsage,
} from "./validators";

// Last cumulative Codex snapshot for either transport, persisted through cliThreadsRepo.
export const codexUsageCursorValidator = v.object({
  continuationId: v.optional(v.string()),
  inputTokens: v.number(),
  cachedInputTokens: v.number(),
  cacheWriteInputTokens: v.optional(v.number()),
  outputTokens: v.number(),
});

export type CodexUsageCursor = Infer<typeof codexUsageCursorValidator>;

// Empty byModel advances the cursor without recording spend or counting a run.
export type CostUsageExtraction = {
  usage: ExtractedCostUsage;
  nextUsageCursor?: CodexUsageCursor;
  nextModelState?: CodexModelState;
};
