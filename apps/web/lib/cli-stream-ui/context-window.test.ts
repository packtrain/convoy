import { describe, expect, test } from "vitest";
import {
  contextWindowSeverity,
  deriveLatestContextWindow,
  formatContextWindowPercentage,
  formatContextWindowTokens,
  toContextWindowUsage,
} from "./context-window";
import type { NormalizedChunkRow } from "./types";
import type { Id } from "@/convex/_generated/dataModel";

function cliMessageId(value: string): Id<"cliMessages"> {
  return value as Id<"cliMessages">;
}

function cliThreadId(value: string): Id<"cliThreads"> {
  return value as Id<"cliThreads">;
}

function makeRow(
  chunkOrder: number,
  event: NormalizedChunkRow["event"]
): NormalizedChunkRow {
  return {
    messageId: cliMessageId("message-1"),
    threadId: cliThreadId("thread-1"),
    createdAt: 1_000 + chunkOrder,
    chunkOrder,
    timestamp: 1_000 + chunkOrder,
    event,
  };
}

describe("context-window", () => {
  test("derives the latest valid context-window snapshot", () => {
    const snapshot = deriveLatestContextWindow([
      makeRow(0, {
        kind: "context-window",
        usedTokens: 120_000,
        maxTokens: 300_000,
      }),
      makeRow(1, { kind: "metadata", otherJson: JSON.stringify({ ok: true }) }),
      makeRow(2, {
        kind: "context-window",
        usedTokens: 150_000,
        maxTokens: 300_000,
        inputTokens: 1_000,
        cachedInputTokens: 120_000,
        outputTokens: 5_000,
      }),
    ]);

    expect(snapshot).toEqual({
      usedTokens: 150_000,
      maxTokens: 300_000,
      inputTokens: 1_000,
      cachedInputTokens: 120_000,
      outputTokens: 5_000,
    });
    expect(toContextWindowUsage(snapshot)).toEqual({
      usedTokens: 150_000,
      maxTokens: 300_000,
      remainingTokens: 150_000,
      usedPercentage: 50,
      remainingPercentage: 50,
      inputTokens: 1_000,
      cachedInputTokens: 120_000,
      outputTokens: 5_000,
    });
  });

  test("carries the newest max forward onto a max-less live event (OS-1900)", () => {
    const snapshot = deriveLatestContextWindow([
      makeRow(0, { kind: "context-window", usedTokens: 120_000, maxTokens: 300_000 }),
      makeRow(1, { kind: "context-window", usedTokens: 150_000 }),
    ]);

    expect(snapshot).toEqual({ usedTokens: 150_000, maxTokens: 300_000 });
  });

  test("uses the carried max when the loaded rows have none", () => {
    const snapshot = deriveLatestContextWindow(
      [makeRow(0, { kind: "context-window", usedTokens: 150_000 })],
      200_000
    );

    expect(snapshot).toEqual({ usedTokens: 150_000, maxTokens: 200_000 });
  });

  test("a snapshot without any max renders no usage", () => {
    const snapshot = deriveLatestContextWindow([
      makeRow(0, { kind: "context-window", usedTokens: 20_000, maxTokens: 0 }),
    ]);

    expect(snapshot).toEqual({ usedTokens: 20_000 });
    expect(toContextWindowUsage(snapshot)).toBeNull();
  });

  test("skips events without a positive used count", () => {
    expect(
      deriveLatestContextWindow([
        makeRow(0, { kind: "context-window", usedTokens: 0, maxTokens: 200_000 }),
      ])
    ).toBeNull();
  });

  test("reads bundled context-window events nested inside metadata", () => {
    const snapshot = deriveLatestContextWindow([
      makeRow(0, {
        kind: "metadata",
        otherJson: JSON.stringify({
          events: [
            {
              kind: "metadata",
              otherJson: JSON.stringify({ ok: true }),
            },
            {
              kind: "context-window",
              usedTokens: 87_009,
              maxTokens: 200_000,
              inputTokens: 11,
              cachedInputTokens: 86_360,
              outputTokens: 638,
            },
          ],
        }),
      }),
    ]);

    expect(toContextWindowUsage(snapshot)).toEqual({
      usedTokens: 87_009,
      maxTokens: 200_000,
      remainingTokens: 112_991,
      usedPercentage: 43.5045,
      remainingPercentage: 56.4955,
      inputTokens: 11,
      cachedInputTokens: 86_360,
      outputTokens: 638,
    });
  });

  test("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1_400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(2_300_000)).toBe("2.3m");
  });

  test("formats token counts across the million boundary cleanly", () => {
    expect(formatContextWindowTokens(999_499)).toBe("999k");
    expect(formatContextWindowTokens(999_500)).toBe("1m");
  });

  test("formats billions and trillions instead of thousands of millions", () => {
    expect(formatContextWindowTokens(5_133_200_000)).toBe("5.1b");
    expect(formatContextWindowTokens(23_703_500_000)).toBe("23.7b");
    expect(formatContextWindowTokens(999_960_000)).toBe("1b");
    expect(formatContextWindowTokens(2_500_000_000_000)).toBe("2.5t");
  });

  test("formats percentages for compact popover copy", () => {
    expect(formatContextWindowPercentage(0.5)).toBe("0.5%");
    expect(formatContextWindowPercentage(9.5)).toBe("9.5%");
    expect(formatContextWindowPercentage(10)).toBe("10%");
    expect(formatContextWindowPercentage(100)).toBe("100%");
  });

  test("tiers severity on absolute used tokens, not percentage", () => {
    expect(contextWindowSeverity(0)).toBe("normal");
    expect(contextWindowSeverity(150_000)).toBe("normal");
    expect(contextWindowSeverity(150_001)).toBe("warning");
    expect(contextWindowSeverity(300_000)).toBe("warning");
    expect(contextWindowSeverity(300_001)).toBe("critical");
    expect(contextWindowSeverity(Number.NaN)).toBe("normal");
  });
});
