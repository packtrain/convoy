import { describe, expect, test } from "vitest";
import { parseGrepToolPart } from "./grep-tool";

describe("grep-tool parser", () => {
  test("parses content output and counts displayed lines", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Grep",
      toolCallId: "tool_grep_1",
      state: "output-available",
      input: {
        pattern: "taskByClientId",
        path: "/workspace/apps/web/controller.ts",
        output_mode: "content",
        "-C": 3,
      },
      output:
        "258:  const taskByClientId = useMemo(\n259-    () => new Map()\n--\n533:  const beginInlineTaskDraft = useCallback(",
    } as const;

    expect(parseGrepToolPart(part)).toEqual({
      toolName: "Grep",
      toolCallId: "tool_grep_1",
      state: "output-available",
      pattern: "taskByClientId",
      path: "/workspace/apps/web/controller.ts",
      outputMode: "content",
      contextLines: 3,
      resultText:
        "258:  const taskByClientId = useMemo(\n259-    () => new Map()\n--\n533:  const beginInlineTaskDraft = useCallback(",
      resultCount: 4,
      resultLabel: "lines",
    });
  });

  test("prefers structured match count and content text when both are present", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Grep",
      toolCallId: "tool_grep_2",
      state: "output-available",
      input: {
        pattern: "TODO",
        output_mode: "count",
      },
      output: {
        content: "apps/web/a.ts:2",
        filenames: ["apps/web/a.ts", "apps/web/b.ts"],
        numMatches: 2,
        numFiles: 1,
      },
    } as const;

    expect(parseGrepToolPart(part)).toMatchObject({
      resultText: "apps/web/a.ts:2",
      resultCount: 2,
      resultLabel: "matches",
    });
  });

  test("extracts found-file count from plain files_with_matches output", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Grep",
      toolCallId: "tool_grep_3",
      state: "output-available",
      input: {
        pattern: "Button",
        output_mode: "files_with_matches",
      },
      output: "Found 2 files\napps/web/a.tsx\napps/web/b.tsx",
    } as const;

    expect(parseGrepToolPart(part)).toMatchObject({
      resultCount: 2,
      resultLabel: "files",
    });
  });

  test("returns null for non-Grep tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Glob",
      toolCallId: "tool_glob_1",
      state: "output-available",
      input: { pattern: "**/*.ts" },
      output: "apps/web/a.ts",
    } as const;

    expect(parseGrepToolPart(part)).toBeNull();
  });
});

