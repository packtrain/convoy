import { describe, expect, test } from "vitest";
import { resolveCostUsage } from "./resolution";
import { emptyCostMetadata, mergeCostMetadata, mergeModelUsage } from "./modelUsage";
import { estimateTokenCost } from "./pricing/resolution";
import type { ExtractedCostModelUsage } from "./validators";

const model: ExtractedCostModelUsage = {
  model: "gpt-5.5",
  inputTokens: 100,
  cachedInputTokens: 30,
  cacheReadTokens: 20,
  cacheWriteTokens: 10,
  outputTokens: 50,
  costUsd: 0,
  reportedCost: false,
};
const estimate = estimateTokenCost(model.model, { input: 100, cacheRead: 20, cacheWrite: 10, output: 50 });
if (estimate.status !== "priced") throw new Error("Fixture model must have prices");
const expectedCost = estimate.costUsd;

describe("resolveCostUsage", () => {
  test.each([0, 10])("preserves reported %s even with missing model allocation", (costUsd) => {
    for (const byModel of [[], [model], [{ ...model, costUsd: 0, reportedCost: true }]]) {
      const result = resolveCostUsage({ costUsd, reportedCost: true, byModel });
      expect(result.costUsd).toBe(costUsd);
      expect(result.costMetadata).toMatchObject({ hasReported: true, hasEstimated: false, hasUnpriced: false });
      expect(result.byModel.every((entry) => !entry.costMetadata?.hasEstimated)).toBe(true);
      if (!byModel.length || byModel[0]?.reportedCost === false || costUsd !== 0) {
        expect(result.costMetadata?.modelAllocationIncomplete).toBe(true);
      }
    }
  });

  test("estimates only missing cost, with pinned provenance", () => {
    const result = resolveCostUsage({ costUsd: 0, reportedCost: false, byModel: [model] });
    expect(result.costUsd).toBe(expectedCost);
    expect(result.costMetadata).toMatchObject({
      hasEstimated: true,
      hasUnpriced: false,
      pricingSnapshot: estimate.snapshotVersion,
      tariffBasis: estimate.tariffBasis,
    });
    expect(result.byModel[0]?.costUsd).toBe(expectedCost);
  });

  test.each([
    { ...model, model: "unknown" },
    { ...model, cacheWriteTokens: undefined },
    { ...model, cacheReadTokens: undefined },
    { ...model, quantitiesIncomplete: true },
  ])("retains unpriced tokens for incomplete evidence: %j", (entry) => {
    const result = resolveCostUsage({ costUsd: 0, reportedCost: false, byModel: [entry] });
    expect(result.costUsd).toBe(0);
    expect(result.costMetadata).toMatchObject({ hasUnpriced: true, hasEstimated: false, hasReported: false });
    expect(result.byModel[0]?.inputTokens).toBe(100);
  });

  test("resolver failure retains unpriced usage", () => {
    const usage = { costUsd: 0, reportedCost: false, byModel: [model] };
    const failed = resolveCostUsage(usage, () => {
      throw new Error("catalog unavailable");
    });
    expect(failed.costMetadata?.hasUnpriced).toBe(true);
    expect(failed.byModel[0]?.inputTokens).toBe(100);
  });

  test.each([0, 10])("legacy event %s retains numbers and unknown provenance", (costUsd) => {
    const result = resolveCostUsage({ costUsd, byModel: [{ ...model, reportedCost: undefined, costUsd }] });
    expect(result.costUsd).toBe(costUsd);
    expect(result.costMetadata?.hasLegacy).toBe(true);
    expect(result.byModel[0]?.costUsd).toBe(costUsd);
    expect(result.byModel[0]?.costMetadata?.hasEstimated).toBe(false);
  });

  test("mixed model contributions sum known costs without losing unpriced usage", () => {
    const result = resolveCostUsage(
      { costUsd: 10, reportedCost: false, byModel: [{ ...model, reportedCost: true, costUsd: 10 }, model, { ...model, model: "unknown" }] }
    );
    expect(result.costUsd).toBeCloseTo(10 + expectedCost);
    expect(result.costMetadata).toMatchObject({ hasReported: true, hasEstimated: true, hasUnpriced: true, hasLegacy: false });
    expect(result.byModel[0]?.inputTokens).toBe(200);
  });
});

test("metadata merges are associative, commutative, and preserve mixed snapshots", () => {
  const contributions = [
    { ...emptyCostMetadata(), hasReported: true },
    { ...emptyCostMetadata(), hasEstimated: true, pricingSnapshot: "a", tariffBasis: "baseline" },
    { ...emptyCostMetadata(), hasEstimated: true, pricingSnapshot: "b", tariffBasis: "baseline" },
    { ...emptyCostMetadata(), hasUnpriced: true },
    undefined,
  ];
  const expected = {
    ...emptyCostMetadata(),
    hasReported: true,
    hasEstimated: true,
    hasUnpriced: true,
    hasLegacy: true,
    modelAllocationIncomplete: true,
    pricingSnapshot: "mixed",
    tariffBasis: "baseline",
  };
  for (let i = 0; i < contributions.length; i++) {
    const rotated = [...contributions.slice(i), ...contributions.slice(0, i)];
    for (const entries of [rotated, [...rotated].reverse()]) {
      expect(entries.reduce(mergeCostMetadata, emptyCostMetadata())).toEqual(expected);
      const rows = entries.map((costMetadata) => ({ ...model, costMetadata }));
      expect(mergeModelUsage([], rows)[0]?.costMetadata).toEqual(expected);
    }
  }
  expect(mergeCostMetadata(contributions[0], mergeCostMetadata(contributions[1], contributions[2]))).toEqual(
    mergeCostMetadata(mergeCostMetadata(contributions[0], contributions[1]), contributions[2])
  );
});

test.each(Array.from({ length: 16 }, (_, bits) => bits))("retains every source and coverage combination %s", (bits) => {
  const entries = [
    { ...model, costUsd: 10, reportedCost: true },
    model,
    { ...model, model: "unknown" },
    { ...model, costUsd: 3, reportedCost: undefined },
  ].filter((_, i) => bits & (1 << i));
  const result = resolveCostUsage({ costUsd: 0, reportedCost: false, byModel: entries });
  const reversed = resolveCostUsage({ costUsd: 0, reportedCost: false, byModel: [...entries].reverse() });
  expect(result.costUsd).toBeCloseTo((bits & 1 ? 10 : 0) + (bits & 2 ? expectedCost : 0) + (bits & 8 ? 3 : 0));
  expect(result.costMetadata).toMatchObject({
    hasReported: !!(bits & 1),
    hasEstimated: !!(bits & 2),
    hasUnpriced: !!(bits & 4),
    hasLegacy: !!(bits & 8),
  });
  expect(result.costMetadata).toEqual(reversed.costMetadata);
});

test("legacy projection excludes transient extraction fields and unrelated args", () => {
  const event = { threadId: "not-usage", costUsd: 7, byModel: [{ ...model, costUsd: 7, reportedCost: undefined, quantitiesIncomplete: true }] };
  const result = resolveCostUsage(event);
  expect(result).not.toHaveProperty("threadId");
  expect(result.byModel[0]).not.toHaveProperty("reportedCost");
  expect(result.byModel[0]).not.toHaveProperty("quantitiesIncomplete");
  expect(result.costUsd).toBe(7);
});


test("legacy resolution ignores supplied provenance but preserves amounts and tokens", () => {
  const entry = {
    ...model,
    costUsd: 7,
    reportedCost: undefined,
    costMetadata: { ...emptyCostMetadata(), hasReported: true, pricingSnapshot: "untrusted" },
  };
  const result = resolveCostUsage({ costUsd: 7, byModel: [entry] });
  expect(result.byModel[0]).toMatchObject({ costUsd: 7, inputTokens: 100, outputTokens: 50 });
  expect(result.byModel[0]?.costMetadata).toEqual(result.costMetadata);
  expect(result.byModel[0]?.costMetadata).toMatchObject({ hasLegacy: true, hasReported: false });
  expect(result.byModel[0]?.costMetadata).not.toHaveProperty("pricingSnapshot");
});
