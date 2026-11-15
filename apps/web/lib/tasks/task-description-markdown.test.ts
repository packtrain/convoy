import { getSchema } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, test } from "vitest";

import { serializeTaskDescriptionDocAsMarkdown } from "./task-description-markdown";

const schema = getSchema([
  StarterKit.configure({
    horizontalRule: false,
    dropcursor: false,
    link: {
      openOnClick: false,
      enableClickSelection: true,
    },
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
  Image,
  Typography,
]);

function serialize(json: Parameters<typeof schema.nodeFromJSON>[0]) {
  return serializeTaskDescriptionDocAsMarkdown(schema.nodeFromJSON(json));
}

describe("serializeTaskDescriptionDocAsMarkdown", () => {
  test("serializes common task description blocks and marks", () => {
    const markdown = serialize({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Summary" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Use " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: ", " },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
            { type: "text", text: ", " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: ", " },
            { type: "text", text: "strike", marks: [{ type: "strike" }] },
            { type: "text", text: ", and " },
            {
              type: "text",
              text: "links",
              marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Quoted note" }],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const value = 1;" }],
        },
        {
          type: "image",
          attrs: {
            src: "https://example.com/image.png",
            alt: "Example image",
            title: null,
          },
        },
      ],
    });

    expect(markdown).toBe(
      [
        "## Summary",
        "Use **bold**, *italic*, `code`, ~~strike~~, and [links](https://example.com).",
        "> Quoted note",
        "```ts\nconst value = 1;\n```",
        "![Example image](https://example.com/image.png)",
      ].join("\n\n")
    );
  });

  test("serializes task lists as markdown checkboxes", () => {
    const markdown = serialize({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Done" }],
                },
              ],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Todo" }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("- [x] Done\n- [ ] Todo");
  });
});
