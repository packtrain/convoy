import { describe, expect, test, vi } from "vitest";

vi.mock("@tiptap/pm/markdown", async () => {
  const actual = await vi.importActual<typeof import("@tiptap/pm/markdown")>("@tiptap/pm/markdown");

  class ThrowingMarkdownParser extends actual.MarkdownParser {
    override parse(_text: string, _markdownEnv?: object): never {
      void _text;
      void _markdownEnv;
      throw new Error("forced parse failure");
    }
  }

  return {
    ...actual,
    MarkdownParser: ThrowingMarkdownParser,
  };
});

import { normalizeTaskDescription } from "./taskDescription";

describe("taskDescription fallback", () => {
  test("warns and falls back to plain-text doc when markdown parse throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = "**markdown** that triggers parser failure";

    const result = normalizeTaskDescription(input);
    expect(typeof result).toBe("string");

    const doc = JSON.parse(String(result)) as {
      type?: string;
      content?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe(input);
    expect(warnSpy).toHaveBeenCalledWith(
      "[mcp] Failed to parse markdown task description; falling back to plain-text doc.",
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });
});
