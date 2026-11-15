import { describe, expect, test, vi } from "vitest";
import { normalizeTaskDescription } from "./taskDescription";

type DocNode = {
  type?: string;
  marks?: Array<{ type?: string }>;
  content?: DocNode[];
  text?: string;
};

function parseDoc(value: string | null | undefined) {
  expect(typeof value).toBe("string");
  return JSON.parse(String(value)) as DocNode;
}

function collectNodeAndMarkTypes(node: DocNode, nodeTypes: Set<string>, markTypes: Set<string>) {
  if (node.type) {
    nodeTypes.add(node.type);
  }
  for (const mark of node.marks ?? []) {
    if (mark.type) {
      markTypes.add(mark.type);
    }
  }
  for (const child of node.content ?? []) {
    collectNodeAndMarkTypes(child, nodeTypes, markTypes);
  }
}

describe("taskDescription", () => {
  test("normalizes markdown content into a ProseMirror doc", () => {
    const result = normalizeTaskDescription("# Title\n\n**bold** text");
    const doc = parseDoc(result);

    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("heading");
    expect(doc.content?.[1]?.type).toBe("paragraph");
  });

  test("passes through serialized ProseMirror doc JSON", () => {
    const input = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "already normalized" }] }],
    });

    const result = normalizeTaskDescription(input);
    expect(result).toBe(input);
  });

  test("does not pass through serialized doc JSON with invalid content shape", () => {
    const invalidDoc = JSON.stringify({
      type: "doc",
      content: "not-an-array",
    });

    const result = normalizeTaskDescription(invalidDoc);
    expect(result).not.toBe(invalidDoc);
    const doc = parseDoc(result);
    expect(doc.type).toBe("doc");
  });

  test("normalizes JSON that is not a ProseMirror doc", () => {
    const result = normalizeTaskDescription("[1,2,3]");
    const doc = parseDoc(result);

    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[0]?.content?.[0]?.text).toContain("[1,2,3]");
  });

  test("normalizes empty and whitespace-only strings", () => {
    const emptyDoc = parseDoc(normalizeTaskDescription(""));
    const whitespaceDoc = parseDoc(normalizeTaskDescription("   \n\t"));

    expect(emptyDoc.type).toBe("doc");
    expect(whitespaceDoc.type).toBe("doc");
  });

  test("keeps null and undefined passthrough semantics", () => {
    expect(normalizeTaskDescription(null)).toBeNull();
    expect(normalizeTaskDescription(undefined)).toBeUndefined();
  });

  test("handles large input without throwing", () => {
    const largeInput = `# Header\n\n${"x".repeat(20_000)}`;
    const result = normalizeTaskDescription(largeInput);
    const doc = parseDoc(result);
    expect(doc.type).toBe("doc");
  });

  test("normalizes unsupported markdown syntax as safe doc content", () => {
    const result = normalizeTaskDescription("| a | b |\n|---|---|\n| 1 | 2 |");
    const doc = parseDoc(result);
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
  });

  test("covers all supported markdown node and mark types", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const markdown = [
      "# Heading 1",
      "",
      "Paragraph with *italic*, **bold**, [link](https://example.com), and `inline code`.",
      "",
      "> Blockquote line",
      "",
      "- Bullet item",
      "",
      "1. Ordered item",
      "",
      "![Alt text](https://example.com/image.png)",
      "",
      "Line one\\",
      "Line two",
      "",
      "    indented code block",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const doc = parseDoc(normalizeTaskDescription(markdown));
    const nodeTypes = new Set<string>();
    const markTypes = new Set<string>();
    collectNodeAndMarkTypes(doc, nodeTypes, markTypes);

    const expectedNodeTypes = [
      "doc",
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "hardBreak",
      "codeBlock",
      "text",
    ];
    const expectedMarkTypes = ["italic", "bold", "link", "code"];

    const missingNodeTypes = expectedNodeTypes.filter((nodeType) => !nodeTypes.has(nodeType));
    const missingMarkTypes = expectedMarkTypes.filter((markType) => !markTypes.has(markType));
    if (missingNodeTypes.length > 0 || missingMarkTypes.length > 0) {
      throw new Error(
        `Missing node types: ${missingNodeTypes.join(", ")}; ` +
          `missing mark types: ${missingMarkTypes.join(", ")}; ` +
          `seen node types: ${Array.from(nodeTypes).sort().join(", ")}; ` +
          `seen mark types: ${Array.from(markTypes).sort().join(", ")}`
      );
    }

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("treats horizontal-rule markdown as unsupported and safely falls back", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const markdown = "Before\n\n---\n\nAfter";

    const doc = parseDoc(normalizeTaskDescription(markdown));
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[0]?.content?.[0]?.text).toContain("---");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("currently drops image markdown into an empty paragraph", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const markdown = "![Alt text](https://example.com/image.png)";

    const doc = parseDoc(normalizeTaskDescription(markdown));
    expect(doc.type).toBe("doc");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[0]?.content).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
