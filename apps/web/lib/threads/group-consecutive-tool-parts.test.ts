import { describe, expect, test } from "vitest";
import type { DynamicToolUIPart, TextUIPart, ReasoningUIPart } from "ai";
import {
  groupConsecutiveToolParts,
  isToolGroup,
  type ToolGroup,
} from "./group-consecutive-tool-parts";

// ---------------------------------------------------------------------------
// Helpers to create test parts
// ---------------------------------------------------------------------------

function tool(name: string, id?: string): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: name,
    toolCallId: id ?? `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
    state: "output-available",
    output: {},
  } as DynamicToolUIPart;
}

function text(content: string): TextUIPart {
  return { type: "text", text: content };
}

function reasoning(content: string): ReasoningUIPart {
  return { type: "reasoning", text: content, providerMetadata: undefined };
}

function failedTool(name: string, id?: string): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: name,
    toolCallId: id ?? `call-${name}-failed`,
    state: "output-error",
    input: {},
    errorText: "Exit code 1",
  } as unknown as DynamicToolUIPart;
}

function askUserQuestion(): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: "AskUserQuestion",
    toolCallId: "call-ask",
    state: "output-error",
    input: {
      questions: [
        {
          question: "Pick one",
          multiSelect: false,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    },
    errorText: "waiting for user",
  } as unknown as DynamicToolUIPart;
}

function exitPlanMode(): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolName: "ExitPlanMode",
    toolCallId: "call-exit",
    state: "output-error",
    input: { plan: "The plan content here" },
    errorText: "waiting for approval",
  } as unknown as DynamicToolUIPart;
}

// isToolGroup imported from the module under test

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("groupConsecutiveToolParts", () => {
  test("returns empty array for empty input", () => {
    expect(groupConsecutiveToolParts([])).toEqual([]);
  });

  test("passes through non-tool parts unchanged", () => {
    const parts = [text("hello"), reasoning("think")];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toEqual(parts);
  });

  test("does not group a lone tool call", () => {
    const t1 = tool("Read");
    const result = groupConsecutiveToolParts([t1]);
    expect(result).toEqual([t1]);
    expect(result.every((r) => !isToolGroup(r))).toBe(true);
  });

  test("groups exactly 2 consecutive tools", () => {
    const tools = [tool("Read"), tool("Grep")];
    const result = groupConsecutiveToolParts(tools);
    expect(result).toHaveLength(1);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(2);
  });

  test("groups exactly 4 consecutive tools", () => {
    const tools = [tool("Read"), tool("Grep"), tool("Glob"), tool("Write")];
    const result = groupConsecutiveToolParts(tools);
    expect(result).toHaveLength(1);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(4);
  });

  test("reasoning between tools joins the group in stream order", () => {
    const t1 = tool("Read");
    const r1 = reasoning("thinking about it");
    const t2 = tool("Grep");
    const result = groupConsecutiveToolParts([t1, r1, t2]);
    expect(result).toHaveLength(1);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toEqual([t1, r1, t2]);
  });

  test("reasoning trailing the last tool joins the group", () => {
    const t1 = tool("Read");
    const t2 = tool("Grep");
    const r1 = reasoning("wrapping up");
    const result = groupConsecutiveToolParts([t1, t2, r1, text("answer")]);
    expect(result).toHaveLength(2);
    expect((result[0] as ToolGroup).parts).toEqual([t1, t2, r1]);
    expect(result[1]).toEqual(text("answer"));
  });

  test("reasoning leading a run stays outside the group", () => {
    const r1 = reasoning("planning");
    const t1 = tool("Read");
    const t2 = tool("Grep");
    const result = groupConsecutiveToolParts([r1, t1, t2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(r1);
    expect((result[1] as ToolGroup).parts).toEqual([t1, t2]);
  });

  test("reasoning around a single tool call never forms a group", () => {
    const parts = [reasoning("before"), tool("Read"), reasoning("after")];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toEqual(parts);
    expect(result.every((r) => !isToolGroup(r))).toBe(true);
  });

  test("reasoning-only runs never form a group", () => {
    const parts = [reasoning("a"), reasoning("b"), reasoning("c")];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toEqual(parts);
    expect(result.every((r) => !isToolGroup(r))).toBe(true);
  });

  test("groups a long run of consecutive tools", () => {
    const tools = Array.from({ length: 10 }, (_, i) => tool(`Tool${i}`));
    const result = groupConsecutiveToolParts(tools);
    expect(result).toHaveLength(1);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(10);
  });

  test("text between tools creates separate groups", () => {
    const parts = [
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
      tool("Write"),
      text("analysis"),
      tool("Edit"),
      tool("Bash"),
      tool("Read"),
      tool("Grep"),
    ];
    const result = groupConsecutiveToolParts(parts);
    // First 4 tools → group, text, then 4 tools → group
    expect(result).toHaveLength(3);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(4);
    expect(result[1]).toEqual(text("analysis"));
    expect(isToolGroup(result[2])).toBe(true);
    expect((result[2] as ToolGroup).parts).toHaveLength(4);
  });

  test("text between tools — second run below threshold stays individual", () => {
    const parts = [
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
      tool("Write"),
      text("mid"),
      tool("Edit"),
    ];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toHaveLength(3); // group + text + Edit
    expect(isToolGroup(result[0])).toBe(true);
    expect(result[1]).toEqual(text("mid"));
    expect(!isToolGroup(result[2])).toBe(true);
  });

  test("a failed tool call splits the run and stays a top-level row", () => {
    const fail = failedTool("Bash");
    const parts = [
      tool("Read"),
      tool("Grep"),
      fail,
      tool("Edit"),
      tool("Write"),
    ];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toHaveLength(3);
    expect((result[0] as ToolGroup).parts).toHaveLength(2);
    expect(result[1]).toBe(fail);
    expect((result[2] as ToolGroup).parts).toHaveLength(2);
  });

  test("split remainders below the threshold stay individual rows", () => {
    const t1 = tool("Read");
    const fail = failedTool("Bash");
    const t2 = tool("Edit");
    const result = groupConsecutiveToolParts([t1, fail, t2]);
    expect(result).toEqual([t1, fail, t2]);
    expect(result.every((item) => !isToolGroup(item))).toBe(true);
  });

  test("interrupted calls settled to output-error leave the group", () => {
    // OS-1435 settles unfinished calls to output-error on a stopped run.
    const interrupted = {
      type: "dynamic-tool",
      toolName: "Bash",
      toolCallId: "call-interrupted",
      state: "output-error",
      input: { command: "sleep 30" },
      errorText: "Interrupted",
    } as unknown as DynamicToolUIPart;
    const parts = [tool("Read"), tool("Grep"), tool("Glob"), interrupted];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toHaveLength(2);
    expect((result[0] as ToolGroup).parts).toHaveLength(3);
    expect(result[1]).toBe(interrupted);
  });

  test("reasoning before a failed call flushes with its run", () => {
    const t1 = tool("Read");
    const t2 = tool("Grep");
    const r1 = reasoning("that looked wrong");
    const fail = failedTool("Bash");
    const result = groupConsecutiveToolParts([t1, t2, r1, fail]);
    expect(result).toHaveLength(2);
    expect((result[0] as ToolGroup).parts).toEqual([t1, t2, r1]);
    expect(result[1]).toBe(fail);
  });

  test("AskUserQuestion breaks groups and is never grouped", () => {
    const parts = [
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
      tool("Write"),
      tool("Edit"),
      askUserQuestion(),
      tool("Bash"),
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
    ];
    const result = groupConsecutiveToolParts(parts);
    // 5 tools → group, AskUserQuestion individual, 4 tools → group
    expect(result).toHaveLength(3);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(5);
    expect((result[1] as DynamicToolUIPart).toolName).toBe("AskUserQuestion");
    expect(isToolGroup(result[2])).toBe(true);
    expect((result[2] as ToolGroup).parts).toHaveLength(4);
  });

  test("ExitPlanMode breaks groups and is never grouped", () => {
    const parts = [
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
      tool("Write"),
      exitPlanMode(),
      tool("Bash"),
    ];
    const result = groupConsecutiveToolParts(parts);
    // 4 tools → group, ExitPlanMode individual, Bash individual (below threshold)
    expect(result).toHaveLength(3);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[1] as DynamicToolUIPart).toolName).toBe("ExitPlanMode");
    expect(!isToolGroup(result[2])).toBe(true);
  });

  test("mixed non-tool types pass through preserving order", () => {
    const parts = [
      text("start"),
      reasoning("think"),
      tool("Read"),
      tool("Grep"),
      tool("Glob"),
      tool("Write"),
      tool("Edit"),
      reasoning("more thinking"),
      text("end"),
    ];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(text("start"));
    expect(result[1]).toEqual(reasoning("think"));
    expect(isToolGroup(result[2])).toBe(true);
    // 5 tools plus the reasoning that follows them.
    expect((result[2] as ToolGroup).parts).toHaveLength(6);
    expect(result[3]).toEqual(text("end"));
  });

  test("preserves tool part references in group", () => {
    const t1 = tool("Read", "id-1");
    const t2 = tool("Grep", "id-2");
    const t3 = tool("Glob", "id-3");
    const t4 = tool("Write", "id-4");
    const result = groupConsecutiveToolParts([t1, t2, t3, t4]);
    const group = result[0] as ToolGroup;
    expect(group.parts[0]).toBe(t1);
    expect(group.parts[1]).toBe(t2);
    expect(group.parts[2]).toBe(t3);
    expect(group.parts[3]).toBe(t4);
  });

  test("TerminalTool (Bash) is included in groups", () => {
    const bash = {
      type: "dynamic-tool",
      toolName: "Bash",
      toolCallId: "call-bash",
      state: "output-available",
      input: { command: "ls" },
      output: {},
    } as unknown as DynamicToolUIPart;
    const parts = [tool("Read"), tool("Grep"), bash, tool("Write")];
    const result = groupConsecutiveToolParts(parts);
    expect(result).toHaveLength(1);
    expect(isToolGroup(result[0])).toBe(true);
    expect((result[0] as ToolGroup).parts).toHaveLength(4);
  });
});
