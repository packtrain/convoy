import { describe, expect, test } from "vitest";
import {
  getCursorEffortOptions,
  isCursorEffortSupported,
  normalizeCursorStoredEffort,
  resolveCursorRunEffort,
} from "./effort";

describe("cursor effort", () => {
  test("Sonnet 5.5 uses runtime defaults until CLI effort variants are verified", () => {
    expect(getCursorEffortOptions({ cliModel: "claude-sonnet-5-5" })).toEqual([]);
    expect(resolveCursorRunEffort("high", { cliModel: "claude-sonnet-5-5" })).toBeUndefined();
    expect(isCursorEffortSupported("thinking", { cliModel: "claude-sonnet-5-5" })).toBe(false);
  });

  test("Haiku 5.5 uses runtime defaults until CLI effort variants are verified", () => {
    expect(getCursorEffortOptions({ cliModel: "claude-haiku-5-5" })).toEqual([]);
    expect(resolveCursorRunEffort("high", { cliModel: "claude-haiku-5-5" })).toBeUndefined();
    expect(isCursorEffortSupported("thinking", { cliModel: "claude-haiku-5-5" })).toBe(false);
  });

  test("Fable 5.2 uses runtime defaults until CLI effort variants are verified", () => {
    expect(getCursorEffortOptions({ cliModel: "claude-fable-5-2" })).toEqual([]);
    expect(resolveCursorRunEffort("high", { cliModel: "claude-fable-5-2" })).toBeUndefined();
    expect(isCursorEffortSupported("thinking", { cliModel: "claude-fable-5-2" })).toBe(false);
  });

  test("Opus 5.5 uses runtime defaults until CLI effort variants are verified", () => {
    expect(getCursorEffortOptions({ cliModel: "claude-opus-5-5" })).toEqual([]);
    expect(resolveCursorRunEffort("high", { cliModel: "claude-opus-5-5" })).toBeUndefined();
    expect(isCursorEffortSupported("thinking", { cliModel: "claude-opus-5-5" })).toBe(false);
  });

  test("models without reasoning variants expose no options", () => {
    expect(getCursorEffortOptions({ cliModel: "default" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "auto" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "composer-2.5" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "gemini-3.1-pro" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "gemini-3.5-flash" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "gemini-3.7-flash" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "gpt-5-mini" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "kimi-k2.7-code" })).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "grok-build-0.1" })).toEqual([]);
    expect(getCursorEffortOptions(undefined)).toEqual([]);
    expect(getCursorEffortOptions({ cliModel: "not-a-slot" })).toEqual([]);
  });

  test("glm offers only the max tier beyond default", () => {
    expect(
      getCursorEffortOptions({ cliModel: "glm-5.2" }).map((o) => o.value),
    ).toEqual(["default", "max"]);
    expect(resolveCursorRunEffort("max", { cliModel: "glm-5.2" })).toBe("max");
    expect(
      resolveCursorRunEffort("high", { cliModel: "glm-5.2" }),
    ).toBeUndefined();
  });

  test("gpt models offer reasoning tiers", () => {
    expect(
      getCursorEffortOptions({ cliModel: "gpt-5.5" }).map((o) => o.value),
    ).toEqual(["default", "low", "high", "xhigh"]);
    expect(
      getCursorEffortOptions({ cliModel: "gpt-5.3-codex" }).map((o) => o.value),
    ).toEqual(["default", "low", "high", "xhigh"]);
    expect(
      getCursorEffortOptions({ cliModel: "gpt-5.6-sol" }).map((o) => o.value),
    ).toEqual(["default", "none", "low", "medium", "high", "xhigh", "max"]);
  });

  test("anthropic models offer effort tiers plus thinking", () => {
    expect(
      getCursorEffortOptions({ cliModel: "claude-sonnet-5" }).map(
        (o) => o.value,
      ),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "thinking"]);
    expect(
      getCursorEffortOptions({ cliModel: "claude-fable-5" }).map(
        (o) => o.value,
      ),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "thinking"]);
    expect(
      getCursorEffortOptions({ cliModel: "claude-opus-5" }).map(
        (o) => o.value,
      ),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "thinking"]);
    expect(
      getCursorEffortOptions({ cliModel: "claude-fable-5-1" }).map(
        (o) => o.value,
      ),
    ).toEqual(["default", "low", "medium", "high", "xhigh", "max", "thinking"]);
  });

  test("current Grok models expose their documented effort tiers", () => {
    expect(
      getCursorEffortOptions({ cliModel: "grok-4.6" }).map((o) => o.value),
    ).toEqual(["default", "low", "medium", "high", "xhigh"]);
    expect(
      getCursorEffortOptions({ cliModel: "grok-4.5" }).map((o) => o.value),
    ).toEqual(["default", "low", "medium", "high"]);
  });

  test("default never resolves to a run value", () => {
    expect(
      resolveCursorRunEffort("default", { cliModel: "gpt-5.5" }),
    ).toBeUndefined();
  });

  test("an effort the selected model does not offer never leaks into the run", () => {
    expect(
      resolveCursorRunEffort("thinking", { cliModel: "gpt-5.5" }),
    ).toBeUndefined();
    expect(
      resolveCursorRunEffort("max", { cliModel: "gpt-5.4" }),
    ).toBeUndefined();
    expect(
      resolveCursorRunEffort("high", { cliModel: "composer-2.5" }),
    ).toBeUndefined();
  });

  test("a supported effort resolves for its model", () => {
    expect(
      resolveCursorRunEffort("thinking", { cliModel: "claude-sonnet-5" }),
    ).toBe("thinking");
    expect(
      resolveCursorRunEffort("max", { cliModel: "claude-opus-4-8" }),
    ).toBe("max");
    expect(resolveCursorRunEffort("xhigh", { cliModel: "gpt-5.3-codex" })).toBe(
      "xhigh",
    );
  });

  test("stored efforts are single tokens", () => {
    expect(normalizeCursorStoredEffort("thinking")).toBe("thinking");
    expect(normalizeCursorStoredEffort("two words")).toBeUndefined();
    expect(normalizeCursorStoredEffort(undefined)).toBeUndefined();
  });

  test("support with a model context matches what the model offers", () => {
    expect(
      isCursorEffortSupported("thinking", { cliModel: "claude-sonnet-5" }),
    ).toBe(true);
    // A tier the selected model does not offer (stale value after a switch).
    expect(isCursorEffortSupported("thinking", { cliModel: "gpt-5.5" })).toBe(
      false,
    );
    expect(isCursorEffortSupported("max", { cliModel: "gpt-5.4" })).toBe(false);
    // A model with no reasoning tiers offers nothing but is still a context.
    expect(isCursorEffortSupported("high", { cliModel: "composer-2.5" })).toBe(
      false,
    );
    // `default` is offered by every model that has tiers.
    expect(isCursorEffortSupported("default", { cliModel: "gpt-5.5" })).toBe(
      true,
    );
  });

  test("support without a model context stays lenient", () => {
    // Storage normalization: model and effort are stored separately, so a pair
    // must round-trip even when the model's tiers are unknown here.
    expect(isCursorEffortSupported("thinking")).toBe(true);
    expect(isCursorEffortSupported("anything")).toBe(true);
    expect(isCursorEffortSupported("two words")).toBe(false);
    expect(isCursorEffortSupported(undefined)).toBe(false);
    // An empty context (no model resolved yet) is lenient too.
    expect(isCursorEffortSupported("thinking", {})).toBe(true);
  });
});
