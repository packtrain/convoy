/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RecurringTasksSection, TemplatesSection } from "./project-settings-sections";
import { expectEmptyState, expectVerticallyCentered } from "@/test-utils/empty-state";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

afterEach(cleanup);

test("template icon buttons are named after the template", () => {
  render(<TemplatesSection />);

  const [first] = screen.getAllByRole("heading", { level: 4 });
  const name = first.textContent ?? "";
  expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
  expect(screen.getByRole("button", { name: `Delete ${name}` })).toBeTruthy();
});

test("recurring tasks show the shared empty state with the create action, centered", () => {
  const { container } = render(<RecurringTasksSection />);

  const section = container.firstElementChild as HTMLElement;
  const empty = expectEmptyState("No recurring tasks", {
    boundary: section,
    action: { role: "button", name: "New recurring task" },
  });
  expect(screen.getAllByRole("button", { name: "New recurring task" })).toHaveLength(1);
  expectVerticallyCentered(empty, section);
});
