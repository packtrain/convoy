/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { MdxMobileTableOfContents } from "./mobile-table-of-contents";

vi.mock("@/components/ui/drawer", () => import("@/test-utils/mocks/drawer"));

describe("MdxMobileTableOfContents", () => {
  afterEach(cleanup);

  test("opens headings in a bottom drawer and closes after a selection", () => {
    const editorRootRef = createRef<HTMLDivElement>();

    render(
      <div ref={editorRootRef}>
        <h1 id="plan">Plan</h1>
        <MdxMobileTableOfContents
          editorRootRef={editorRootRef}
          headings={[{ depth: 1, id: "plan", line: 1, title: "Plan" }]}
          updateHash={false}
        />
      </div>
    );

    const trigger = screen.getByRole("button", { name: "Open table of contents" });
    expect(trigger.className).toContain("md:hidden");

    fireEvent.click(trigger);

    expect(screen.getByTestId("mdx-mobile-toc-drawer")).toBeDefined();
    expect(screen.getByTestId("drawer-root").getAttribute("data-direction")).toBe("bottom");

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    expect(screen.queryByTestId("mdx-mobile-toc-drawer")).toBeNull();
  });

  test("does not render a trigger without headings", () => {
    render(<MdxMobileTableOfContents editorRootRef={createRef<HTMLDivElement>()} headings={[]} />);

    expect(screen.queryByRole("button", { name: "Open table of contents" })).toBeNull();
  });
});
