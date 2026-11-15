/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ReasoningPart } from "./reasoning-part";

afterEach(cleanup);

describe("ReasoningPart", () => {
  test("renders redacted (empty) reasoning as a plain label, not an accordion", () => {
    render(<ReasoningPart part={{ type: "reasoning", text: " " }} partIndex={0} />);
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders reasoning with text as an expandable accordion", () => {
    render(<ReasoningPart part={{ type: "reasoning", text: "Consider X" }} partIndex={0} />);
    expect(screen.getByRole("button", { name: "Reasoning" })).toBeTruthy();
  });

  test("renders no leading icon", () => {
    const { container } = render(
      <ReasoningPart part={{ type: "reasoning", text: "Consider X" }} partIndex={0} />
    );
    expect(container.querySelectorAll("svg:not([data-slot='tool-chevron'])")).toHaveLength(0);
  });

  test("uses the shared tool row, with a chevron only when there is text", () => {
    const { container, rerender } = render(
      <ReasoningPart part={{ type: "reasoning", text: "Consider X" }} partIndex={0} />
    );
    expect(container.querySelector("[data-slot='tool-chevron']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(screen.getByText("Consider X")).toBeTruthy();

    rerender(<ReasoningPart part={{ type: "reasoning", text: "" }} partIndex={0} />);
    expect(container.querySelector("[data-slot='tool-chevron']")).toBeNull();
    expect(container.querySelector(".cursor-pointer")).toBeNull();
  });
});
