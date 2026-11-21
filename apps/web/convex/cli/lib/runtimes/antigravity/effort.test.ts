import { describe, expect, test } from "vitest";
import {
  getCliEffortOptions,
  isSupportedCliEffort,
  normalizeCliEffortForStorage,
  resolveCliRunEffort,
  type CliRuntimeAvailableCli,
} from "../registry";

const availableClis: CliRuntimeAvailableCli[] = [
  {
    type: "antigravity",
    version: "1.5.13",
    models: [
      { slug: "gemini-4-neon", name: "Gemini 4 Neon", variants: ["low", "medium", "high", "xhigh"] },
      { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
    ],
  },
];
const on = (cliModel: string) => ({ cliModel, availableClis });

describe("antigravity thinking level", () => {
  test("a model with levels shows Default first, then its levels", () => {
    expect(getCliEffortOptions("antigravity", on("gemini-4-neon")).map((option) => [option.value, option.label])).toEqual([
      ["default", "Default"],
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      ["xhigh", "Extra high"],
    ]);
  });

  test("no section for the Default slot, a model without levels or an unadvertised model", () => {
    expect(getCliEffortOptions("antigravity", on("default"))).toEqual([]);
    expect(getCliEffortOptions("antigravity", on("gpt-oss-120b-medium"))).toEqual([]);
    expect(getCliEffortOptions("antigravity", on("gemini-retired"))).toEqual([]);
  });

  test("an advertised model accepts only its own levels", () => {
    expect(isSupportedCliEffort("antigravity", "xhigh", on("gemini-4-neon"))).toBe(true);
    expect(isSupportedCliEffort("antigravity", "default", on("gemini-4-neon"))).toBe(true);
    expect(isSupportedCliEffort("antigravity", "ultra", on("gemini-4-neon"))).toBe(false);
    expect(isSupportedCliEffort("antigravity", "high", on("gpt-oss-120b-medium"))).toBe(false);
  });

  test("lenient without a model or for an unadvertised one, so a per-machine level round-trips", () => {
    expect(isSupportedCliEffort("antigravity", "high")).toBe(true);
    expect(isSupportedCliEffort("antigravity", "high", on("gemini-retired"))).toBe(true);
    expect(normalizeCliEffortForStorage({ cliType: "antigravity", cliEffort: "two words" })).toBeUndefined();
  });

  test("run resolution drops levels the advertised model lacks and passes the rest through", () => {
    const resolve = (cliEffort: string, cliModel: string) =>
      resolveCliRunEffort({ cliType: "antigravity", cliEffort, context: on(cliModel) });
    expect(resolve("high", "gemini-4-neon")).toBe("high");
    expect(resolve("default", "gemini-4-neon")).toBeUndefined();
    expect(resolve("high", "gpt-oss-120b-medium")).toBeUndefined();
    expect(resolve("high", "gemini-retired")).toBe("high");
  });
});
