import { describe, expect, test } from "vitest";
import type { CliRuntimeAvailableCli } from "../registry";
import {
  getOpencodeAdvertisedVariants,
  getOpencodeEffortOptions,
  isOpencodeEffortSupported,
  normalizeOpencodeStoredEffort,
  resolveOpencodeRunEffort,
} from "./effort";

const availableClis: CliRuntimeAvailableCli[] = [
  {
    type: "opencode",
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

describe("opencode effort", () => {
  test("advertised variants come from the selected model", () => {
    expect(
      getOpencodeAdvertisedVariants({
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toEqual(["low", "high"]);
    // Advertised without variants.
    expect(
      getOpencodeAdvertisedVariants({
        cliModel: "openai/gpt-5.5",
        availableClis,
      }),
    ).toEqual([]);
    // The default slot and unadvertised slugs have no known variant list.
    expect(
      getOpencodeAdvertisedVariants({ cliModel: "default", availableClis }),
    ).toBeUndefined();
    expect(
      getOpencodeAdvertisedVariants({
        cliModel: "anthropic/claude-3-5-sonnet",
        availableClis,
      }),
    ).toBeUndefined();
    expect(getOpencodeAdvertisedVariants(undefined)).toBeUndefined();
  });

  test("options are default plus the advertised variants", () => {
    expect(
      getOpencodeEffortOptions({
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }).map((option) => option.value),
    ).toEqual(["default", "low", "high"]);
    expect(
      getOpencodeEffortOptions({ cliModel: "openai/gpt-5.5", availableClis }),
    ).toEqual([]);
  });

  test("support with an advertised model matches its variants", () => {
    const context = {
      cliModel: "anthropic/claude-sonnet-5",
      availableClis,
    };

    expect(isOpencodeEffortSupported("high", context)).toBe(true);
    expect(isOpencodeEffortSupported("default", context)).toBe(true);
    // A variant the advertised model does not offer (stale value after a
    // model switch) is not supported for that model.
    expect(isOpencodeEffortSupported("turbo", context)).toBe(false);
    // An advertised model with no variants offers nothing at all.
    expect(
      isOpencodeEffortSupported("high", {
        cliModel: "openai/gpt-5.5",
        availableClis,
      }),
    ).toBe(false);
  });

  test("support stays lenient without an advertised variant list", () => {
    // No context / no model: storage normalization must let per-machine
    // variants round-trip.
    expect(isOpencodeEffortSupported("high")).toBe(true);
    expect(isOpencodeEffortSupported("anything")).toBe(true);
    expect(isOpencodeEffortSupported("two words")).toBe(false);
    expect(isOpencodeEffortSupported(undefined)).toBe(false);
    // Unadvertised model (offline machine, stale slug) and the default slot:
    // OpenCode is the authority, so the value passes through.
    expect(
      isOpencodeEffortSupported("turbo", {
        cliModel: "anthropic/claude-3-5-sonnet",
        availableClis,
      }),
    ).toBe(true);
    expect(
      isOpencodeEffortSupported("turbo", { cliModel: "default", availableClis }),
    ).toBe(true);
    // Model known but inventory missing (profile still loading).
    expect(
      isOpencodeEffortSupported("turbo", {
        cliModel: "anthropic/claude-sonnet-5",
      }),
    ).toBe(true);
  });

  test("stored efforts are single tokens", () => {
    expect(normalizeOpencodeStoredEffort("high")).toBe("high");
    expect(normalizeOpencodeStoredEffort("two words")).toBeUndefined();
    expect(normalizeOpencodeStoredEffort(undefined)).toBeUndefined();
  });

  test("run resolution drops variants the advertised model lacks", () => {
    expect(
      resolveOpencodeRunEffort("high", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toBe("high");
    expect(
      resolveOpencodeRunEffort("default", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toBeUndefined();
    expect(
      resolveOpencodeRunEffort("turbo", {
        cliModel: "anthropic/claude-sonnet-5",
        availableClis,
      }),
    ).toBeUndefined();
    // Unadvertised model: pass through.
    expect(
      resolveOpencodeRunEffort("high", {
        cliModel: "anthropic/claude-3-5-sonnet",
        availableClis,
      }),
    ).toBe("high");
  });
});
