import { describe, expect, test } from "vitest";

import {
  normalizeMarkdownForViewModeTransition,
  shouldUseMdxToolbarOverflow,
} from "./toolbar";

describe("normalizeMarkdownForViewModeTransition", () => {
  test("normalizes source markdown before returning to rich text", () => {
    expect(
      normalizeMarkdownForViewModeTransition({
        currentViewMode: "source",
        nextViewMode: "rich-text",
        sourceMarkdown: "They'll be invited as <project role>.",
      })
    ).toBe("They'll be invited as \\<project role>.");
  });

  test("does not normalize when not entering rich text", () => {
    expect(
      normalizeMarkdownForViewModeTransition({
        currentViewMode: "rich-text",
        nextViewMode: "source",
        sourceMarkdown: "They'll be invited as <project role>.",
      })
    ).toBeNull();
  });
});

describe("shouldUseMdxToolbarOverflow", () => {
  test("uses the compact overflow menu only below the toolbar width threshold", () => {
    expect(shouldUseMdxToolbarOverflow(null)).toBe(false);
    expect(shouldUseMdxToolbarOverflow(640)).toBe(false);
    expect(shouldUseMdxToolbarOverflow(639)).toBe(true);
  });
});
