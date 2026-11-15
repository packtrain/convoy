import { describe, expect, test } from "vitest";
import { extractOpencodeCostUsage } from "./costUsage";

function stepFinishChunk(part: Record<string, unknown>) {
  return {
    type: "message.part.updated",
    data: JSON.stringify({
      type: "message.part.updated",
      properties: { part: { type: "step-finish", ...part } },
    }),
  };
}

describe("extractOpencodeCostUsage", () => {
  test("sums step-finish parts and attributes to the stored model", () => {
    const usage = extractOpencodeCostUsage(
      [
        stepFinishChunk({
          id: "prt_1",
          cost: 0.01,
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 400, write: 50 },
          },
        }),
        stepFinishChunk({
          id: "prt_2",
          cost: 0.02,
          tokens: { input: 10, output: 30 },
        }),
      ],
      "claude-sonnet-5"
    );

    expect(usage).toEqual({
      costUsd: 0.03,
      reportedCost: true,
      byModel: [
        {
          model: "claude-sonnet-5",
          inputTokens: 100,
          cachedInputTokens: 450,
          outputTokens: 25,
          costUsd: 0.01,
          reportedCost: true,
          cacheReadTokens: 400,
          cacheWriteTokens: 50,
          quantitiesIncomplete: false,
        },
        {
          model: "claude-sonnet-5",
          inputTokens: 10,
          outputTokens: 30,
          costUsd: 0.02,
          cachedInputTokens: 0,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          reportedCost: true,
          quantitiesIncomplete: false,
        },
      ],
    });
  });

  test("dedupes re-emitted snapshots of the same part (last wins)", () => {
    const usage = extractOpencodeCostUsage(
      [
        stepFinishChunk({ id: "prt_1", cost: 0.005, tokens: { input: 5 } }),
        stepFinishChunk({ id: "prt_1", cost: 0.01, tokens: { input: 10 } }),
      ],
      undefined
    );

    expect(usage).toEqual({
      costUsd: 0.01,
      reportedCost: true,
      byModel: [
        {
          model: "unknown",
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          quantitiesIncomplete: true,
          costUsd: 0.01,
          reportedCost: true,
        },
      ],
    });
  });

  test("returns null without cost-bearing parts", () => {
    expect(extractOpencodeCostUsage([], "m")).toBeNull();
    expect(
      extractOpencodeCostUsage(
        [
          {
            type: "message.part.updated",
            data: JSON.stringify({
              properties: { part: { type: "text", text: "hi" } },
            }),
          },
        ],
        "m"
      )
    ).toBeNull();
  });

  test("preserves separate reported and absent step costs with available cache splits", () => {
    const result = extractOpencodeCostUsage(
      [
        stepFinishChunk({
          id: "1",
          cost: 0,
          tokens: { input: 10, output: 2, cache: { read: 3, write: 4 } },
        }),
        stepFinishChunk({ id: "2", tokens: { input: 10, output: 2 } }),
      ],
      "gpt-5.5"
    );
    expect(result).toMatchObject({
      reportedCost: false,
      byModel: [
        { costUsd: 0, reportedCost: true, cacheReadTokens: 3, cacheWriteTokens: 4 },
        { reportedCost: false },
      ],
    });
    expect(result?.byModel[1]?.cacheReadTokens).toBeUndefined();
  });

  test("empty step metadata does not record usage or count a run", () => {
    expect(extractOpencodeCostUsage([stepFinishChunk({ id: "empty" })], "gpt-5.5")).toBeNull();
  });
});
