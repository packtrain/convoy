/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { TagsCell } from "./tags-cell";

afterEach(cleanup);

describe("TagsCell", () => {
  // The column cell is p-0, so the cell content owns the inset, like LabelCell.
  test.each([
    ["editable", true],
    ["read-only", false],
  ])("insets the empty mark from the column border when %s", (_, isEditable) => {
    render(<TagsCell tags={[]} isEditable={isEditable} onTagsChange={() => {}} />);

    expect(screen.getByText("—").parentElement?.className).toContain("px-2");
  });
});
