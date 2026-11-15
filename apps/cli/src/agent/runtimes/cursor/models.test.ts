import { describe, expect, it } from "vitest";
import { isCursorModelSlot, resolveCursorModelName } from "./models.js";

describe("isCursorModelSlot", () => {
  it("accepts Sonnet 5.5 and sends its base ID without unverified effort variants", () => {
    expect(isCursorModelSlot("claude-sonnet-5-5")).toBe(true);
    for (const effort of [undefined, "default", "high", "thinking"]) {
      expect(resolveCursorModelName("claude-sonnet-5-5", effort)).toBe("claude-sonnet-5-5");
    }
  });

  it("accepts Haiku 5.5 and sends its base ID without unverified effort variants", () => {
    expect(isCursorModelSlot("claude-haiku-5-5")).toBe(true);
    for (const effort of [undefined, "default", "high", "thinking"]) {
      expect(resolveCursorModelName("claude-haiku-5-5", effort)).toBe("claude-haiku-5-5");
    }
  });

  it("accepts Fable 5.2 and sends its base ID without unverified effort variants", () => {
    expect(isCursorModelSlot("claude-fable-5-2")).toBe(true);
    for (const effort of [undefined, "default", "high", "thinking"]) {
      expect(resolveCursorModelName("claude-fable-5-2", effort)).toBe("claude-fable-5-2");
    }
  });

  it("accepts Opus 5.5 and sends its base ID without unverified effort variants", () => {
    expect(isCursorModelSlot("claude-opus-5-5")).toBe(true);
    for (const effort of [undefined, "default", "high", "thinking"]) {
      expect(resolveCursorModelName("claude-opus-5-5", effort)).toBe("claude-opus-5-5");
    }
  });

  it("accepts curated slots and rejects everything else", () => {
    expect(isCursorModelSlot("default")).toBe(true);
    expect(isCursorModelSlot("claude-sonnet-5")).toBe(true);
    expect(isCursorModelSlot("claude-opus-5")).toBe(true);
    expect(isCursorModelSlot("claude-fable-5-1")).toBe(true);
    expect(isCursorModelSlot("gpt-5.6-sol")).toBe(true);
    expect(isCursorModelSlot("gemini-3.7-flash")).toBe(true);
    expect(isCursorModelSlot("grok-4.6")).toBe(true);
    expect(isCursorModelSlot("composer-2.5")).toBe(true);
    expect(isCursorModelSlot("claude-sonnet-5-thinking-high")).toBe(false);
    expect(isCursorModelSlot(42)).toBe(false);
  });
});

describe("resolveCursorModelName", () => {
  it("resolves anthropic base ids to the canonical -high tier", () => {
    expect(resolveCursorModelName("claude-sonnet-5")).toBe(
      "claude-sonnet-5-high",
    );
    expect(resolveCursorModelName("claude-opus-4-8", "default")).toBe(
      "claude-opus-4-8-high",
    );
  });

  it("suffixes anthropic effort tiers and thinking variants", () => {
    expect(resolveCursorModelName("claude-sonnet-5", "max")).toBe(
      "claude-sonnet-5-max",
    );
    expect(resolveCursorModelName("claude-fable-5", "medium")).toBe(
      "claude-fable-5-medium",
    );
    expect(resolveCursorModelName("claude-sonnet-5", "thinking")).toBe(
      "claude-sonnet-5-thinking-high",
    );
    expect(resolveCursorModelName("claude-opus-4-8", "bogus")).toBe(
      "claude-opus-4-8-high",
    );
  });

  it("maps gpt-5.5 tiers including the extra-high spelling", () => {
    expect(resolveCursorModelName("gpt-5.5")).toBe("gpt-5.5-medium");
    expect(resolveCursorModelName("gpt-5.5", "low")).toBe("gpt-5.5-low");
    expect(resolveCursorModelName("gpt-5.5", "high")).toBe("gpt-5.5-high");
    expect(resolveCursorModelName("gpt-5.5", "xhigh")).toBe(
      "gpt-5.5-extra-high",
    );
  });

  it("maps gpt-5.4 tiers with -medium as the canonical default", () => {
    expect(resolveCursorModelName("gpt-5.4")).toBe("gpt-5.4-medium");
    expect(resolveCursorModelName("gpt-5.4", "xhigh")).toBe("gpt-5.4-xhigh");
  });

  it("treats the unsuffixed codex base name as its medium tier", () => {
    expect(resolveCursorModelName("gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(resolveCursorModelName("gpt-5.3-codex", "low")).toBe(
      "gpt-5.3-codex-low",
    );
    expect(resolveCursorModelName("gpt-5.3-codex", "xhigh")).toBe(
      "gpt-5.3-codex-xhigh",
    );
  });

  it("maps glm to its two tiers with -high as the canonical default", () => {
    expect(resolveCursorModelName("glm-5.2")).toBe("glm-5.2-high");
    expect(resolveCursorModelName("glm-5.2", "max")).toBe("glm-5.2-max");
    expect(resolveCursorModelName("glm-5.2", "bogus")).toBe("glm-5.2-high");
  });

  it("uses parameterized effort overrides for current Cursor models", () => {
    expect(resolveCursorModelName("claude-opus-5")).toBe("claude-opus-5");
    expect(resolveCursorModelName("claude-opus-5", "thinking")).toBe(
      "claude-opus-5[thinking=true,effort=high]",
    );
    expect(resolveCursorModelName("claude-fable-5-1")).toBe(
      "claude-fable-5-1",
    );
    expect(resolveCursorModelName("claude-fable-5-1", "xhigh")).toBe(
      "claude-fable-5-1[effort=xhigh]",
    );
    expect(resolveCursorModelName("claude-fable-5-1", "thinking")).toBe(
      "claude-fable-5-1[thinking=true,effort=high]",
    );
    expect(resolveCursorModelName("gpt-5.6-sol", "xhigh")).toBe(
      "gpt-5.6-sol[effort=xhigh]",
    );
    expect(resolveCursorModelName("gpt-5.6-sol", "bogus")).toBe("gpt-5.6-sol");
    expect(resolveCursorModelName("grok-4.6", "low")).toBe(
      "grok-4.6[effort=low]",
    );
  });

  it("passes plain ids through unchanged", () => {
    expect(resolveCursorModelName("auto", "high")).toBe("auto");
    expect(resolveCursorModelName("composer-2.5")).toBe("composer-2.5");
    expect(resolveCursorModelName("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(resolveCursorModelName("gemini-3.7-flash")).toBe("gemini-3.7-flash");
    expect(resolveCursorModelName("gpt-5-mini", "high")).toBe("gpt-5-mini");
    expect(resolveCursorModelName("kimi-k2.7-code")).toBe("kimi-k2.7-code");
    expect(resolveCursorModelName("grok-build-0.1")).toBe("grok-build-0.1");
  });
});
