import { describe, expect, test } from "vitest";
import {
  getCliModelOption,
  getCliModelOptions,
  isSupportedCliModel,
  normalizeCliModelForStorage,
  parseAvailableCli,
  resolveCliRunModel,
  type CliRuntimeAvailableCli,
} from "../registry";

// Shapes from agy 1.5.13's `configOptions` (docs/specs/cli-antigravity-runtime.md#models-and-thinking-level).
const availableClis: CliRuntimeAvailableCli[] = [
  {
    type: "antigravity",
    version: "1.5.13",
    models: [
      { slug: "gemini-3.8-flash", name: "Gemini 3.8 Flash", variants: ["low", "medium", "high"] },
      { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
    ],
  },
];

describe("antigravity models", () => {
  test("offers Default plus the advertised models", () => {
    expect(getCliModelOptions({ cliType: "antigravity", availableClis }).map((option) => [option.value, option.label])).toEqual([
      ["default", "Default"],
      ["gemini-3.8-flash", "Gemini 3.8 Flash"],
      ["gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"],
    ]);
    expect(getCliModelOptions({ cliType: "antigravity" }).map((option) => option.value)).toEqual(["default"]);
  });

  test("a stored id that is no longer advertised still resolves to a labeled option and runs as-is", () => {
    expect(getCliModelOption({ cliType: "antigravity", value: "gemini-retired", availableClis })).toMatchObject({
      value: "gemini-retired",
      label: "gemini-retired",
    });
    expect(resolveCliRunModel({ cliType: "antigravity", cliModel: "gemini-retired", availableClis })).toBe("gemini-retired");
  });

  test("default sends no model; malformed values normalize away", () => {
    expect(resolveCliRunModel({ cliType: "antigravity", cliModel: "default", availableClis })).toBeUndefined();
    expect(normalizeCliModelForStorage({ cliType: "antigravity", cliModel: "gemini-3.8-flash" })).toBe("gemini-3.8-flash");
    expect(normalizeCliModelForStorage({ cliType: "antigravity", cliModel: "two words" })).toBeUndefined();
    expect(isSupportedCliModel("antigravity", "")).toBe(false);
    expect(isSupportedCliModel("antigravity", "x".repeat(201))).toBe(false);
  });

  test("parses the advertised catalog fail-soft, and keeps an unknown catalog absent", () => {
    expect(
      parseAvailableCli({
        type: "antigravity",
        version: "1.5.13",
        models: [{ slug: "gemini-3.8-flash", name: "Gemini 3.8 Flash", variants: ["low"] }, { slug: 7 }],
      }),
    ).toEqual({
      success: true,
      value: { type: "antigravity", version: "1.5.13", models: [{ slug: "gemini-3.8-flash", name: "Gemini 3.8 Flash", variants: ["low"] }] },
    });
    expect(parseAvailableCli({ type: "antigravity", version: "1.5.13" })).toEqual({
      success: true,
      value: { type: "antigravity", version: "1.5.13" },
    });
  });
});
