import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_MODEL_SLOTS } from "../convex/cli/lib/runtimes/codex/models";
import { pricingCatalog, resolveModelPricing } from "../convex/costs/lib/pricing/resolution";
import { buildPricingCatalog, refreshModelPricing } from "./refreshModelPricing";

const revision = "a".repeat(40);
const retrievedOn = "2026-09-18";
const model = { litellm_provider: "openai", mode: "responses", input_cost_per_token: 0.00001, output_cost_per_token: 0.00005 };
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function destination() {
  const directory = await mkdtemp(join(tmpdir(), "os1528-"));
  directories.push(directory);
  const path = join(directory, "catalog.json");
  await writeFile(path, "previous catalog\n");
  return path;
}

describe("catalog coverage", () => {
  it("explicitly classifies every current Codex slot", () => {
    expect(Object.fromEntries(CODEX_MODEL_SLOTS.map((slot) => [slot, resolveModelPricing(slot).status]))).toEqual({
      default: "unpriced",
      "gpt-6-astra": "resolved",
      "gpt-6.1-sol": "resolved",
      "gpt-6-sol": "resolved",
      "gpt-6-luna": "resolved",
      "gpt-5.6-sol": "resolved",
      "gpt-5.6-terra": "resolved",
      "gpt-5.6-luna": "resolved",
      "gpt-5.5": "resolved",
      "gpt-5.4": "resolved",
      "gpt-5.4-mini": "resolved",
      "gpt-5.3-codex-spark": "unpriced",
    });
    for (const slot of CODEX_MODEL_SLOTS.filter((slot) => slot !== "default" && slot !== "gpt-5.3-codex-spark")) {
      expect(pricingCatalog.models[slot].input).toBeGreaterThan(0);
      expect(pricingCatalog.models[slot].output).toBeGreaterThan(0);
    }
  });

  it("contains finite nonnegative rates and pinned provenance", () => {
    expect(pricingCatalog.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(pricingCatalog.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pricingCatalog.sourceUrl).toContain(pricingCatalog.sourceRevision);
    expect(pricingCatalog).toMatchObject({ units: "USD/token", tariffBasis: "standard-short-context-api-equivalent" });
    for (const rates of Object.values(pricingCatalog.models)) {
      for (const rate of Object.values(rates)) {
        expect(Number.isFinite(rate)).toBe(true);
        expect(rate).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("catalog refresh", () => {
  it("skips upstream alias_of pointer rows", () => {
    const source = { "claude-fable-latest": { alias_of: "claude-fable-5-1" }, "claude-fable-5-1": { ...model, litellm_provider: "anthropic" } };
    expect(Object.keys(buildPricingCatalog(JSON.stringify(source), revision, retrievedOn).models)).toEqual(["claude-fable-5-1"]);
  });

  it("keeps Bedrock geo and Mantle rows, but no region-pinned or in-region spellings", () => {
    const bedrock = { ...model, litellm_provider: "bedrock_converse", mode: "chat" };
    const mantle = { ...model, litellm_provider: "bedrock_mantle" };
    const source = {
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0": bedrock,
      "global.openai.gpt-6-sol": bedrock,
      "bedrock_mantle/openai.gpt-6-sol": mantle,
      "bedrock_mantle/us-gov-west-1/openai.gpt-6-sol": mantle,
      "us-gov.anthropic.claude-sonnet-5": bedrock,
      "anthropic.claude-sonnet-5": bedrock,
      "us.meta.llama4": bedrock,
      "us.openai.gpt-6-sol": { ...bedrock, litellm_provider: "openai" },
    };
    expect(Object.keys(buildPricingCatalog(JSON.stringify(source), revision, retrievedOn).models)).toEqual([
      "bedrock_mantle/openai.gpt-6-sol",
      "global.openai.gpt-6-sol",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    ]);
  });

  it("keeps only base direct-provider rates, preserving zeros and missing prices", () => {
    const source = {
      "gpt-6-astra": {
        ...model,
        cache_read_input_token_cost: 0,
        input_cost_per_token_priority: 10,
        input_cost_per_token_above_272k_tokens: 20,
      },
      "claude-sonnet-5": { litellm_provider: "anthropic", mode: "chat" },
      "azure/gpt-6-astra": model,
      "gpt-4o-audio-preview": model,
      "gpt-other-vendor": { ...model, litellm_provider: "azure" },
      "text-embedding-3-small": { ...model, mode: "embedding" },
    };
    expect(buildPricingCatalog(JSON.stringify(source), revision, retrievedOn).models).toEqual({
      "claude-sonnet-5": {},
      "gpt-6-astra": { input: 0.00001, cacheRead: 0, output: 0.00005 },
    });
  });

  it("produces identical bytes for the same pinned input and cleans temporary files", async () => {
    const path = await destination();
    const readSource = vi.fn(async () => JSON.stringify({ "gpt-6-astra": model }));
    const options = { revision, retrievedOn, destination: path, readSource };
    const catalog = await refreshModelPricing(options);
    const first = await readFile(path, "utf8");
    await refreshModelPricing(options);
    expect(await readFile(path, "utf8")).toBe(first);
    expect(JSON.parse(first)).toEqual(catalog);
    expect(readSource).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/BerriAI/litellm/${revision}/model_prices_and_context_window.json`
    );
    expect(await readdir(join(path, ".."))).toEqual(["catalog.json"]);
  });

  it.each([
    "not json",
    "[]",
    "{}",
    '{"gpt-6-astra":null}',
    '{"gpt-6-astra":{}}',
    ...[-1, null, "free"].map((rate) => JSON.stringify({ "gpt-6-astra": { ...model, input_cost_per_token: rate } })),
    '{"gpt-6-astra":{"litellm_provider":"openai","mode":"chat","input_cost_per_token":1e999}}',
  ])("preserves the existing catalog on invalid source %s", async (source) => {
    const path = await destination();
    await expect(refreshModelPricing({ revision, retrievedOn, destination: path, readSource: async () => source })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("previous catalog\n");
    expect(await readdir(join(path, ".."))).toEqual(["catalog.json"]);
  });

  it("preserves the existing catalog on a download failure", async () => {
    const path = await destination();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 }))
    );
    await expect(refreshModelPricing({ revision, retrievedOn, destination: path })).rejects.toThrow("HTTP 503");
    expect(await readFile(path, "utf8")).toBe("previous catalog\n");
  });

  it.each(["latest", "main", "../main"])("rejects unpinned revision %s", (invalid) => {
    expect(() => buildPricingCatalog("{}", invalid, retrievedOn)).toThrow("commit SHA");
  });

  it.each(["today", "2026-02-30", "2026-13-01"])("rejects invalid retrieval date %s", (invalid) => {
    expect(() => buildPricingCatalog("{}", revision, invalid)).toThrow("valid YYYY-MM-DD");
  });
});
