import { describe, expect, test } from "vitest";

import {
  denormalizeMarkdownFromMdxEditor,
  normalizeMarkdownForMdxEditor,
} from "./normalize-markdown";

describe("normalizeMarkdownForMdxEditor", () => {
  test("escapes prose angle placeholders", () => {
    expect(normalizeMarkdownForMdxEditor("They'll be invited as <project role>.")).toBe(
      "They'll be invited as \\<project role>."
    );
  });

  test("does not double-escape prose angle placeholders", () => {
    const markdown = "They'll be invited as \\<project role>.";

    expect(normalizeMarkdownForMdxEditor(markdown)).toBe(markdown);
  });

  test("preserves inline code spans", () => {
    const markdown = "Use `<project role>` as the placeholder.";

    expect(normalizeMarkdownForMdxEditor(markdown)).toBe(markdown);
  });

  test("preserves fenced code blocks", () => {
    const markdown = [
      "Before <project role>.",
      "",
      "```typescript",
      "const value = '<project role>';",
      "```",
    ].join("\n");

    expect(normalizeMarkdownForMdxEditor(markdown)).toBe(
      [
        "Before \\<project role>.",
        "",
        "```typescript",
        "const value = '<project role>';",
        "```",
      ].join("\n")
    );
  });

  test("escapes URL and email autolinks", () => {
    expect(
      normalizeMarkdownForMdxEditor("Visit <https://example.com> or email <person@example.com>.")
    ).toBe("Visit \\<https://example.com> or email \\<person@example.com>.");
  });

  test("escapes prose colon directives", () => {
    expect(normalizeMarkdownForMdxEditor("Run pnpm web:lint before finishing.")).toBe(
      "Run pnpm web\\:lint before finishing."
    );
  });

  test("does not double-escape escaped prose colon directives", () => {
    expect(normalizeMarkdownForMdxEditor("Run pnpm web\\:lint before finishing.")).toBe(
      "Run pnpm web\\:lint before finishing."
    );
  });

  test("preserves block directives for admonitions", () => {
    const markdown = [
      ":::note",
      "Run pnpm web:lint before finishing.",
      ":::",
    ].join("\n");

    expect(normalizeMarkdownForMdxEditor(markdown)).toBe(
      [
        ":::note",
        "Run pnpm web\\:lint before finishing.",
        ":::",
      ].join("\n")
    );
  });
});

describe("denormalizeMarkdownFromMdxEditor", () => {
  test("restores prose angle placeholders", () => {
    expect(denormalizeMarkdownFromMdxEditor("Invite the \\<project role>.")).toBe(
      "Invite the <project role>."
    );
  });

  test("preserves angle escapes inside code", () => {
    const markdown = [
      "Use `\\<project role>` as the placeholder.",
      "",
      "```text",
      "\\<project role>",
      "```",
    ].join("\n");

    expect(denormalizeMarkdownFromMdxEditor(markdown)).toBe(markdown);
  });

  test("restores escaped autolinks", () => {
    expect(denormalizeMarkdownFromMdxEditor("Show \\<https://example.com> as text.")).toBe(
      "Show <https://example.com> as text."
    );
  });

  test("removes editor-only colon-directive escapes", () => {
    expect(denormalizeMarkdownFromMdxEditor("Run pnpm web\\:lint before finishing.")).toBe(
      "Run pnpm web:lint before finishing."
    );
  });

  test("preserves colon escapes inside code", () => {
    const markdown = "Run `pnpm web\\:lint` before finishing.";

    expect(denormalizeMarkdownFromMdxEditor(markdown)).toBe(markdown);
  });

  test("decodes character references the serializer emits for prose", () => {
    expect(denormalizeMarkdownFromMdxEditor("Logging &amp; Audit Trail &lt;v2&gt;")).toBe(
      "Logging & Audit Trail <v2>"
    );
  });

  test("keeps author-typed entity text intact", () => {
    expect(denormalizeMarkdownFromMdxEditor("Write &amp;amp; for an ampersand.")).toBe(
      "Write &amp; for an ampersand."
    );
  });

  test("preserves character references inside code", () => {
    const markdown = [
      "Escape it as `&amp;` in HTML.",
      "",
      "```html",
      "<p>a &amp; b</p>",
      "```",
    ].join("\n");

    expect(denormalizeMarkdownFromMdxEditor(markdown)).toBe(markdown);
  });

  test("round-trips an email in angle brackets", () => {
    const markdown = "Co-Authored-By: Claude <noreply@anthropic.com>";

    expect(
      denormalizeMarkdownFromMdxEditor(normalizeMarkdownForMdxEditor(markdown))
    ).toBe(markdown);
  });
});
