import { expect, test } from "vitest";
import { mergeModelUsage, mergeCostMetadata, emptyCostMetadata } from "./modelUsage";

test("unknown cache splits remain unknown in either merge order", () => {
  const known = { model: "m", inputTokens: 1, cachedInputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 1, outputTokens: 1, costUsd: 0 };
  const unknown = { model: "m", inputTokens: 1, cachedInputTokens: 4, outputTokens: 1, costUsd: 0 };
  for (const entries of [
    [known, unknown],
    [unknown, known],
  ]) {
    const [merged] = mergeModelUsage([], entries);
    expect(merged?.cacheReadTokens).toBeUndefined();
    expect(merged?.cacheWriteTokens).toBeUndefined();
    expect(merged?.cachedInputTokens).toBe(8);
  }
});

test("history gaps survive merging with known amounts in either order", () => {
  const gap = { ...emptyCostMetadata(), hasDataGap: true };
  const reported = { ...emptyCostMetadata(), hasReported: true };
  expect(mergeCostMetadata(gap, reported)).toMatchObject({ hasDataGap: true, hasReported: true });
  expect(mergeCostMetadata(reported, gap)).toMatchObject({ hasDataGap: true, hasReported: true });
});
