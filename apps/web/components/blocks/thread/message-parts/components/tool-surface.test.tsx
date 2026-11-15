/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolSurface } from "./tool-surface";

describe("tool-surface", () => {
  test("renders children with the shared expander surface classes", () => {
    render(
      <ToolSurface>
        <div>Surface content</div>
      </ToolSurface>
    );

    const content = screen.getByText("Surface content");
    const surface = content.parentElement;

    expect(surface).not.toBeNull();
    expect(surface?.className).toContain("rounded-md");
    expect(surface?.className).toContain("border");
    expect(surface?.className).toContain("border-border");
    expect(surface?.className).toContain("bg-muted/50");
    expect(surface?.className).toContain("p-3");
  });

  test("merges optional className", () => {
    const { container } = render(
      <ToolSurface className="space-y-4 overflow-hidden">
        <div>Surface content</div>
      </ToolSurface>
    );

    const surface = container.firstElementChild;

    expect(surface?.className).toContain("space-y-4");
    expect(surface?.className).toContain("overflow-hidden");
  });
});
