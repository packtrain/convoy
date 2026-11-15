import { describe, expect, test } from "vitest";
import { extractMcpToolResult } from "./mcp-tool";
import { parseConvoyTaskReaderToolPart } from "./convoy-task-reader-tool";

const TASK = {
  _id: "task_1",
  refId: "OS-1250",
  name: "Fix login flow",
  status: "In Progress",
  priority: "High",
  list: { id: "list_1", ref: "NEXT", name: "Next", type: "list" },
};

function textBlocks(value: unknown) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

describe("extractMcpToolResult", () => {
  test("unwraps Claude Code content-block arrays", () => {
    expect(extractMcpToolResult(textBlocks(TASK))).toEqual(TASK);
  });

  test("unwraps Codex item.result content wrappers", () => {
    expect(
      extractMcpToolResult({
        id: "call_1",
        server: "convoy",
        tool: "get_task",
        status: "completed",
        result: { content: textBlocks(TASK) },
      })
    ).toEqual(TASK);
  });

  test("parses raw JSON strings and passes through plain objects", () => {
    expect(extractMcpToolResult(JSON.stringify(TASK))).toEqual(TASK);
    expect(extractMcpToolResult(TASK)).toEqual(TASK);
    expect(extractMcpToolResult("plain text output")).toBe(
      "plain text output"
    );
  });
});

describe("parseConvoyTaskReaderToolPart", () => {
  test("parses completed get_task from Claude Code format", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__get_task",
      toolCallId: "call_1",
      state: "output-available",
      input: { taskId: "OS-1250" },
      output: textBlocks(TASK),
    } as const;

    expect(parseConvoyTaskReaderToolPart(part)).toEqual({
      kind: "get_task",
      server: "convoy",
      toolCallId: "call_1",
      state: "output-available",
      inputHint: "OS-1250",
      tasks: [
        {
          refId: "OS-1250",
          name: "Fix login flow",
          status: "In Progress",
          listName: "Next",
        },
      ],
    });
  });

  test("parses list_tasks array and search_tasks page", () => {
    const listPart = {
      type: "dynamic-tool",
      toolName: "convoy-dev.list_tasks",
      toolCallId: "call_2",
      state: "output-available",
      input: { status: "To Do" },
      output: textBlocks([TASK, TASK]),
    } as const;
    expect(parseConvoyTaskReaderToolPart(listPart)?.tasks).toHaveLength(2);
    expect(parseConvoyTaskReaderToolPart(listPart)?.inputHint).toBe("To Do");

    const searchPart = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__search_tasks",
      toolCallId: "call_3",
      state: "output-available",
      input: { query: "login" },
      output: textBlocks({ page: [TASK], isDone: true, continueCursor: "" }),
    } as const;
    const searchPayload = parseConvoyTaskReaderToolPart(searchPart);
    expect(searchPayload?.tasks).toHaveLength(1);
    expect(searchPayload?.inputHint).toBe("“login”");
  });

  test("parses get_tasks results with unresolved identifiers", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__get_tasks",
      toolCallId: "call_4",
      state: "output-available",
      input: { identifiers: ["OS-1250", "OS-999999"] },
      output: textBlocks({
        results: [
          { identifier: "OS-1250", task: TASK },
          {
            identifier: "OS-999999",
            task: null,
            error: 'task "OS-999999" not found',
          },
        ],
      }),
    } as const;

    const payload = parseConvoyTaskReaderToolPart(part);
    expect(payload?.tasks).toHaveLength(1);
    expect(payload?.unresolvedIdentifiers).toEqual(["OS-999999"]);
    expect(payload?.inputHint).toBe("OS-1250, OS-999999");
  });

  test("returns null on unexpected output shape (generic fallback)", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__get_task",
      toolCallId: "call_5",
      state: "output-available",
      input: { taskId: "OS-1" },
      output: [{ type: "text", text: "Error: something exploded" }],
    } as const;

    expect(parseConvoyTaskReaderToolPart(part)).toBeNull();
  });

  test("returns null for same-named tools on other servers", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "jira.get_task",
      toolCallId: "call_6",
      state: "output-available",
      input: { taskId: "OS-1250" },
      output: textBlocks(TASK),
    } as const;

    expect(parseConvoyTaskReaderToolPart(part)).toBeNull();
  });

  test("keeps pending and failed states without tasks", () => {
    const pending = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__list_tasks",
      toolCallId: "call_7",
      state: "input-available",
      input: {},
    } as const;
    expect(parseConvoyTaskReaderToolPart(pending)).toEqual({
      kind: "list_tasks",
      server: "convoy",
      toolCallId: "call_7",
      state: "input-available",
    });

    const failed = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__get_task",
      toolCallId: "call_8",
      state: "output-error",
      input: { taskId: "OS-999999" },
      errorText: "Task not found",
    } as const;
    expect(parseConvoyTaskReaderToolPart(failed)).toEqual({
      kind: "get_task",
      server: "convoy",
      toolCallId: "call_8",
      state: "output-error",
      inputHint: "OS-999999",
      errorText: "Task not found",
    });
  });
});
