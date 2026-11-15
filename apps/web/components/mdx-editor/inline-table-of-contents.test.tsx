/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { createRef } from "react";
import { expect, test, vi } from "vitest";

import { MdxInlineTableOfContents } from "./inline-table-of-contents";
import type { MdxTocHeading } from "./lib/extract-mdx-headings";

vi.mock("./lib/use-mdx-table-of-contents", () => ({
  useMdxTableOfContents: () => ({
    scrollToHeading: vi.fn(),
    visibleActiveHeadingId: "heading-1",
  }),
}));

function renderRail(headingCount: number) {
  const editorRootRef = createRef<HTMLElement>();
  editorRootRef.current = document.createElement("div");

  const headings: MdxTocHeading[] = Array.from({ length: headingCount }, (_, index) => ({
    depth: index % 2 === 0 ? 2 : 3,
    id: `heading-${index + 1}`,
    line: index + 1,
    title: `Heading ${index + 1}`,
  }));

  const { container } = render(
    <MdxInlineTableOfContents editorRootRef={editorRootRef} headings={headings} />
  );

  return container.querySelector<HTMLElement>('[aria-hidden="true"]');
}

test("draws one marker per heading so the rail maps the whole document", () => {
  const rail = renderRail(36);

  expect(rail?.children).toHaveLength(36);
});

test("tightens the marker gap instead of overflowing when headings pile up", () => {
  const shortDocGap = renderRail(6)?.style.gap;
  const longDocGap = renderRail(36)?.style.gap;

  expect(Number.parseFloat(shortDocGap ?? "")).toBeGreaterThan(
    Number.parseFloat(longDocGap ?? "")
  );
});

test("keeps the rail in view with CSS sticky rather than scroll-driven repositioning", () => {
  const rail = renderRail(4);
  const stickyBox = rail?.parentElement?.parentElement;

  expect(stickyBox?.className).toContain("sticky");
});
