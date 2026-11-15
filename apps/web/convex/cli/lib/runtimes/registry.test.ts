import { describe, expect, test } from "vitest";
import {
  buildResumeCommand,
  cliTypeAdvertisesModelCatalog,
  cliTypeSupportsSteering,
  getCliEffortOptions,
  getDefaultCliEffort,
  isSupportedCliEffort,
  normalizeCliModelForStorage,
  normalizeCliEffortForStorage,
  resolveCliRunEffort,
  getContinuationIdFromIncomingChunks,
  getCliModelOption,
  getCliModelOptions,
  getSupportedCliTypes,
  MAX_STORED_CATALOG_MODELS,
  MAX_STORED_CATALOG_VARIANTS,
  parseAvailableCli,
  resolveCliRunModel,
  supportsResumeLocally,
} from "./registry";
import type { OpencodeAdvertisedModel } from "./opencode/contracts";

/** The advertised opencode models a parse produced, or [] for any other outcome. */
function opencodeModels(parsed: ReturnType<typeof parseAvailableCli>): OpencodeAdvertisedModel[] {
  if (!parsed.success || parsed.value.type !== "opencode") {
    return [];
  }
  return parsed.value.models ?? [];
}

describe("cli runtime registry", () => {
  test("exposes registered runtime slugs", () => {
    expect(getSupportedCliTypes()).toEqual([
      "claude-code",
      "codex",
      "amp",
      "opencode",
      "droid",
      "cursor",
      "gemini",
      "coderabbit",
      "github-copilot",
      "other",
    ]);
  });

  test("parses Claude available CLI payloads through the registry", () => {
    expect(
      parseAvailableCli({
        type: "claude-code",
        version: "2.1.52",
        provider: "bedrock",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "claude-code",
        version: "2.1.52",
        provider: "bedrock",
      },
    });
  });

  test("degrades an unrecognized Claude provider to unknown", () => {
    expect(
      parseAvailableCli({
        type: "claude-code",
        version: "2.1.52",
        provider: "provider-from-a-newer-cli",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "claude-code",
        version: "2.1.52",
        provider: "unknown",
      },
    });
  });

  test("parses generic runtime payloads through the registry", () => {
    expect(
      parseAvailableCli({
        type: "amp",
        version: "0.0.1",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "amp",
        version: "0.0.1",
      },
    });
  });

  test("parses Codex available CLI payloads through the registry", () => {
    expect(
      parseAvailableCli({
        type: "codex",
        version: "0.142.3",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "codex",
        version: "0.142.3",
      },
    });
  });

  test("parses Codex AWS provider metadata (OS-2105)", () => {
    expect(
      parseAvailableCli({ type: "codex", version: "0.156.1", provider: "mantle", region: "us-east-1" }),
    ).toEqual({
      success: true,
      value: { type: "codex", version: "0.156.1", provider: "mantle", region: "us-east-1" },
    });
    // A provider this backend predates degrades instead of failing registration.
    expect(
      parseAvailableCli({ type: "codex", version: "0.156.1", provider: "vertex", region: 7 }),
    ).toEqual({ success: true, value: { type: "codex", version: "0.156.1", provider: "unknown" } });
  });

  test("resolves AWS Codex models per provider and keeps saved slots (OS-2105)", () => {
    const mantle = [{ type: "codex" as const, version: "0.156.1", provider: "mantle" as const, region: "us-east-1" }];
    const bedrock = [{ type: "codex" as const, version: "0.156.1", provider: "bedrock" as const, region: "us-east-1" }];
    expect(getCliModelOptions({ cliType: "codex", availableClis: mantle }).map((option) => [option.value, option.runModel]))
      .toEqual([
        ["gpt-6-astra", "openai.gpt-6-astra"],
        ["gpt-6-sol", "openai.gpt-6-sol"],
        ["gpt-6-luna", "openai.gpt-6-luna"],
        ["gpt-5.6-sol", "openai.gpt-5.6-sol"],
        ["gpt-5.6-terra", "openai.gpt-5.6-terra"],
        ["gpt-5.6-luna", "openai.gpt-5.6-luna"],
      ]);
    expect(resolveCliRunModel({ cliType: "codex", cliModel: "gpt-6-sol", availableClis: bedrock }))
      .toBe("global.openai.gpt-6-sol");
    expect(resolveCliRunModel({ cliType: "codex", cliModel: "gpt-5.6-terra", availableClis: bedrock }))
      .toBe("global.openai.gpt-5.6-terra");
    // Default and native-only slots stay readable but never run on AWS.
    for (const cliModel of ["default", "gpt-6.1-sol", "gpt-5.5"]) {
      expect(resolveCliRunModel({ cliType: "codex", cliModel, availableClis: mantle })).toBeUndefined();
      expect(getCliModelOption({ cliType: "codex", value: cliModel, availableClis: mantle })?.runModel).toBeUndefined();
    }
    expect(getCliModelOption({ cliType: "codex", value: "gpt-5.5", availableClis: mantle })?.label).toBe("GPT-5.5");
  });

  test("offers AWS Codex efforts without ultra (OS-2105)", () => {
    const availableClis = [{ type: "codex" as const, version: "0.156.1", provider: "mantle" as const, region: "us-east-1" }];
    expect(getCliEffortOptions("codex", { cliModel: "gpt-6-astra", availableClis }).map((option) => option.value))
      .toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "ultra", context: { cliModel: "gpt-6-astra", availableClis } }))
      .toBeUndefined();
    // Codex's Bedrock catalog also gives the GPT-5.6 family `max`.
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "max", context: { cliModel: "gpt-5.6-luna", availableClis } }))
      .toBe("max");
  });

  test("parses OpenCode available CLI payloads through the registry", () => {
    expect(
      parseAvailableCli({
        type: "opencode",
        version: "1.14.19",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "opencode",
        version: "1.14.19",
        models: undefined,
        defaultModel: undefined,
      },
    });

    // `providerID`/`modelID` are dropped: nothing reads them back (the slug is
    // `providerID/modelID`), and they were ~40% of the stored catalog (OS-1721).
    expect(
      parseAvailableCli({
        type: "opencode",
        version: "1.14.19",
        defaultModel: "anthropic/claude-sonnet-5",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            providerID: "anthropic",
            modelID: "claude-sonnet-5",
            variants: ["low", "high"],
          },
        ],
      }),
    ).toEqual({
      success: true,
      value: {
        type: "opencode",
        version: "1.14.19",
        defaultModel: "anthropic/claude-sonnet-5",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            variants: ["low", "high"],
          },
        ],
      },
    });

    // A CLI that never sends them still registers its catalog.
    expect(
      parseAvailableCli({
        type: "opencode",
        version: "1.14.19",
        models: [{ slug: "openai/gpt-5.5", name: "GPT-5.5" }],
      }),
    ).toEqual({
      success: true,
      value: {
        type: "opencode",
        version: "1.14.19",
        defaultModel: undefined,
        models: [{ slug: "openai/gpt-5.5", name: "GPT-5.5", variants: undefined }],
      },
    });
  });

  test("skips malformed OpenCode models instead of failing the registration", () => {
    expect(
      parseAvailableCli({
        type: "opencode",
        version: "1.14.19",
        defaultModel: "",
        models: [
          { slug: "anthropic/claude-sonnet-5" },
          {
            slug: "openai/gpt-5.5",
            name: "GPT-5.5",
          },
          "not-an-object",
        ],
      }),
    ).toEqual({
      success: true,
      value: {
        type: "opencode",
        version: "1.14.19",
        defaultModel: undefined,
        models: [
          {
            slug: "openai/gpt-5.5",
            name: "GPT-5.5",
            variants: undefined,
          },
        ],
      },
    });
  });

  // The cap in the CLI is a client constant, so the bound that actually protects
  // the stored document has to live in the parser (OS-1721).
  test("bounds a hostile or ancient CLI's advertised catalog server-side", () => {
    const parsed = parseAvailableCli({
      type: "opencode",
      version: "1.14.19",
      models: [
        ...Array.from({ length: MAX_STORED_CATALOG_MODELS + 25 }, (_, index) => ({
          slug: `p/m${index}`,
          name: `Model ${index}`,
        })),
        // Over-long strings are skipped like any other malformed model.
        { slug: `p/${"x".repeat(500)}`, name: "Fine" },
        { slug: "p/ok", name: "y".repeat(500) },
      ],
    });

    expect(parsed.success).toBe(true);
    const models = opencodeModels(parsed);
    expect(models).toHaveLength(MAX_STORED_CATALOG_MODELS);
    expect(models.every((model) => model.slug.length <= 200 && model.name.length <= 200)).toBe(true);
  });

  test("bounds the variant list of a single advertised model", () => {
    const parsed = parseAvailableCli({
      type: "opencode",
      version: "1.14.19",
      models: [{ slug: "p/m", name: "M", variants: Array.from({ length: 100 }, (_, index) => `v${index}`) }],
    });

    expect(opencodeModels(parsed)[0]?.variants?.length).toBe(MAX_STORED_CATALOG_VARIANTS);
  });

  // Readers skip the catalog lookup for runtimes that can never have one, so the
  // answer has to come from the registry rather than a `cliType` branch (OS-1721).
  test("reports which runtimes advertise a model catalog", () => {
    expect(cliTypeAdvertisesModelCatalog("opencode")).toBe(true);
    expect(cliTypeAdvertisesModelCatalog("claude-code")).toBe(false);
    expect(cliTypeAdvertisesModelCatalog("codex")).toBe(false);
  });

  test("rejects array payloads when parsing available CLIs", () => {
    expect(parseAvailableCli([])).toEqual({
      success: false,
      message: "Each CLI must be an object with type and version",
    });
  });

  test("resolves Claude run models through the registry", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-1m",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "bedrock",
          },
        ],
      }),
    ).toBe("us.anthropic.claude-opus-4-8[1m]");
  });

  test("resolves Mantle run models without the Bedrock cross-region prefix", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "mantle",
          },
        ],
      }),
    ).toBe("anthropic.claude-opus-4-8");
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-1m",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "mantle",
          },
        ],
      }),
    ).toBe("anthropic.claude-opus-4-8[1m]");
    // Bedrock's dated Haiku ID does not carry over; Mantle uses the short alias.
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "haiku",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "mantle",
          },
        ],
      }),
    ).toBe("anthropic.claude-haiku-4-5");
  });

  test("resolves the new Opus 4.7 Claude run models through the registry", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-4-7-1m",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "bedrock",
          },
        ],
      }),
    ).toBe("us.anthropic.claude-opus-4-7[1m]");
  });

  test.each([
    ["anthropic", "claude-opus-5-5"],
    ["bedrock", "us.anthropic.claude-opus-5-5"],
    ["mantle", "anthropic.claude-opus-5-5"],
    ["unknown", "claude-opus-5-5"],
    [undefined, "claude-opus-5-5"],
  ] as const)("resolves Opus 5.5 for provider %s", (provider, runModel) => {
    const availableClis = [{ type: "claude-code" as const, version: "2.1.280", provider }];
    expect(resolveCliRunModel({ cliType: "claude-code", cliModel: "opus-5-5", availableClis })).toBe(runModel);
    const options = getCliModelOptions({ cliType: "claude-code", availableClis });
    expect(options.find((option) => option.value === "opus-5-5")).toMatchObject({ label: "Opus 5.5", runModel });
    expect(options.findIndex((option) => option.value === "opus-5-5")).toBeLessThan(
      options.findIndex((option) => option.value === "opus-5"),
    );
    expect(normalizeCliModelForStorage({ cliType: "claude-code", cliModel: "opus-5-5" })).toBe("opus-5-5");
  });

  test.each([
    ["anthropic", "claude-sonnet-5-5"],
    ["bedrock", "us.anthropic.claude-sonnet-5-5"],
    ["mantle", "anthropic.claude-sonnet-5-5"],
    ["unknown", "claude-sonnet-5-5"],
    [undefined, "claude-sonnet-5-5"],
  ] as const)("resolves Sonnet 5.5 for provider %s", (provider, runModel) => {
    const availableClis = [{ type: "claude-code" as const, version: "2.1.284", provider }];
    expect(resolveCliRunModel({ cliType: "claude-code", cliModel: "sonnet-5-5", availableClis })).toBe(runModel);
    const options = getCliModelOptions({ cliType: "claude-code", availableClis });
    expect(options.find((option) => option.value === "sonnet-5-5")).toMatchObject({ label: "Sonnet 5.5", runModel });
    expect(options.findIndex((option) => option.value === "sonnet-5-5")).toBe(
      options.findIndex((option) => option.value === "sonnet-1m") + 1,
    );
    expect(normalizeCliModelForStorage({ cliType: "claude-code", cliModel: "sonnet-5-5" })).toBe("sonnet-5-5");
  });

  test("resolves Sonnet 5.5 for Cursor", () => {
    expect(resolveCliRunModel({ cliType: "cursor", cliModel: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
    expect(getCliModelOption({ cliType: "cursor", value: "claude-sonnet-5-5" })).toMatchObject({ label: "Sonnet 5.5" });
  });

  test.each([
    ["anthropic", "claude-haiku-5-5"],
    ["bedrock", "us.anthropic.claude-haiku-5-5"],
    ["mantle", "anthropic.claude-haiku-5-5"],
    ["unknown", "claude-haiku-5-5"],
    [undefined, "claude-haiku-5-5"],
  ] as const)("resolves Haiku 5.5 for provider %s", (provider, runModel) => {
    const availableClis = [{ type: "claude-code" as const, version: "2.1.293", provider }];
    expect(resolveCliRunModel({ cliType: "claude-code", cliModel: "haiku-5-5", availableClis })).toBe(runModel);
    const options = getCliModelOptions({ cliType: "claude-code", availableClis });
    expect(options.find((option) => option.value === "haiku-5-5")).toMatchObject({ label: "Haiku 5.5", runModel });
    expect(options.findIndex((option) => option.value === "haiku-5-5")).toBe(
      options.findIndex((option) => option.value === "fable") + 1,
    );
    expect(normalizeCliModelForStorage({ cliType: "claude-code", cliModel: "haiku-5-5" })).toBe("haiku-5-5");
  });

  test("resolves Haiku 5.5 for Cursor", () => {
    expect(resolveCliRunModel({ cliType: "cursor", cliModel: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
    expect(getCliModelOption({ cliType: "cursor", value: "claude-haiku-5-5" })).toMatchObject({ label: "Haiku 5.5" });
  });

  test.each([
    ["anthropic", "claude-fable-5-2"],
    ["bedrock", "us.anthropic.claude-fable-5-2"],
    ["mantle", "anthropic.claude-fable-5-2"],
    ["unknown", "claude-fable-5-2"],
    [undefined, "claude-fable-5-2"],
  ] as const)("resolves Fable 5.2 for provider %s", (provider, runModel) => {
    const availableClis = [{ type: "claude-code" as const, version: "2.1.321", provider }];
    expect(resolveCliRunModel({ cliType: "claude-code", cliModel: "fable-5-2", availableClis })).toBe(runModel);
    const options = getCliModelOptions({ cliType: "claude-code", availableClis });
    expect(options.find((option) => option.value === "fable-5-2")).toMatchObject({ label: "Fable 5.2", runModel });
    expect(options.findIndex((option) => option.value === "fable-5-2")).toBe(
      options.findIndex((option) => option.value === "fable-5-1") - 1,
    );
    expect(normalizeCliModelForStorage({ cliType: "claude-code", cliModel: "fable-5-2" })).toBe("fable-5-2");
  });

  test("resolves Fable 5.2 for Cursor", () => {
    expect(resolveCliRunModel({ cliType: "cursor", cliModel: "claude-fable-5-2" })).toBe("claude-fable-5-2");
    expect(getCliModelOption({ cliType: "cursor", value: "claude-fable-5-2" })).toMatchObject({ label: "Fable 5.2" });
  });

  test("resolves Opus 5.5 for Cursor and discovered OpenCode models", () => {
    expect(resolveCliRunModel({ cliType: "cursor", cliModel: "claude-opus-5-5" })).toBe("claude-opus-5-5");
    expect(getCliModelOption({ cliType: "cursor", value: "claude-opus-5-5" })).toMatchObject({ label: "Opus 5.5" });
    expect(resolveCliRunModel({ cliType: "opencode", cliModel: "anthropic/claude-opus-5-5" })).toBe("anthropic/claude-opus-5-5");
  });

  test("resolves Opus 5 run models per provider", () => {
    const forProvider = (provider: "anthropic" | "bedrock" | "mantle") =>
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-5",
        availableClis: [{ type: "claude-code", version: "2.1.52", provider }],
      });

    expect(forProvider("anthropic")).toBe("claude-opus-5");
    expect(forProvider("bedrock")).toBe("us.anthropic.claude-opus-5");
    expect(forProvider("mantle")).toBe("anthropic.claude-opus-5");
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-5",
        availableClis: [{ type: "claude-code", version: "2.1.52" }],
      }),
    ).toBe("claude-opus-5");
  });

  test("resolves Fable 5.1 run models per provider", () => {
    const forProvider = (provider: "anthropic" | "bedrock" | "mantle") =>
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "fable-5-1",
        availableClis: [{ type: "claude-code", version: "2.1.52", provider }],
      });

    expect(forProvider("anthropic")).toBe("claude-fable-5-1");
    expect(forProvider("bedrock")).toBe("us.anthropic.claude-fable-5-1");
    expect(forProvider("mantle")).toBe("anthropic.claude-fable-5-1");
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "fable-5-1",
        availableClis: [{ type: "claude-code", version: "2.1.52" }],
      }),
    ).toBe("claude-fable-5-1");
  });

  test("returns undefined for Claude default model", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "default",
        availableClis: [
          {
            type: "claude-code",
            version: "2.1.52",
            provider: "anthropic",
          },
        ],
      }),
    ).toBeUndefined();
  });

  test("returns undefined for generic runtimes without run-model mapping", () => {
    expect(
      resolveCliRunModel({
        cliType: "amp",
        cliModel: "opus",
        availableClis: [{ type: "amp", version: "0.0.1" }],
      }),
    ).toBeUndefined();
  });

  test("resolves Codex run models through the registry", () => {
    expect(
      normalizeCliModelForStorage({ cliType: "codex", cliModel: "gpt-6-astra" }),
    ).toBe("gpt-6-astra");
    for (const cliModel of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"]) {
      expect(resolveCliRunModel({ cliType: "codex", cliModel })).toBe(cliModel);
    }
    expect(
      resolveCliRunModel({
        cliType: "codex",
        cliModel: "gpt-5.4-mini",
        availableClis: [{ type: "codex", version: "0.142.3" }],
      }),
    ).toBe("gpt-5.4-mini");
    expect(
      resolveCliRunModel({
        cliType: "codex",
        cliModel: "default",
        availableClis: [{ type: "codex", version: "0.142.3" }],
      }),
    ).toBeUndefined();
    // Unknown stored values never leak into `codex exec --model`.
    expect(
      resolveCliRunModel({
        cliType: "codex",
        cliModel: "opus",
        availableClis: [{ type: "codex", version: "0.142.3" }],
      }),
    ).toBeUndefined();
  });

  test("provides Codex model options through the registry", () => {
    const options = getCliModelOptions({ cliType: "codex" });
    expect(options.map((option) => option.value)).toEqual([
      "default",
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(options.find((option) => option.value === "gpt-6-astra")?.label).toBe(
      "GPT-6 Astra",
    );
    expect(options.find((option) => option.value === "gpt-6.1-sol")?.label).toBe(
      "GPT-6.1 Sol",
    );
    expect(options.find((option) => option.value === "gpt-6-sol")?.label).toBe(
      "GPT-6 Sol",
    );
    expect(options.find((option) => option.value === "gpt-6-luna")?.label).toBe(
      "GPT-6 Luna",
    );
  });

  test("resolves OpenCode run models through the registry", () => {
    expect(
      resolveCliRunModel({
        cliType: "opencode",
        cliModel: "anthropic/claude-sonnet-5",
        availableClis: [{ type: "opencode", version: "1.14.19" }],
      }),
    ).toBe("anthropic/claude-sonnet-5");
    expect(
      resolveCliRunModel({
        cliType: "opencode",
        cliModel: "default",
        availableClis: [{ type: "opencode", version: "1.14.19" }],
      }),
    ).toBeUndefined();
    // Values that are not provider/model slugs never leak into the run.
    expect(
      resolveCliRunModel({
        cliType: "opencode",
        cliModel: "opus",
        availableClis: [{ type: "opencode", version: "1.14.19" }],
      }),
    ).toBeUndefined();
  });

  test("provides OpenCode model options from the advertised inventory", () => {
    expect(
      getCliModelOptions({ cliType: "opencode" }).map((option) => option.value),
    ).toEqual(["default"]);

    const options = getCliModelOptions({
      cliType: "opencode",
      availableClis: [
        {
          type: "opencode",
          version: "1.14.19",
          models: [
            {
              slug: "anthropic/claude-sonnet-5",
              name: "Claude Sonnet 5",
            },
            {
              slug: "openai/gpt-5.5",
              name: "GPT-5.5",
            },
          ],
        },
      ],
    });
    expect(options.map((option) => option.value)).toEqual([
      "default",
      "anthropic/claude-sonnet-5",
      "openai/gpt-5.5",
    ]);
    expect(options[1]).toMatchObject({
      label: "Claude Sonnet 5",
      runModel: "anthropic/claude-sonnet-5",
    });
  });

  test("resolves stale OpenCode model selections to a labeled option", () => {
    expect(
      getCliModelOption({
        cliType: "opencode",
        value: "anthropic/claude-3-5-sonnet",
        availableClis: [{ type: "opencode", version: "1.14.19", models: [] }],
      }),
    ).toMatchObject({
      value: "anthropic/claude-3-5-sonnet",
      label: "claude-3-5-sonnet",
      runModel: "anthropic/claude-3-5-sonnet",
    });
  });

  test("falls back to the generic Claude alias when provider metadata is missing", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "sonnet-1m",
        availableClis: [{ type: "claude-code", version: "2.1.52" }],
      }),
    ).toBe("sonnet[1m]");
  });

  test("falls back to the explicit Anthropic-compatible Opus 4.7 name when provider metadata is missing", () => {
    expect(
      resolveCliRunModel({
        cliType: "claude-code",
        cliModel: "opus-4-7",
        availableClis: [{ type: "claude-code", version: "2.1.52" }],
      }),
    ).toBe("claude-opus-4-7");
  });

  test.each([
    ["claude-code", "opus", "Opus", "opus"],
    ["claude-code", "opus-1m", "Opus (1M)", "opus[1m]"],
    ["claude-code", "haiku", "Haiku", "haiku"],
    ["cursor", "claude-opus-4-8", "Opus 4.8", "claude-opus-4-8"],
    ["codex", "gpt-5.5", "GPT-5.5", "gpt-5.5"],
    ["codex", "gpt-5.4", "GPT-5.4", "gpt-5.4"],
    ["codex", "gpt-5.4-mini", "GPT-5.4 Mini", "gpt-5.4-mini"],
    ["codex", "gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", "gpt-5.3-codex-spark"],
  ] as const)("hides retired %s model %s while resolving stored selections", (cliType, value, label, runModel) => {
    expect(getCliModelOptions({ cliType }).map((option) => option.value)).not.toContain(value);
    expect(getCliModelOption({ cliType, value })).toMatchObject({ label, runModel });
    expect(resolveCliRunModel({ cliType, cliModel: value })).toBe(runModel);
    expect(normalizeCliModelForStorage({ cliType, cliModel: value })).toBe(value);
  });

  test("provides provider-aware Claude model options through the registry", () => {
    const options = getCliModelOptions({
      cliType: "claude-code",
      availableClis: [
        {
          type: "claude-code",
          version: "2.1.52",
          provider: "bedrock",
        },
      ],
    });

    expect(options.find((option) => option.value === "sonnet-1m")?.label).toBe(
      "Sonnet 5 (1M)",
    );
    expect(options.find((option) => option.value === "opus")).toBeUndefined();
    expect(options.find((option) => option.value === "opus-1m")).toBeUndefined();
    expect(options.find((option) => option.value === "opus-5")?.label).toBe(
      "Opus 5",
    );
    expect(options.find((option) => option.value === "fable")?.label).toBe(
      "Fable 5",
    );
    expect(options.find((option) => option.value === "fable-5-1")?.label).toBe(
      "Fable 5.1",
    );
    // Retired slots are no longer offered as selectable options.
    expect(options.find((option) => option.value === "opus-4-7")).toBeUndefined();
  });

  test("exposes reasoning-effort catalogs for claude and codex only", () => {
    expect(
      getCliEffortOptions("claude-code").map((option) => option.value),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "ultracode"]);
    expect(
      resolveCliRunEffort({ cliType: "claude-code", cliEffort: "ultracode" }),
    ).toBe("ultracode");
    expect(
      getCliEffortOptions("codex").map((option) => option.value),
    ).toEqual(["default", "low", "medium", "high", "xhigh"]);
    expect(getCliEffortOptions("amp")).toEqual([]);
    expect(getDefaultCliEffort("claude-code")).toBe("default");
    expect(getDefaultCliEffort("amp")).toBeUndefined();
  });

  test("Codex exposes GPT-6 Astra and Sol reasoning levels", () => {
    for (const cliModel of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol"]) {
      expect(getCliEffortOptions("codex", { cliModel }).map((option) => option.value))
        .toEqual(["default", "low", "medium", "high", "xhigh", "max", "ultra"]);
    }
    const context = { cliModel: "gpt-6-astra" };

    for (const cliEffort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
      expect(isSupportedCliEffort("codex", cliEffort, context)).toBe(true);
      expect(normalizeCliEffortForStorage({ cliType: "codex", cliEffort }))
        .toBe(cliEffort);
      expect(resolveCliRunEffort({ cliType: "codex", cliEffort, context }))
        .toBe(cliEffort);
    }
    for (const cliEffort of ["none", "minimal", "bogus"]) {
      expect(isSupportedCliEffort("codex", cliEffort, context)).toBe(false);
      expect(resolveCliRunEffort({ cliType: "codex", cliEffort, context }))
        .toBeUndefined();
    }
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "default", context }))
      .toBeUndefined();
  });

  test("Codex offers max but not ultra for GPT-6 Luna", () => {
    const context = { cliModel: "gpt-6-luna" };
    expect(getCliEffortOptions("codex", context).map((option) => option.value))
      .toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "max", context }))
      .toBe("max");
    expect(isSupportedCliEffort("codex", "ultra", context)).toBe(false);
    expect(normalizeCliEffortForStorage({ cliType: "codex", cliEffort: "ultra", context }))
      .toBeUndefined();
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "ultra", context }))
      .toBeUndefined();
  });

  test("Codex drops GPT-6-only efforts when switching to another model", () => {
    for (const cliModel of ["gpt-5.5", "gpt-5.6-sol", "default", "unknown"]) {
      const context = { cliModel };
      expect(getCliEffortOptions("codex", context).map((option) => option.value))
        .toEqual(["default", "low", "medium", "high", "xhigh"]);
      for (const cliEffort of ["max", "ultra"]) {
        expect(isSupportedCliEffort("codex", cliEffort, context)).toBe(false);
        expect(normalizeCliEffortForStorage({ cliType: "codex", cliEffort, context }))
          .toBeUndefined();
        expect(resolveCliRunEffort({ cliType: "codex", cliEffort, context }))
          .toBeUndefined();
      }
    }
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "max" }))
      .toBeUndefined();
  });

  test("OpenCode effort options come from the selected model's advertised variants", () => {
    const availableClis = [
      {
        type: "opencode" as const,
        version: "1.17.13",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            variants: ["low", "high"],
          },
          {
            slug: "openai/gpt-5.5",
            name: "GPT-5.5",
          },
        ],
      },
    ];

    // No model context (or the default slot): no Reasoning section.
    expect(getCliEffortOptions("opencode")).toEqual([]);
    expect(
      getCliEffortOptions("opencode", { cliModel: "default", availableClis }),
    ).toEqual([]);
    // Advertised model without variants: no options either.
    expect(
      getCliEffortOptions("opencode", {
        cliModel: "openai/gpt-5.5",
        availableClis,
      }),
    ).toEqual([]);

    expect(
      getCliEffortOptions("opencode", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }).map((option) => option.value),
    ).toEqual(["default", "low", "high"]);
    expect(getDefaultCliEffort("opencode")).toBe("default");
  });

  test("resolves OpenCode run efforts against the advertised variants", () => {
    const availableClis = [
      {
        type: "opencode" as const,
        version: "1.17.13",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            variants: ["low", "high"],
          },
        ],
      },
    ];

    expect(
      resolveCliRunEffort({
        cliType: "opencode",
        cliEffort: "high",
        context: { cliModel: "anthropic/claude-sonnet-5", availableClis },
      }),
    ).toBe("high");
    expect(
      resolveCliRunEffort({
        cliType: "opencode",
        cliEffort: "default",
        context: { cliModel: "anthropic/claude-sonnet-5", availableClis },
      }),
    ).toBeUndefined();
    // A variant the advertised model does not offer never leaks into the run.
    expect(
      resolveCliRunEffort({
        cliType: "opencode",
        cliEffort: "turbo",
        context: { cliModel: "anthropic/claude-sonnet-5", availableClis },
      }),
    ).toBeUndefined();
    // Model not advertised (offline/stale): pass through, OpenCode decides.
    expect(
      resolveCliRunEffort({
        cliType: "opencode",
        cliEffort: "high",
        context: { cliModel: "anthropic/claude-3-5-sonnet", availableClis },
      }),
    ).toBe("high");
  });

  test("resolves run efforts via runtime dispatch", () => {
    expect(
      resolveCliRunEffort({ cliType: "claude-code", cliEffort: "high" }),
    ).toBe("high");
    expect(
      resolveCliRunEffort({ cliType: "claude-code", cliEffort: "default" }),
    ).toBeUndefined();
    expect(
      resolveCliRunEffort({ cliType: "claude-code", cliEffort: "minimal" }),
    ).toBeUndefined();
    expect(
      resolveCliRunEffort({ cliType: "codex", cliEffort: "minimal" }),
    ).toBeUndefined();
    expect(resolveCliRunEffort({ cliType: "codex", cliEffort: "low" })).toBe(
      "low",
    );
    expect(
      resolveCliRunEffort({ cliType: "amp", cliEffort: "high" }),
    ).toBeUndefined();
    expect(isSupportedCliEffort("codex", "xhigh")).toBe(true);
    expect(isSupportedCliEffort("codex", "max")).toBe(true);
  });

  test("effort support honors the model context for per-model catalogs", () => {
    const availableClis = [
      {
        type: "opencode" as const,
        version: "1.17.13",
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            variants: ["low", "high"],
          },
        ],
      },
    ];

    // Static catalogs ignore the context entirely.
    expect(
      isSupportedCliEffort("claude-code", "xhigh", { cliModel: "haiku" }),
    ).toBe(true);

    // OpenCode: judged against the selected advertised model's variants.
    expect(
      isSupportedCliEffort("opencode", "high", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toBe(true);
    expect(
      isSupportedCliEffort("opencode", "turbo", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toBe(false);
    // Unadvertised model (offline/stale) and no-context storage checks stay
    // lenient — OpenCode is the authority on its own variants.
    expect(
      isSupportedCliEffort("opencode", "turbo", {
        cliModel: "anthropic/claude-3-5-sonnet",
        availableClis,
      }),
    ).toBe(true);
    expect(isSupportedCliEffort("opencode", "turbo")).toBe(true);

    // Cursor: judged against the selected model's tier list.
    expect(
      isSupportedCliEffort("cursor", "thinking", {
        cliModel: "claude-sonnet-5",
      }),
    ).toBe(true);
    expect(
      isSupportedCliEffort("cursor", "thinking", { cliModel: "gpt-5.4" }),
    ).toBe(false);
    expect(isSupportedCliEffort("cursor", "thinking")).toBe(true);
  });

  test("storage normalization stays lenient for per-model catalogs", () => {
    // Storage keeps model and effort separate, so normalization never sees a
    // model context: a per-machine variant must survive the round-trip.
    expect(
      normalizeCliEffortForStorage({ cliType: "opencode", cliEffort: "turbo" }),
    ).toBe("turbo");
    expect(
      normalizeCliEffortForStorage({
        cliType: "cursor",
        cliEffort: "thinking",
      }),
    ).toBe("thinking");
    expect(
      normalizeCliEffortForStorage({
        cliType: "opencode",
        cliEffort: "two words",
      }),
    ).toBeUndefined();
  });

  test("builds resume commands via runtime dispatch", () => {
    expect(
      buildResumeCommand({
        cliType: "claude-code",
        continuationId: "session-123",
      }),
    ).toBe("claude --resume session-123");
    expect(
      buildResumeCommand({
        cliType: "codex",
        continuationId: "thread-123",
      }),
    ).toBe("codex resume thread-123");
    expect(
      buildResumeCommand({
        cliType: "opencode",
        continuationId: "ses_123",
      }),
    ).toBe("opencode --session ses_123");
    expect(
      buildResumeCommand({
        cliType: "amp",
        continuationId: "session-123",
      }),
    ).toBeNull();
  });

  test("extracts continuation ids via runtime dispatch", () => {
    expect(
      getContinuationIdFromIncomingChunks({
        cliType: "claude-code",
        chunks: [
          {
            type: "system",
            data: JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: "session-123",
            }),
          },
        ],
      }),
    ).toBe("session-123");

    expect(
      getContinuationIdFromIncomingChunks({
        cliType: "codex",
        chunks: [
          {
            type: "thread.started",
            data: JSON.stringify({
              type: "thread.started",
              thread_id: "thread-123",
            }),
          },
        ],
      }),
    ).toBe("thread-123");

    expect(
      getContinuationIdFromIncomingChunks({
        cliType: "opencode",
        chunks: [
          {
            type: "session.status",
            data: JSON.stringify({
              type: "session.status",
              properties: { sessionID: "ses_123", status: { type: "busy" } },
            }),
          },
        ],
      }),
    ).toBe("ses_123");

    expect(
      getContinuationIdFromIncomingChunks({
        cliType: "amp",
        chunks: [
          {
            type: "system",
            data: JSON.stringify({
              thread_id: "thread-123",
            }),
          },
        ],
      }),
    ).toBeNull();
  });

  test("reports local resume support via runtime dispatch", () => {
    expect(supportsResumeLocally("claude-code")).toBe(true);
    expect(supportsResumeLocally("codex")).toBe(true);
    expect(supportsResumeLocally("opencode")).toBe(true);
    expect(supportsResumeLocally("cursor")).toBe(true);
    expect(supportsResumeLocally("amp")).toBe(false);
  });

  test("parses Cursor available CLI payloads through the registry", () => {
    expect(
      parseAvailableCli({
        type: "cursor",
        version: "2025.09.18-7ae6800",
      }),
    ).toEqual({
      success: true,
      value: {
        type: "cursor",
        version: "2025.09.18-7ae6800",
      },
    });
  });

  test("provides Cursor model options and run models through the registry", () => {
    const options = getCliModelOptions({ cliType: "cursor" });
    expect(options.map((option) => option.value)).toEqual([
      "default",
      "auto",
      "composer-2.5",
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-fable-5-2",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-haiku-5-5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5-mini",
      "gpt-5.3-codex",
      "gemini-3.1-pro",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
      "glm-5.2",
      "kimi-k2.7-code",
      "grok-4.6",
      "grok-4.5",
      "grok-build-0.1",
    ]);

    // The default slot never leaks a --model value.
    expect(
      resolveCliRunModel({ cliType: "cursor", cliModel: "default" }),
    ).toBeUndefined();
    expect(
      resolveCliRunModel({ cliType: "cursor", cliModel: "claude-sonnet-5" }),
    ).toBe("claude-sonnet-5");
    expect(
      resolveCliRunModel({ cliType: "cursor", cliModel: "not-a-slot" }),
    ).toBeUndefined();
    expect(
      getCliModelOption({ cliType: "cursor", value: "claude-opus-4-8" }),
    ).toMatchObject({ label: "Opus 4.8" });
  });

  test("Cursor effort options depend on the selected model", () => {
    expect(getCliEffortOptions("cursor")).toEqual([]);
    expect(
      getCliEffortOptions("cursor", { cliModel: "composer-2.5" }),
    ).toEqual([]);
    expect(
      getCliEffortOptions("cursor", { cliModel: "claude-sonnet-5" }).map(
        (option) => option.value,
      ),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "thinking"]);
    expect(
      resolveCliRunEffort({
        cliType: "cursor",
        cliEffort: "thinking",
        context: { cliModel: "claude-sonnet-5" },
      }),
    ).toBe("thinking");
    expect(
      resolveCliRunEffort({
        cliType: "cursor",
        cliEffort: "thinking",
        context: { cliModel: "gpt-5.4" },
      }),
    ).toBeUndefined();
  });

  test("Cursor resume, continuation, and steering dispatch", () => {
    expect(
      buildResumeCommand({ cliType: "cursor", continuationId: "chat-1" }),
    ).toBe("cursor-agent --resume chat-1");
    expect(cliTypeSupportsSteering("cursor")).toBe(false);
    expect(
      getContinuationIdFromIncomingChunks({
        cliType: "cursor",
        chunks: [
          {
            type: "system",
            data: JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: "stale",
            }),
          },
          {
            type: "assistant",
            data: JSON.stringify({
              type: "assistant",
              session_id: "sess-live",
              message: { role: "assistant", content: [] },
            }),
          },
        ],
      }),
    ).toBe("sess-live");
  });
});
