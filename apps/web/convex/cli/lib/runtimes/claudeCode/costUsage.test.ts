import { describe, expect, test } from "vitest";
import { extractClaudeCostUsage } from "./costUsage";
import { resolveCostUsage } from "@/convex/costs/lib/resolution";
import { pricingCatalog } from "@/convex/costs/lib/pricing/resolution";

function resultChunk(payload: Record<string, unknown>) {
  return { type: "result", data: JSON.stringify({ type: "result", ...payload }) };
}

describe("extractClaudeCostUsage", () => {
  test("prefers modelUsage per-model breakdown", () => {
    const usage = extractClaudeCostUsage([
      resultChunk({
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 200 },
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 80,
            outputTokens: 150,
            cacheReadInputTokens: 500,
            cacheCreationInputTokens: 100,
            costUSD: 0.04,
          },
          "claude-haiku-4-5": {
            inputTokens: 20,
            outputTokens: 50,
            costUSD: 0.01,
          },
        },
      }),
    ]);

    expect(usage).toEqual({
      costUsd: 0.05,
      reportedCost: true,
      byModel: [
        {
          model: "claude-opus-4-6",
          inputTokens: 80,
          cachedInputTokens: 600,
          cacheReadTokens: 500,
          cacheWriteTokens: 100,
          outputTokens: 150,
          costUsd: 0.04,
          reportedCost: true,
          quantitiesIncomplete: false,
        },
        {
          model: "claude-haiku-4-5",
          inputTokens: 20,
          cachedInputTokens: 0,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          outputTokens: 50,
          costUsd: 0.01,
          reportedCost: true,
          quantitiesIncomplete: false,
        },
      ],
    });
  });

  test("falls back to aggregate usage under model 'unknown'", () => {
    const usage = extractClaudeCostUsage([
      resultChunk({
        total_cost_usd: 0.02,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 15,
          output_tokens: 30,
        },
      }),
    ]);

    expect(usage).toEqual({
      costUsd: 0.02,
      reportedCost: true,
      byModel: [
        {
          model: "unknown",
          inputTokens: 10,
          cachedInputTokens: 20,
          cacheReadTokens: 15,
          cacheWriteTokens: 5,
          outputTokens: 30,
          costUsd: 0.02,
          quantitiesIncomplete: false,
          reportedCost: true,
        },
      ],
    });
  });

  test("uses only the last result chunk (cumulative cost, not summed)", () => {
    const usage = extractClaudeCostUsage([
      resultChunk({ total_cost_usd: 0.01, usage: { input_tokens: 1 } }),
      resultChunk({ total_cost_usd: 0.03, usage: { input_tokens: 5 } }),
    ]);

    expect(usage?.costUsd).toBe(0.03);
    expect(usage?.byModel).toEqual([
      {
        model: "unknown",
        inputTokens: 5,
        cachedInputTokens: 0,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        outputTokens: 0,
        costUsd: 0.03,
        reportedCost: true,
        quantitiesIncomplete: true,
      },
    ]);
  });

  test("returns null without result chunks", () => {
    expect(extractClaudeCostUsage([{ type: "assistant", data: "{}" }])).toBeNull();
    expect(extractClaudeCostUsage([])).toBeNull();
  });

  test("returns null for malformed or cost-free result chunks", () => {
    expect(extractClaudeCostUsage([{ type: "result", data: "not json" }])).toBeNull();
    expect(extractClaudeCostUsage([resultChunk({ subtype: "success" })])).toBeNull();
  });

  test("distinguishes a reported zero from absent cost and preserves aggregate-only results", () => {
    const extract = (data: object) =>
      extractClaudeCostUsage([{ type: "result", data: JSON.stringify(data) }]);
    expect(extract({ total_cost_usd: 0 })).toMatchObject({
      costUsd: 0,
      reportedCost: true,
      byModel: [],
    });
    expect(extract({ total_cost_usd: 3 })).toMatchObject({ costUsd: 3, reportedCost: true });
    const result = extract({ modelUsage: { "gpt-5.5": { inputTokens: 10, outputTokens: 5 } } });
    expect(result).toMatchObject({ reportedCost: false, byModel: [{ reportedCost: false }] });
    expect(result?.byModel[0]?.cacheWriteTokens).toBeUndefined();
  });

  // Claude Code prices Bedrock at its built-in list rates, without the AWS geo or Mantle uplift.
  describe("Bedrock list prices", () => {
    const tokens = { inputTokens: 1000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    const listCost = (1000 * 4e-6 + 2000 * 2e-5);

    test.each([
      ["bedrock", "us.anthropic.claude-opus-5-5", "us.anthropic.claude-opus-5-5"],
      ["mantle", "anthropic.claude-opus-5-5", "bedrock_mantle/anthropic.claude-opus-5-5"],
    ])("re-estimates %s usage of %s from the AWS rows", (provider, model, pricedAs) => {
      const usage = extractClaudeCostUsage([
        resultChunk({
          total_cost_usd: listCost + 0.01,
          modelUsage: {
            [model]: { ...tokens, costUSD: listCost, provider, costBasis: "list", canonicalModel: "claude-opus-5-5" },
            "claude-haiku-5-5": { inputTokens: 1, outputTokens: 1, costUSD: 0.01, provider: "firstParty", costBasis: "list" },
          },
        }),
      ]);
      expect(usage).toMatchObject({ reportedCost: false });
      expect(usage!.byModel[0]).toMatchObject({ model: pricedAs, reportedCost: false, costUsd: 0 });
      expect(usage!.byModel[1]).toMatchObject({ model: "claude-haiku-5-5", reportedCost: true, costUsd: 0.01 });

      const rates = pricingCatalog.models[pricedAs];
      const resolved = resolveCostUsage(usage!);
      expect(resolved.costUsd).toBeCloseTo(1000 * rates.input! + 2000 * rates.output! + 0.01, 12);
      expect(resolved.costUsd).toBeCloseTo(listCost * 1.1 + 0.01, 12);
    });

    test.each([
      ["bedrock", "us.anthropic.claude-opus-5-5", "managed"],
      ["bedrock", "us.anthropic.claude-opus-9", "list"],
      ["firstParty", "claude-opus-5-5", "list"],
    ])("keeps the reported cost for %s %s priced at %s", (provider, model, costBasis) => {
      const usage = extractClaudeCostUsage([
        resultChunk({ total_cost_usd: 0.5, modelUsage: { [model]: { ...tokens, costUSD: 0.5, provider, costBasis } } }),
      ]);
      expect(usage).toMatchObject({ costUsd: 0.5, reportedCost: true, byModel: [{ model, costUsd: 0.5, reportedCost: true }] });
    });

    test.each([
      ["firstParty", "claude-opus-5-5"],
      ["bedrock", "us.anthropic.claude-opus-5-5"],
    ])("keeps a valid total when a %s entry has no per-model price", (provider, model) => {
      const usage = extractClaudeCostUsage([
        resultChunk({ total_cost_usd: 3, modelUsage: { [model]: { ...tokens, provider } } }),
      ]);
      expect(usage).toMatchObject({ costUsd: 3, reportedCost: true });
      expect(resolveCostUsage(usage!).costUsd).toBe(3);
    });
  });
});
