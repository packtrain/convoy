import { describe, expect, test } from "vitest";

import { stripTrailingSpaces } from "./authored-markdown";

describe("stripTrailingSpaces", () => {
  test("drops the escaped space the markdown serializer emits at a line ending", () => {
    expect(stripTrailingSpaces("Do you agree? Don't fix it yet.&#x20;\n\nArtifact:&#x20;")).toBe(
      "Do you agree? Don't fix it yet.\n\nArtifact:"
    );
  });

  test("drops decimal, padded, and uppercase spellings of the same reference", () => {
    expect(stripTrailingSpaces("a&#32;\nb&#x0020;\nc&#X20;")).toBe("a\nb\nc");
  });

  test("drops plain trailing whitespace", () => {
    expect(stripTrailingSpaces("Artifact:  \nNext\t\n")).toBe("Artifact:\nNext\n");
  });

  test("drops runs that mix escapes and literal whitespace", () => {
    expect(stripTrailingSpaces("Artifact: &#x20;&#x20;")).toBe("Artifact:");
  });

  test("keeps escapes that are not at a line ending", () => {
    expect(stripTrailingSpaces("a&#x20;b")).toBe("a&#x20;b");
  });

  test("keeps an escaped ampersand the author typed literally", () => {
    expect(stripTrailingSpaces("Literally &amp;#x20;")).toBe("Literally &amp;#x20;");
  });

  test("keeps interior blank lines and hard breaks intact", () => {
    expect(stripTrailingSpaces("first\\\nsecond\n\nthird")).toBe("first\\\nsecond\n\nthird");
  });

  test("normalizes CRLF line endings without rewriting them", () => {
    expect(stripTrailingSpaces("a&#x20;\r\nb")).toBe("a\r\nb");
  });
});
