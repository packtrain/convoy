import { describe, expect, it } from "vitest";
import { isClaudeCodeModelSlot } from "./models.js";

describe("claude-model-catalog", () => {
  it("recognizes the explicit Sonnet 5.5 slot", () => {
    expect(isClaudeCodeModelSlot("sonnet-5-5")).toBe(true);
    expect(isClaudeCodeModelSlot("sonnet-5-5-1m")).toBe(false);
  });

  it("recognizes the explicit Haiku 5.5 slot", () => {
    expect(isClaudeCodeModelSlot("haiku-5-5")).toBe(true);
  });

  it("recognizes the explicit Fable 5.2 slot", () => {
    expect(isClaudeCodeModelSlot("fable-5-2")).toBe(true);
  });

  it("recognizes the explicit Opus 5.5 slot", () => {
    expect(isClaudeCodeModelSlot("opus-5-5")).toBe(true);
    expect(isClaudeCodeModelSlot("opus-5-5-1m")).toBe(false);
  });

  it("recognizes portable Claude model slots", () => {
    expect(isClaudeCodeModelSlot("default")).toBe(true);
    expect(isClaudeCodeModelSlot("sonnet-1m")).toBe(true);
    expect(isClaudeCodeModelSlot("opus-1m")).toBe(true);
    expect(isClaudeCodeModelSlot("opus-4-7")).toBe(true);
    expect(isClaudeCodeModelSlot("opus-4-7-1m")).toBe(true);
    expect(isClaudeCodeModelSlot("not-real")).toBe(false);
  });
});
