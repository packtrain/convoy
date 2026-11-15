import { describe, expect, test } from "vitest";
import { parseFileChangeToolPart } from "./file-change-tool";

describe("file-change-tool parser", () => {
  test("strips tab-delimited line-number prefixes from Read string output", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "tool_read_1",
      state: "output-available",
      input: { file_path: "/workspace/apps/web/convex/cli/threads.ts", offset: 560 },
      output: "560\t\n561\t/**\n562\t * Create a new chat for a profile.\n563\t */\n",
    } as const;

    const payload = parseFileChangeToolPart(part);

    expect(payload?.content).toBe("\n/**\n * Create a new chat for a profile.\n */\n");
    expect(payload?.offset).toBe(560);
  });

  test("strips arrow-delimited line-number prefixes from Read string output", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "tool_read_2",
      state: "output-available",
      input: { file_path: "/workspace/readme.md" },
      output: "     1→# Title\n     2→\n     3→Body text\n",
    } as const;

    const payload = parseFileChangeToolPart(part);

    expect(payload?.content).toBe("# Title\n\nBody text\n");
  });

  test("keeps system-reminder lines wrapped around numbered Read output", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "tool_read_3",
      state: "output-available",
      input: { file_path: "/workspace/notes.md" },
      output:
        "<system-reminder>Memory is 3 days old.</system-reminder>\n1\tfirst\n2\tsecond\n<system-reminder>Consider malware.</system-reminder>",
    } as const;

    const payload = parseFileChangeToolPart(part);

    expect(payload?.content).toBe(
      "<system-reminder>Memory is 3 days old.</system-reminder>\nfirst\nsecond\n<system-reminder>Consider malware.</system-reminder>"
    );
  });

  test("leaves content alone when numbering does not form a run", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "tool_read_4",
      state: "output-available",
      input: { file_path: "/workspace/data.tsv" },
      output: "1\tapple\n7\tbanana\n42\tcherry",
    } as const;

    const payload = parseFileChangeToolPart(part);

    expect(payload?.content).toBe("1\tapple\n7\tbanana\n42\tcherry");
  });

  test("uses structured Read output content verbatim", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "tool_read_5",
      state: "output-available",
      input: { file_path: "/workspace/a.ts" },
      output: {
        type: "text",
        file: {
          filePath: "/workspace/a.ts",
          content: "const a = 1;\n",
          startLine: 10,
          totalLines: 120,
        },
      },
    } as const;

    const payload = parseFileChangeToolPart(part);

    expect(payload?.content).toBe("const a = 1;\n");
    expect(payload?.startLine).toBe(10);
    expect(payload?.totalLines).toBe(120);
  });
});
