import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CLAUDE_PROVIDER_ENV_VAR } from "../../../lib/config/provider-keys.js";
import { detectProvider } from "./detect.js";

const MANTLE = "CLAUDE_CODE_USE_MANTLE";
const BEDROCK = "CLAUDE_CODE_USE_BEDROCK";
const BEDROCK_TOKEN = "AWS_BEARER_TOKEN_BEDROCK";
const PROVIDER_ENV = CLAUDE_PROVIDER_ENV_VAR;

describe("detectProvider", () => {
  const original = {
    [MANTLE]: process.env[MANTLE],
    [BEDROCK]: process.env[BEDROCK],
    [BEDROCK_TOKEN]: process.env[BEDROCK_TOKEN],
    [PROVIDER_ENV]: process.env[PROVIDER_ENV],
  };

  beforeEach(() => {
    delete process.env[MANTLE];
    delete process.env[BEDROCK];
    delete process.env[BEDROCK_TOKEN];
    delete process.env[PROVIDER_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("classifies Mantle even when Bedrock flags are also set", () => {
    // Mantle rides on top of Bedrock, so both flags are present.
    process.env[MANTLE] = "1";
    process.env[BEDROCK] = "1";
    process.env[BEDROCK_TOKEN] = "token";
    expect(detectProvider(null)).toBe("mantle");
  });

  test("detects Mantle from settings env", () => {
    expect(detectProvider({ env: { [MANTLE]: "1" } })).toBe("mantle");
  });

  test("falls back to bedrock without the Mantle flag", () => {
    process.env[BEDROCK] = "1";
    expect(detectProvider(null)).toBe("bedrock");
  });

  test("defaults to anthropic", () => {
    expect(detectProvider(null)).toBe("anthropic");
  });

  test("detects bedrock from a token when no flag is set", () => {
    expect(detectProvider({ env: { [BEDROCK_TOKEN]: "token" } })).toBe(
      "bedrock"
    );
  });

  test("explicit settings opt-out beats a stored bedrock token", () => {
    // A kept-around Mantle/Bedrock token with USE_BEDROCK=0 means Claude Code
    // still talks to claude.ai — the provider must not read as bedrock.
    expect(
      detectProvider({
        env: { [BEDROCK]: "0", [MANTLE]: "0", [BEDROCK_TOKEN]: "token" },
      })
    ).toBe("anthropic");
  });

  test("explicit process opt-out beats a settings token", () => {
    process.env[BEDROCK] = "0";
    expect(detectProvider({ env: { [BEDROCK_TOKEN]: "token" } })).toBe(
      "anthropic"
    );
  });

  test("injected provider-key env wins over a settings opt-out", () => {
    // `convoy connect` re-sends this env through `--settings`, which
    // outranks the user settings file inside Claude Code.
    process.env[PROVIDER_ENV] = JSON.stringify({ [BEDROCK]: "1" });
    expect(detectProvider({ env: { [BEDROCK]: "0" } })).toBe("bedrock");
  });

  test("a managed credential's env wins over process and settings env (OS-2108)", () => {
    process.env[PROVIDER_ENV] = JSON.stringify({ [BEDROCK]: "0", [MANTLE]: "0" });
    expect(detectProvider({ env: { [BEDROCK]: "0" } }, { [BEDROCK]: "1", [MANTLE]: "1" })).toBe("mantle");
  });

  test("an injected anthropic key forces claude.ai over a Bedrock machine", () => {
    // The `anthropic` provider key exists for exactly this case: settings
    // enable Mantle and a token is inherited, yet the run must be claude.ai.
    process.env[BEDROCK_TOKEN] = "token";
    process.env[PROVIDER_ENV] = JSON.stringify({ [BEDROCK]: "0", [MANTLE]: "0" });
    expect(
      detectProvider({ env: { [BEDROCK]: "1", [MANTLE]: "1" } })
    ).toBe("anthropic");
  });

  test("settings env wins over inherited process env", () => {
    // Devcontainer case: the host forwards opt-out flags, but Claude Code
    // applies the container's settings file on top of them and runs Mantle.
    process.env[BEDROCK] = "0";
    process.env[MANTLE] = "0";
    expect(
      detectProvider({ env: { [MANTLE]: "1", [BEDROCK_TOKEN]: "token" } })
    ).toBe("mantle");
  });

  test("explicit opt-out beats a bedrock default model", () => {
    expect(
      detectProvider({
        env: { [BEDROCK]: "0" },
        model: "us.anthropic.claude-sonnet-5",
      })
    ).toBe("anthropic");
  });
});
