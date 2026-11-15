import { describe, expect, test } from "vitest";

import { extractMdxHeadings } from "./extract-mdx-headings";

describe("extractMdxHeadings", () => {
  test("extracts ATX headings with stable depth and line metadata", () => {
    expect(extractMdxHeadings("# Overview\n\n## Details\n\n#### Deep dive")).toEqual([
      {
        id: "mdx-heading-overview",
        depth: 1,
        title: "Overview",
        line: 1,
      },
      {
        id: "mdx-heading-details",
        depth: 2,
        title: "Details",
        line: 3,
      },
      {
        id: "mdx-heading-deep-dive",
        depth: 4,
        title: "Deep dive",
        line: 5,
      },
    ]);
  });

  test("ignores headings inside fenced code blocks", () => {
    expect(
      extractMdxHeadings([
        "# Real heading",
        "",
        "```mdx",
        "# Not a heading",
        "```",
        "",
        "## Also real",
      ].join("\n"))
    ).toEqual([
      {
        id: "mdx-heading-real-heading",
        depth: 1,
        title: "Real heading",
        line: 1,
      },
      {
        id: "mdx-heading-also-real",
        depth: 2,
        title: "Also real",
        line: 7,
      },
    ]);
  });

  test("normalizes inline markdown and duplicate titles", () => {
    expect(
      extractMdxHeadings([
        "## Using `code` and [links](https://example.com) ###",
        "## Using code and links",
      ].join("\n"))
    ).toEqual([
      {
        id: "mdx-heading-using-code-and-links",
        depth: 2,
        title: "Using code and links",
        line: 1,
      },
      {
        id: "mdx-heading-using-code-and-links-2",
        depth: 2,
        title: "Using code and links",
        line: 2,
      },
    ]);
  });

  test("decodes html character references left by editor serialization", () => {
    expect(
      extractMdxHeadings(
        ["# asasdf&#x20;", "## A &amp; B &#62; C", "## Bad ref &#x110000; stays"].join("\n")
      )
    ).toEqual([
      {
        id: "mdx-heading-asasdf",
        depth: 1,
        title: "asasdf",
        line: 1,
      },
      {
        id: "mdx-heading-a-b-c",
        depth: 2,
        title: "A & B > C",
        line: 2,
      },
      {
        id: "mdx-heading-bad-ref-x110000-stays",
        depth: 2,
        title: "Bad ref &#x110000; stays",
        line: 3,
      },
    ]);
  });

  test("supports a custom heading id prefix", () => {
    expect(extractMdxHeadings("# Overview", { idPrefix: "contained-mdx-heading" })).toEqual([
      {
        id: "contained-mdx-heading-overview",
        depth: 1,
        title: "Overview",
        line: 1,
      },
    ]);
  });
});
