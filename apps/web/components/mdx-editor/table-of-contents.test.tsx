/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { MdxTableOfContents } from "./table-of-contents";
import type { MdxTocHeading } from "./lib/extract-mdx-headings";

const longTitle =
  "G6. New default conflicts with the existing resolution chain — decide each piece";

const headings: MdxTocHeading[] = [
  { id: "g6", title: longTitle, depth: 2, line: 1 },
];

describe("MdxTableOfContents", () => {
  // OS-1168: long titles must ellipsize inside the panel instead of painting
  // over the editor content. `truncate` only works if every ancestor in the
  // grid/flex chain allows shrinking below content size (min-w-0).
  test("long heading titles are constrained to the panel width", () => {
    const { getByText } = render(
      <MdxTableOfContents
        headings={headings}
        editorRootRef={createRef<HTMLElement | null>()}
      />
    );

    const span = getByText(longTitle);
    expect(span.className).toContain("truncate");
    expect(span.className).toContain("min-w-0");

    const listItem = span.closest("li");
    expect(listItem?.className).toContain("min-w-0");

    // Hovering a truncated item reveals the full title via the native tooltip.
    expect(span.closest("button")?.title).toBe(longTitle);
  });
});
