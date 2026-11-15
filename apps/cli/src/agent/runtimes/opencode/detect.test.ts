import { describe, expect, it, vi } from "vitest";
import { isOpencodeVersionSupported } from "./server.js";
import {
  loadAdvertisedModels,
  mapInventoryToAdvertisedModels,
  MAX_ADVERTISED_MODELS,
  MINIMUM_OPENCODE_VERSION,
} from "./detect.js";

describe("isOpencodeVersionSupported", () => {
  it("accepts the minimum version and anything newer", () => {
    expect(isOpencodeVersionSupported(MINIMUM_OPENCODE_VERSION, MINIMUM_OPENCODE_VERSION)).toBe(true);
    expect(isOpencodeVersionSupported("1.14.20", MINIMUM_OPENCODE_VERSION)).toBe(true);
    expect(isOpencodeVersionSupported("1.17.13", MINIMUM_OPENCODE_VERSION)).toBe(true);
    expect(isOpencodeVersionSupported("2.0.0", MINIMUM_OPENCODE_VERSION)).toBe(true);
  });

  it("rejects older or malformed versions", () => {
    expect(isOpencodeVersionSupported("1.14.18", MINIMUM_OPENCODE_VERSION)).toBe(false);
    expect(isOpencodeVersionSupported("1.13.99", MINIMUM_OPENCODE_VERSION)).toBe(false);
    expect(isOpencodeVersionSupported("0.9.0", MINIMUM_OPENCODE_VERSION)).toBe(false);
    expect(isOpencodeVersionSupported("not-a-version", MINIMUM_OPENCODE_VERSION)).toBe(false);
  });
});

describe("loadAdvertisedModels", () => {
  // A disabled project has no provider to list, so the start would buy an empty list (OS-2018).
  it("advertises no models for a disabled project without starting a server", async () => {
    const getServer = vi.fn();
    await expect(loadAdvertisedModels({ getServer, auth: { mode: "disabled" } })).resolves.toEqual([]);
    expect(getServer).not.toHaveBeenCalled();
  });
});

describe("mapInventoryToAdvertisedModels", () => {
  it("advertises only connected providers' models with variant keys", () => {
    const models = mapInventoryToAdvertisedModels({
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-sonnet-5": {
              id: "claude-sonnet-5",
              name: "Claude Sonnet 5",
              variants: { low: {}, high: {} },
            },
          },
        },
        {
          id: "openai",
          name: "OpenAI",
          models: {
            "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5" },
          },
        },
      ],
      connected: ["anthropic"],
      defaults: {},
    });

    expect(models).toEqual([
      {
        slug: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        variants: ["low", "high"],
      },
    ]);
  });

  it("returns an empty list when nothing is connected", () => {
    expect(
      mapInventoryToAdvertisedModels({
        all: [
          {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5" } },
          },
        ],
        connected: [],
        defaults: {},
      }),
    ).toEqual([]);
  });
});

describe("advertised model cap", () => {
  /** `count` models on one provider, named so the slice order is visible. */
  const provider = (id: string, count: number) => ({
    id,
    name: id,
    models: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `m${index}`,
        { id: `m${index}`, name: `${id} ${index}` },
      ]),
    ),
  });

  it("keeps every connected provider represented when the inventory exceeds the cap", () => {
    // The real shape that broke a flat slice: one provider dwarfs the rest
    // (OS-1721 measured 114 bedrock / 13 openai / 7 opencode).
    const models = mapInventoryToAdvertisedModels({
      all: [provider("bedrock", 600), provider("openai", 13), provider("local", 7)],
      connected: ["bedrock", "openai", "local"],
      defaults: {},
    });

    expect(models).toHaveLength(MAX_ADVERTISED_MODELS);
    const providers = new Set(models.map((model) => model.slug.split("/")[0]));
    expect(providers).toEqual(new Set(["bedrock", "openai", "local"]));
    // A small provider is advertised whole rather than sampled away.
    expect(models.filter((model) => model.slug.startsWith("local/"))).toHaveLength(7);
  });

  it("leaves an inventory under the cap untouched", () => {
    const models = mapInventoryToAdvertisedModels({
      all: [provider("openai", 3), provider("local", 2)],
      connected: ["openai", "local"],
      defaults: {},
    });

    expect(models.map((model) => model.slug)).toEqual([
      "openai/m0",
      "openai/m1",
      "openai/m2",
      "local/m0",
      "local/m1",
    ]);
  });
});
