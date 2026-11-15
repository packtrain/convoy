import { describe, expect, test } from "vitest";
import {
  CONVOY_MCP_TOOL_NAMES,
  formatMcpToolTitle,
  isConvoyMcpTool,
  parseMcpToolName,
  parseMcpToolPart,
} from "./mcp-tool";

describe("parseMcpToolName", () => {
  test("parses Claude Code format mcp__<server>__<tool>", () => {
    expect(parseMcpToolName("mcp__convoy__get_task")).toEqual({
      server: "convoy",
      tool: "get_task",
    });
    expect(parseMcpToolName("mcp__convoy-dev__list_tasks")).toEqual({
      server: "convoy-dev",
      tool: "list_tasks",
    });
  });

  test("parses Codex format <server>.<tool>", () => {
    expect(parseMcpToolName("convoy.get_task")).toEqual({
      server: "convoy",
      tool: "get_task",
    });
    expect(parseMcpToolName("jira.get_task")).toEqual({
      server: "jira",
      tool: "get_task",
    });
  });

  test("parses OpenCode format <server>_<tool> via the catalog", () => {
    expect(parseMcpToolName("convoy_get_task")).toEqual({
      server: "convoy",
      tool: "get_task",
    });
    expect(parseMcpToolName("convoy-dev_create_task_artifact")).toEqual({
      server: "convoy-dev",
      tool: "create_task_artifact",
    });
  });

  test("returns null for non-MCP tool names", () => {
    expect(parseMcpToolName("Grep")).toBeNull();
    expect(parseMcpToolName("Apply changes")).toBeNull();
    expect(parseMcpToolName("TodoWrite")).toBeNull();
    expect(parseMcpToolName("get_task")).toBeNull();
    // Underscore form is catalog-anchored: no catalog tool, no split.
    expect(parseMcpToolName("linear_get_issue")).toBeNull();
  });

  test("no catalog name is a suffix of another, so the underscore split is unambiguous", () => {
    const names = [...CONVOY_MCP_TOOL_NAMES];
    expect(
      names.filter((name) =>
        names.some((other) => other !== name && other.endsWith(`_${name}`))
      )
    ).toEqual([]);
  });
});

describe("isConvoyMcpTool", () => {
  test("matches convoy-ish servers with catalog tools", () => {
    expect(
      isConvoyMcpTool({ server: "convoy", tool: "get_task" })
    ).toBe(true);
    expect(
      isConvoyMcpTool({ server: "convoy-dev", tool: "create_task" })
    ).toBe(true);
    expect(
      isConvoyMcpTool({ server: "my-Convoy", tool: "list_tasks" })
    ).toBe(true);
  });

  test("rejects same-named tools from other servers", () => {
    expect(isConvoyMcpTool({ server: "jira", tool: "get_task" })).toBe(false);
  });

  test("rejects convoy server with non-catalog tool", () => {
    expect(
      isConvoyMcpTool({ server: "convoy", tool: "explode_task" })
    ).toBe(false);
  });
});

describe("formatMcpToolTitle", () => {
  test("humanizes snake_case", () => {
    expect(formatMcpToolTitle("get_task")).toBe("Get task");
    expect(formatMcpToolTitle("set_artifact_comment_status")).toBe(
      "Set artifact comment status"
    );
  });
});

describe("parseMcpToolPart", () => {
  test("parses a completed MCP call", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "mcp__convoy__get_task",
      toolCallId: "tool_mcp_1",
      state: "output-available",
      input: { taskId: "OS-1228" },
      output: { refId: "OS-1228", name: "Render MCP tool calls" },
    } as const;

    expect(parseMcpToolPart(part)).toEqual({
      toolCallId: "tool_mcp_1",
      state: "output-available",
      server: "convoy",
      tool: "get_task",
      input: { taskId: "OS-1228" },
      output: { refId: "OS-1228", name: "Render MCP tool calls" },
    });
  });

  test("parses a failed Codex-format call with errorText", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "convoy-dev.get_task",
      toolCallId: "tool_mcp_2",
      state: "output-error",
      input: { taskId: "OS-999999" },
      errorText: "Task not found",
    } as const;

    expect(parseMcpToolPart(part)).toEqual({
      toolCallId: "tool_mcp_2",
      state: "output-error",
      server: "convoy-dev",
      tool: "get_task",
      input: { taskId: "OS-999999" },
      errorText: "Task not found",
    });
  });

  test("returns null for non-MCP tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Grep",
      toolCallId: "tool_grep_1",
      state: "input-available",
      input: { pattern: "foo" },
    } as const;

    expect(parseMcpToolPart(part)).toBeNull();
  });
});
