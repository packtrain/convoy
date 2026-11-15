import { screen, within } from "@testing-library/react";
import { expect } from "vitest";

const FRAME_CLASSES = new Set(["border", "border-2", "border-dashed", "bg-card", "bg-background"]);

/**
 * Asserts the shared empty-state pattern (docs/guidelines/frontend-development.md#empty-states):
 * title in a bare `EmptyState`, an icon in its muted circle, no frame on it or its ancestors up to `boundary`.
 */
export function expectEmptyState(
  title: string | RegExp,
  { boundary, action }: { boundary?: HTMLElement | null; action?: { role: "button" | "link"; name: string | RegExp } } = {}
): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const empty = heading.closest<HTMLElement>("[data-slot=empty]");
  expect(empty, "title is not inside [data-slot=empty]").not.toBeNull();
  expect(empty!.querySelector(".rounded-full.bg-muted > svg"), "no icon in EmptyMedia").not.toBeNull();
  if (action) {
    expect(within(empty!).getByRole(action.role, { name: action.name })).toBeDefined();
  }
  const stop = (boundary ?? empty)!.parentElement;
  let node: HTMLElement | null = empty;
  while (node && node !== stop) {
    const framed = node.className.split(/\s+/).filter((name) => FRAME_CLASSES.has(name));
    expect(framed, `framed ancestor <${node.tagName.toLowerCase()} class="${node.className}">`).toEqual([]);
    node = node.parentElement;
  }
  return empty!;
}

/** Asserts a `fill` `EmptyState` grows and centers, with a flex-col flex-1 chain up to `boundary`. */
export function expectVerticallyCentered(empty: HTMLElement, boundary: HTMLElement) {
  expect(empty.className.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-1", "items-center", "justify-center"]));
  let node = empty;
  while (node !== boundary) {
    node = node.parentElement!;
    expect(node.className.split(" "), `<${node.tagName.toLowerCase()} class="${node.className}">`).toEqual(
      expect.arrayContaining(["flex", "flex-col", "flex-1"])
    );
  }
}
