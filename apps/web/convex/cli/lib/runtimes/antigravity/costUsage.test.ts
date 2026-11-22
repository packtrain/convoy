import { describe, expect, test } from "vitest";
import { extractAntigravityCostUsage } from "./costUsage";

// Recorded on agy 1.5.14 (2026-11-21): totalTokens = inputTokens + outputTokens + cachedReadTokens.
const recordedUsage = {
  inputTokens: 11378,
  outputTokens: 823,
  cachedReadTokens: 6588,
  cachedWriteTokens: 0,
  thoughtTokens: 616,
  totalTokens: 18789,
};

const promptResult = (payload: Record<string, unknown>) => ({
  type: "convoy/acp_prompt_result",
  data: JSON.stringify({ sessionId: "s1", stopReason: "end_turn", ...payload }),
});

describe("extractAntigravityCostUsage", () => {
  test("attributes the run's summed usage to the effective model, thoughts inside output", () => {
    expect(extractAntigravityCostUsage([promptResult({ model: "gemini-3.8-flash", usage: recordedUsage })])).toEqual({
      costUsd: 0,
      reportedCost: false,
      byModel: [
        {
          model: "gemini-3.8-flash",
          inputTokens: 11378,
          cachedInputTokens: 6588,
          cacheReadTokens: 6588,
          cacheWriteTokens: 0,
          outputTokens: 823,
          quantitiesIncomplete: false,
          costUsd: 0,
          reportedCost: false,
        },
      ],
    });
  });

  test("a CLI that sends no model records the tokens as unknown", () => {
    expect(extractAntigravityCostUsage([promptResult({ usage: recordedUsage })])?.byModel[0]?.model).toBe("unknown");
  });

  test("absent counters stay unknown instead of becoming zero", () => {
    const entry = extractAntigravityCostUsage([promptResult({ model: "gemini-4-neon", usage: { inputTokens: 10 } })])?.byModel[0];
    expect(entry).toMatchObject({ inputTokens: 10, outputTokens: 0, quantitiesIncomplete: true });
    expect(entry?.cacheReadTokens).toBeUndefined();
    expect(entry?.cacheWriteTokens).toBeUndefined();
  });

  test("records nothing without a prompt result or with zero usage", () => {
    expect(extractAntigravityCostUsage([{ type: "session/update", data: "{}" }])).toBeNull();
    expect(extractAntigravityCostUsage([promptResult({ model: "gemini-4-neon" })])).toBeNull();
    expect(extractAntigravityCostUsage([promptResult({ model: "gemini-4-neon", usage: { inputTokens: 0, outputTokens: 0 } })])).toBeNull();
    expect(extractAntigravityCostUsage([{ type: "convoy/acp_prompt_result", data: "not json" }])).toBeNull();
  });
});
