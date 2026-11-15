import { describe, expect, test } from "vitest";
import { parseGlobToolPart } from "./glob-tool";

describe("glob-tool parser", () => {
  test("parses plain filename output and counts files", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Glob",
      toolCallId: "tool_glob_1",
      state: "output-available",
      input: {
        pattern: "**/ui/button-group*",
        path: "/workspace/apps/web",
      },
      output: "/workspace/apps/web/components/ui/button-group.tsx",
    } as const;

    expect(parseGlobToolPart(part)).toEqual({
      toolName: "Glob",
      toolCallId: "tool_glob_1",
      state: "output-available",
      pattern: "**/ui/button-group*",
      path: "/workspace/apps/web",
      resultText: "/workspace/apps/web/components/ui/button-group.tsx",
      resultCount: 1,
    });
  });

  test("prefers structured filenames and metadata over content fallback", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Glob",
      toolCallId: "tool_glob_2",
      state: "output-available",
      input: {
        pattern: "**/*.tsx",
      },
      output: {
        content: "legacy fallback",
        filenames: ["apps/web/a.tsx", "apps/web/b.tsx"],
        numFiles: 2,
        truncated: true,
        durationMs: 12,
      },
    } as const;

    expect(parseGlobToolPart(part)).toEqual({
      toolName: "Glob",
      toolCallId: "tool_glob_2",
      state: "output-available",
      pattern: "**/*.tsx",
      resultText: "apps/web/a.tsx\napps/web/b.tsx",
      resultCount: 2,
      truncated: true,
      durationMs: 12,
    });
  });

  test("handles no-file and truncated text sentinels as fallback", () => {
    const noFilesPart = {
      type: "dynamic-tool",
      toolName: "Glob",
      toolCallId: "tool_glob_3",
      state: "output-available",
      input: { pattern: "**/missing*" },
      output: "No files found",
    } as const;

    expect(parseGlobToolPart(noFilesPart)).toMatchObject({
      resultCount: 0,
      resultText: "No files found",
    });

    const truncatedPart = {
      type: "dynamic-tool",
      toolName: "Glob",
      toolCallId: "tool_glob_4",
      state: "output-available",
      input: { pattern: "**/*.ts" },
      output: [
        "apps/web/a.ts",
        "apps/web/b.ts",
        "(Results are truncated. Consider using a more specific path or pattern.)",
      ].join("\n"),
    } as const;

    expect(parseGlobToolPart(truncatedPart)).toMatchObject({
      resultCount: 2,
      truncated: true,
    });
  });

  test("returns null for non-Glob tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Grep",
      toolCallId: "tool_grep_1",
      state: "output-available",
      input: { pattern: "Button" },
      output: "apps/web/a.tsx",
    } as const;

    expect(parseGlobToolPart(part)).toBeNull();
  });
});

