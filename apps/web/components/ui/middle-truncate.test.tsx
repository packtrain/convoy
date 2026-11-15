/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { MiddleTruncate } from "./middle-truncate";

describe("MiddleTruncate", () => {
  test("keeps the tail of a long text outside the truncating part", () => {
    const { container } = render(<MiddleTruncate text="feat/os-2289-evidence-tab-with-agent-attached" />);
    const root = container.firstElementChild!;

    expect(root.textContent).toBe("feat/os-2289-evidence-tab-with-agent-attached");
    expect(root.children[0].className).toContain("truncate");
    expect(root.children[1].textContent).toBe("-agent-attached");
    expect(root.children[1].className).toContain("shrink-0");
  });

  test("renders short text as one truncating span", () => {
    const { container } = render(<MiddleTruncate text="feat/current" />);
    const root = container.firstElementChild!;

    expect(root.textContent).toBe("feat/current");
    expect(root.children).toHaveLength(0);
    expect(root.className).toContain("truncate");
  });
});
