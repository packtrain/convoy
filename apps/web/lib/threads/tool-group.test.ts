import { describe, expect, test } from "vitest";
import type { DynamicToolUIPart, ReasoningUIPart } from "ai";
import type { ToolCallTiming } from "@/lib/cli-stream-ui";
import type { ToolGroup } from "./group-consecutive-tool-parts";
import {
  formatWorkedForLabel,
  getToolGroupDurationMs,
  isToolGroupLive,
} from "./tool-group";

function tool(toolCallId: string): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: "Read",
    toolCallId,
    state: "output-available",
    output: {},
  } as DynamicToolUIPart;
}

function reasoning(text: string): ReasoningUIPart {
  return { type: "reasoning", text, providerMetadata: undefined };
}

function group(...parts: ToolGroup["parts"]): ToolGroup {
  return { type: "tool-group", parts };
}

function timings(
  entries: Array<[string, ToolCallTiming]>
): Map<string, ToolCallTiming> {
  return new Map(entries);
}

describe("isToolGroupLive", () => {
  function pending(toolCallId: string): DynamicToolUIPart {
    return {
      type: "dynamic-tool",
      toolName: "Bash",
      toolCallId,
      state: "input-available",
      input: {},
    } as DynamicToolUIPart;
  }

  test("the trailing group of a streaming message is live", () => {
    expect(
      isToolGroupLive({
        group: group(tool("a"), tool("b")),
        isTrailingItem: true,
        isMessageStreaming: true,
      })
    ).toBe(true);
  });

  test("an earlier group of a streaming message is not live", () => {
    expect(
      isToolGroupLive({
        group: group(tool("a"), tool("b")),
        isTrailingItem: false,
        isMessageStreaming: true,
      })
    ).toBe(false);
  });

  test("a group with a call awaiting its result stays live even when not trailing", () => {
    expect(
      isToolGroupLive({
        group: group(tool("a"), pending("b")),
        isTrailingItem: false,
        isMessageStreaming: true,
      })
    ).toBe(true);
  });

  test("a settled message collapses its trailing group", () => {
    expect(
      isToolGroupLive({
        group: group(tool("a"), tool("b")),
        isTrailingItem: true,
        isMessageStreaming: false,
      })
    ).toBe(false);
  });

  test("reasoning parts never keep a group live", () => {
    expect(
      isToolGroupLive({
        group: group(tool("a"), reasoning("thinking"), tool("b")),
        isTrailingItem: true,
        isMessageStreaming: false,
      })
    ).toBe(false);
  });
});

describe("getToolGroupDurationMs", () => {
  test("spans the first start to the last end", () => {
    const duration = getToolGroupDurationMs(
      group(tool("a"), tool("b")),
      timings([
        ["a", { startedAt: 1_000, endedAt: 2_000 }],
        ["b", { startedAt: 2_100, endedAt: 5_500 }],
      ])
    );
    expect(duration).toBe(4_500);
  });

  test("ignores reasoning parts and out-of-order timings", () => {
    const duration = getToolGroupDurationMs(
      group(tool("a"), reasoning("think"), tool("b")),
      timings([
        ["a", { startedAt: 9_000, endedAt: 9_500 }],
        ["b", { startedAt: 1_000, endedAt: 3_000 }],
      ])
    );
    expect(duration).toBe(8_500);
  });

  test("returns undefined when a call has no result yet", () => {
    const duration = getToolGroupDurationMs(
      group(tool("a"), tool("b")),
      timings([
        ["a", { startedAt: 1_000, endedAt: 2_000 }],
        ["b", { startedAt: 2_100 }],
      ])
    );
    expect(duration).toBeUndefined();
  });

  test("returns undefined when a call is untimed", () => {
    const duration = getToolGroupDurationMs(
      group(tool("a"), tool("b")),
      timings([["a", { startedAt: 1_000, endedAt: 2_000 }]])
    );
    expect(duration).toBeUndefined();
  });

  test("returns undefined with an empty timing map", () => {
    expect(getToolGroupDurationMs(group(tool("a")), new Map())).toBeUndefined();
  });

  test("never returns a negative span", () => {
    const duration = getToolGroupDurationMs(
      group(tool("a")),
      timings([["a", { startedAt: 5_000, endedAt: 4_000 }]])
    );
    expect(duration).toBe(0);
  });
});

describe("formatWorkedForLabel", () => {
  test.each([
    [0, "Worked for 1s"],
    [400, "Worked for 1s"],
    [1_000, "Worked for 1s"],
    [12_400, "Worked for 12s"],
    [59_000, "Worked for 59s"],
    [59_600, "Worked for 1m"],
    [60_000, "Worked for 1m"],
    [83_000, "Worked for 1m 23s"],
    [119_800, "Worked for 2m"],
    [120_000, "Worked for 2m"],
    [3_599_999, "Worked for 1h"],
    [3_600_000, "Worked for 1h"],
    [3_840_000, "Worked for 1h 4m"],
  ])("formats %ims as %s", (durationMs, expected) => {
    expect(formatWorkedForLabel(durationMs)).toBe(expected);
  });
});
