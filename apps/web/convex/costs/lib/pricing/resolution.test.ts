import { describe, expect, it } from "vitest";
import { estimateTokenCost, modelAliases, pricingCatalog, resolveModelPricing } from "./resolution";
import { toPricingRates, type PricingRates } from "./validators";
import { getCliModelOptions } from "@/convex/cli/lib/runtimes/registry";

const quantities = { input: 1000, cacheRead: 2000, cacheWrite: 3000, output: 4000 };
function catalogWith(rates: PricingRates) {
  return { ...pricingCatalog, models: { test: rates } };
}

describe("model pricing resolution", () => {
  it.each([
    "claude-opus-5-5", "anthropic/claude-opus-5-5", "anthropic.claude-opus-5-5",
  ])("prices Opus 5.5 spelling %s using its own rates", (model) => {
    const result = estimateTokenCost(model, quantities);
    expect(result).toMatchObject({
      status: "priced", modelKey: "claude-opus-5-5",
      rates: { input: 0.000004, output: 0.00002, cacheRead: 0.0000002, cacheWrite: 0.000005 },
      fallbackCategories: [],
    });
    if (result.status === "priced") expect(result.costUsd).toBeCloseTo(0.0994, 12);
  });

  it.each([
    "claude-sonnet-5-5", "anthropic/claude-sonnet-5-5", "anthropic.claude-sonnet-5-5",
  ])("prices Sonnet 5.5 spelling %s using its own rates", (model) => {
    expect(resolveModelPricing(model)).toMatchObject({
      status: "resolved", modelKey: "claude-sonnet-5-5",
      rates: { input: 0.000002, output: 0.00001, cacheRead: 1e-7, cacheWrite: 0.0000025 },
    });
  });

  it.each([
    "claude-haiku-5-5", "anthropic/claude-haiku-5-5", "anthropic.claude-haiku-5-5",
  ])("prices Haiku 5.5 spelling %s using its own short-context rates", (model) => {
    expect(resolveModelPricing(model)).toMatchObject({
      status: "resolved", modelKey: "claude-haiku-5-5",
      rates: { input: 1e-7, output: 5e-7, cacheRead: 1e-8, cacheWrite: 1.25e-7 },
    });
  });

  it.each([
    "claude-fable-5-2", "anthropic/claude-fable-5-2", "anthropic.claude-fable-5-2",
  ])("prices Fable 5.2 spelling %s using its own rates", (model) => {
    expect(resolveModelPricing(model)).toMatchObject({
      status: "resolved", modelKey: "claude-fable-5-2",
      rates: { input: 0.000008, output: 0.00004, cacheRead: 2e-7, cacheWrite: 0.00001 },
    });
  });

  it.each([
    ["gpt-6.1-sol", 0.000002, 0.00001],
    ["openai/gpt-6.1-sol", 0.000002, 0.00001],
    ["gpt-6-sol", 0.000002, 0.00001],
    ["openai/gpt-6-sol", 0.000002, 0.00001],
    ["gpt-6-luna", 1e-7, 5e-7],
    ["openai/gpt-6-luna", 1e-7, 5e-7],
  ])("prices GPT-6 spelling %s using its own rates", (model, input, output) => {
    expect(resolveModelPricing(model)).toMatchObject({
      status: "resolved", modelKey: model.replace("openai/", ""), rates: { input, output },
    });
  });

  // Bedrock rows carry AWS on-demand rates: global matches the direct API, geo and Mantle add 10%.
  it.each([
    ["global.anthropic.claude-opus-5-5", "claude-opus-5-5", 1],
    ["us.anthropic.claude-opus-5-5", "claude-opus-5-5", 1.1],
    ["eu.anthropic.claude-sonnet-5-5", "claude-sonnet-5-5", 1.1],
    ["bedrock_mantle/anthropic.claude-sonnet-5-5", "claude-sonnet-5-5", 1.1],
    ["global.anthropic.claude-haiku-5-5", "claude-haiku-5-5", 1],
    ["us.anthropic.claude-fable-5-2", "claude-fable-5-2", 1.1],
    ["global.openai.gpt-6-sol", "gpt-6-sol", 1],
    ["us.openai.gpt-6-astra", "gpt-6-astra", 1.1],
    ["bedrock_mantle/openai.gpt-6-luna", "gpt-6-luna", 1.1],
  ] as const)("prices Bedrock ID %s at its own AWS rates", (model, direct, factor) => {
    const result = resolveModelPricing(model);
    expect(result).toMatchObject({ status: "resolved", match: "exact", modelKey: model });
    const base = pricingCatalog.models[direct];
    if (result.status !== "resolved") return;
    for (const category of ["input", "cacheRead", "cacheWrite", "output"] as const) {
      expect(result.rates[category]).toBeCloseTo(base[category]! * factor, 15);
    }
  });

  // Codex reports no cost, so every AWS ID Convoy sends must resolve to a Bedrock row.
  it.each([
    ["mantle", (slot: string) => `bedrock_mantle/openai.${slot}`, "alias"],
    ["bedrock", (slot: string) => `global.openai.${slot}`, "exact"],
  ] as const)("prices every %s Codex run model at its AWS rates (OS-2105)", (provider, key, match) => {
    const options = getCliModelOptions({
      cliType: "codex",
      availableClis: [{ type: "codex", version: "0.156.1", provider, region: "us-east-1" }],
    });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(resolveModelPricing(option.runModel!)).toMatchObject({ status: "resolved", match, modelKey: key(option.value) });
    }
  });

  it("prefers an exact key even when the key has an explicit alias", () => {
    const catalog = {
      ...pricingCatalog,
      models: { "anthropic/claude-sonnet-5": { input: 7 }, "claude-sonnet-5": { input: 2 } },
    };
    expect(resolveModelPricing("anthropic/claude-sonnet-5", catalog)).toMatchObject({
      status: "resolved",
      match: "exact",
      rates: { input: 7 },
    });
  });

  it.each(Object.entries(modelAliases))("resolves reviewed spelling %s", (alias, modelKey) => {
    expect(resolveModelPricing(alias)).toMatchObject({ status: "resolved", match: "alias", modelKey });
  });

  it.each([
    "default",
    "unknown",
    "",
    "gpt-5.3-codex-spark",
    "gpt-6-astra-2099-01-01",
    "claude-sonnet-5-20990101",
    "us.anthropic.claude-sonnet-5-20990101-v1:0",
    "anything/claude-sonnet-5",
    "toString",
    "__proto__",
  ])("leaves unrecognized model %s unpriced", (model) => {
    expect(resolveModelPricing(model)).toEqual({ status: "unpriced", reason: "unknown-model", model });
  });
});

describe("baseline token arithmetic", () => {
  it("charges four disjoint categories at the pinned Astra rates", () => {
    const result = estimateTokenCost("gpt-6-astra", quantities);
    expect(result).toMatchObject({
      status: "priced",
      categoryCosts: { input: 0.01, cacheRead: 0.002, cacheWrite: 0.0375, output: 0.2 },
      fallbackCategories: [],
      snapshotVersion: pricingCatalog.snapshotVersion,
      tariffBasis: "standard-short-context-api-equivalent",
    });
    if (result.status === "priced") expect(result.costUsd).toBeCloseTo(0.2495, 12);
  });

  it("uses input rates only for missing cache rates and records the fallback", () => {
    const result = estimateTokenCost("test", quantities, catalogWith({ input: 0.001, output: 0.002 }));
    expect(result).toMatchObject({ status: "priced", costUsd: 14, fallbackCategories: ["cacheRead", "cacheWrite"] });
  });

  it("does not replace explicit zero rates with fallbacks", () => {
    expect(estimateTokenCost("test", quantities, catalogWith({ input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }))).toMatchObject({
      status: "priced",
      costUsd: 1000,
      fallbackCategories: [],
    });
  });

  it("keeps missing cache quantities unpriced, even when rates are zero", () => {
    const result = estimateTokenCost("test", { input: 100, output: 20 }, catalogWith({ input: 0, output: 0 }));
    expect(result).toMatchObject({ status: "unpriced", missingQuantities: ["cacheRead", "cacheWrite"] });
    expect(result).not.toHaveProperty("costUsd");
  });

  it("does not infer a zero write count when only reads are known", () => {
    expect(estimateTokenCost("gpt-6-astra", { input: 10, cacheRead: 20, output: 30 })).toMatchObject({
      status: "unpriced",
      missingQuantities: ["cacheWrite"],
    });
  });

  it("does not fabricate free input or output prices", () => {
    const result = estimateTokenCost("test", quantities, catalogWith({ cacheRead: 0, cacheWrite: 0 }));
    expect(result).toMatchObject({ status: "unpriced", missingRates: ["input", "output"] });
    expect(result).not.toHaveProperty("costUsd");
  });

  it("prices explicit zero quantities without rates, but still requires a known model", () => {
    const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    expect(estimateTokenCost("test", zero, catalogWith({}))).toMatchObject({ status: "priced", costUsd: 0 });
    expect(estimateTokenCost("unknown", zero)).toMatchObject({ status: "unpriced" });
  });

  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid quantity %s", (input) => {
    expect(estimateTokenCost("gpt-6-astra", { ...quantities, input })).toMatchObject({ status: "unpriced", reason: "invalid-quantity" });
  });

  it.each([-1, NaN, Infinity])("rejects invalid rate %s", (input) => {
    expect(() => toPricingRates({ input_cost_per_token: input })).toThrow("Invalid pricing rate");
    expect(estimateTokenCost("test", quantities, catalogWith({ input }))).toMatchObject({ status: "unpriced", reason: "invalid-rate" });
  });

  it("rejects overflow in multiplication and summation", () => {
    expect(estimateTokenCost("test", quantities, catalogWith({ input: Number.MAX_VALUE }))).toMatchObject({
      status: "unpriced",
      reason: "invalid-rate",
    });
    expect(
      estimateTokenCost(
        "test",
        { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 },
        catalogWith({ input: Number.MAX_VALUE, output: Number.MAX_VALUE })
      )
    ).toMatchObject({ status: "unpriced", reason: "invalid-total" });
  });
});
