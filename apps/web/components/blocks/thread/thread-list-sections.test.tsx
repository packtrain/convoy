/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ThreadCollapsibleSection } from "./thread-list-sections";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("the section chevron shows on keyboard focus as well as hover", () => {
  render(
    <ThreadCollapsibleSection label="Pinned" storageKey="test-pinned" compactLayout={false}>
      <div>Thread</div>
    </ThreadCollapsibleSection>
  );

  const chevron = screen.getByRole("button", { name: "Pinned" }).querySelector("svg");
  expect(chevron?.getAttribute("class")).toContain("group-focus-visible/section:opacity-100");
});
