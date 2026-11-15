import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_PROVIDER_ENV_VAR,
  applyProviderKeyEnv,
  buildProviderKeyEnv,
  buildProviderSettingsJson,
  resolveProfileProviderKey,
  resolveProviderKeyByName,
} from "./provider-keys.js";
import { ProviderKeySchema } from "./types.js";

vi.mock("./toml.js", () => ({
  getProviderKey: (name: string) =>
    name === "work-bedrock"
      ? { provider: "bedrock", token: "tok", region: "us-east-1" }
      : name === "no-region"
        ? { provider: "mantle", token: "tok" }
        : undefined,
}));

describe("resolveProviderKeyByName", () => {
  it("resolves an existing key by name", () => {
    expect(resolveProviderKeyByName("work-bedrock")).toEqual({
      name: "work-bedrock",
      key: { provider: "bedrock", token: "tok", region: "us-east-1" },
    });
  });

  it("throws for a missing key", () => {
    expect(() => resolveProviderKeyByName("nope")).toThrow(
      /Provider key "nope" is not defined/
    );
  });
});

describe("buildProviderKeyEnv", () => {
  it("builds bedrock env with explicit flags", () => {
    expect(
      buildProviderKeyEnv({ provider: "bedrock", token: "tok", region: "us-east-1" })
    ).toEqual({
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_MANTLE: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
      CLAUDE_CODE_USE_FOUNDRY: "0",
      AWS_BEARER_TOKEN_BEDROCK: "tok",
      AWS_REGION: "us-east-1",
    });
  });

  it("builds mantle env and omits region when unset", () => {
    expect(buildProviderKeyEnv({ provider: "mantle", token: "tok" })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_MANTLE: "1",
      CLAUDE_CODE_USE_VERTEX: "0",
      CLAUDE_CODE_USE_FOUNDRY: "0",
      AWS_BEARER_TOKEN_BEDROCK: "tok",
    });
  });

  it("builds a credential-free opt-out env for anthropic", () => {
    // No token: an inherited AWS_BEARER_TOKEN_BEDROCK is ignored by Claude
    // Code while both flags are "0", and these flags ride the --settings
    // layer, so a Bedrock-pinned settings.json cannot win.
    expect(buildProviderKeyEnv({ provider: "anthropic" })).toEqual({
      CLAUDE_CODE_USE_BEDROCK: "0",
      CLAUDE_CODE_USE_MANTLE: "0",
      CLAUDE_CODE_USE_VERTEX: "0",
      CLAUDE_CODE_USE_FOUNDRY: "0",
    });
  });
});

describe("ProviderKeySchema", () => {
  it("accepts an anthropic entry without a token", () => {
    expect(ProviderKeySchema.parse({ provider: "anthropic" })).toEqual({
      provider: "anthropic",
    });
  });

  it("rejects a bedrock entry without a token", () => {
    const result = ProviderKeySchema.safeParse({ provider: "bedrock" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/requires a token/);
  });
});

describe("provider env settings layer", () => {
  const env = buildProviderKeyEnv({ provider: "bedrock", token: "tok" });

  afterEach(() => {
    delete process.env[CLAUDE_PROVIDER_ENV_VAR];
    for (const name of Object.keys(env)) {
      delete process.env[name];
    }
  });

  it("applyProviderKeyEnv sets the vars and the settings marker", () => {
    applyProviderKeyEnv(env);
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(process.env[CLAUDE_PROVIDER_ENV_VAR]).toBe(JSON.stringify(env));
  });

  it("round-trips the marker into a --settings env payload", () => {
    // Claude Code applies settings.json env over process env, so the runner
    // must re-send the provider env via --settings, which outranks it.
    expect(buildProviderSettingsJson(JSON.stringify(env))).toBe(
      JSON.stringify({ env })
    );
  });

  it("returns undefined for an absent, malformed, or empty marker", () => {
    expect(buildProviderSettingsJson(undefined)).toBeUndefined();
    expect(buildProviderSettingsJson("not json")).toBeUndefined();
    expect(buildProviderSettingsJson("{}")).toBeUndefined();
    expect(buildProviderSettingsJson('{"X":1}')).toBeUndefined();
  });
});

describe("Codex provider keys (OS-2105)", () => {
  const profile = { name: "A", url: "https://example.com", api_key: "k", project_id: "p", paths: ["/a"] };

  it("resolves each runtime from its own profile field", () => {
    const assigned = { ...profile, provider_key: "no-region", codex_provider_key: "work-bedrock" };
    expect(resolveProfileProviderKey(assigned)?.name).toBe("no-region");
    expect(resolveProfileProviderKey(assigned, "codex")).toEqual({
      name: "work-bedrock",
      key: { provider: "bedrock", token: "tok", region: "us-east-1" },
    });
    expect(resolveProfileProviderKey({ ...profile, provider_key: "work-bedrock" }, "codex")).toBeUndefined();
  });

  it("refuses a Codex key that lost its region", () => {
    expect(() => resolveProfileProviderKey({ ...profile, codex_provider_key: "no-region" }, "codex")).toThrow(/region/i);
  });

  it("restores the machine env that the Claude override replaced", async () => {
    vi.stubEnv("AWS_REGION", "eu-west-1");
    vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", undefined);
    vi.resetModules();
    const fresh = await import("./provider-keys.js");
    try {
      fresh.applyProviderKeyEnv(buildProviderKeyEnv({ provider: "mantle", token: "claude-token", region: "us-east-1" }));
      const env = fresh.withoutClaudeProviderEnv(process.env);
      expect(env.AWS_REGION).toBe("eu-west-1");
      expect(env.AWS_BEARER_TOKEN_BEDROCK).toBeUndefined();
      expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
      expect(env[CLAUDE_PROVIDER_ENV_VAR]).toBeUndefined();
      expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe("claude-token");
    } finally {
      for (const name of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_MANTLE", CLAUDE_PROVIDER_ENV_VAR]) {
        delete process.env[name];
      }
      vi.unstubAllEnvs();
    }
  });
});
