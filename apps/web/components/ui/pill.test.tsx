/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  Pill,
  PillAction,
  PillContent,
  PillIcon,
  PillMeta,
  PillText,
} from "./pill";

describe("Pill", () => {
  test("renders slot content", () => {
    render(
      <Pill>
        <PillContent>
          <PillIcon>!</PillIcon>
          <PillText>Example</PillText>
          <PillMeta>md</PillMeta>
        </PillContent>
      </Pill>
    );

    expect(screen.getByText("Example")).toBeDefined();
    expect(screen.getByText("md")).toBeDefined();
  });

  test("supports asChild on the root", () => {
    render(
      <Pill asChild>
        <button type="button">Clickable pill</button>
      </Pill>
    );

    const button = screen.getByRole("button", { name: "Clickable pill" });
    expect(button.className).toContain("rounded-md");
    expect(button.getAttribute("data-slot")).toBe("pill");
  });

  test("reacts at the pill shell when interactive content is hovered", () => {
    render(
        <Pill data-testid="interactive-pill">
          <PillContent asChild>
            <button type="button">Open item</button>
          </PillContent>
        <PillAction aria-label="Remove interactive item" />
        </Pill>
      );

    expect(screen.getByTestId("interactive-pill").className).toContain(
      "has-[button[data-slot=pill-content]:hover]:bg-muted"
    );
    expect(screen.getByTestId("interactive-pill").className).toContain(
      "has-[button[data-slot=pill-content]:focus-visible]:bg-muted"
    );
  });

  test("applies size and tone variants", () => {
    render(
      <>
        <Pill data-testid="default-pill" />
        <Pill data-testid="compact-pill" size="compact" />
        <Pill data-testid="selected-pill" tone="selected" />
      </>
    );

    expect(screen.getByTestId("default-pill").className).toContain("h-7");
    expect(screen.getByTestId("compact-pill").className).toContain("h-6");
    expect(screen.getByTestId("compact-pill").getAttribute("data-tone")).toBe(
      "default"
    );
    expect(screen.getByTestId("selected-pill").className).toContain(
      "border-primary/40"
    );
  });

  test("renders the shared action and invokes the handler", () => {
    const onClick = vi.fn();

    render(<PillAction aria-label="Remove item" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove item" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("inherits compact size for the action within a compact pill", () => {
    render(
      <Pill size="compact">
        <PillContent>
          <PillText>Compact</PillText>
        </PillContent>
        <PillAction aria-label="Remove compact" />
      </Pill>
    );

    expect(screen.getByRole("button", { name: "Remove compact" }).className).toContain(
      "size-4"
    );
  });

  test("rounds the action like the rectangular pill with a muted hover", () => {
    render(
      <Pill>
        <PillAction aria-label="Remove shape" />
      </Pill>
    );

    const action = screen.getByRole("button", { name: "Remove shape" });
    expect(action.className).toContain("rounded-sm");
    expect(action.className).not.toContain("rounded-full");
    expect(action.className).not.toMatch(/hover:bg-foreground(\s|$)/);
  });

  test("renders badge meta styling", () => {
    render(<PillMeta variant="badge">md</PillMeta>);

    const badge = screen.getAllByText("md").at(-1);
    expect(badge).toBeDefined();
    expect(badge?.className).toContain("rounded-full");
    expect(badge?.className).toContain("uppercase");
  });
});
