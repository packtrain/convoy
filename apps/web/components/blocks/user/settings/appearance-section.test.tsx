// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AppearanceSection } from "./appearance-section";

const mocks = vi.hoisted(() => ({
  sectionHeaderStyle: "compact",
  sectionColorStyle: "tint",
  setSectionHeaderStyle: vi.fn(),
  setSectionColorStyle: vi.fn(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));
vi.mock("./code-diff-theme-field", () => ({ CodeDiffThemeField: () => null }));
vi.mock("@/lib/preferences/use-user-preferences", () => ({
  useUserPreferences: () => mocks,
  useSectionAppearance: () => ({
    sectionHeaderStyle: "compact",
    sectionColorStyle: "tint",
  }),
}));

test("task section styles are picked from preview cards", () => {
  render(<AppearanceSection />);
  const header = within(screen.getByRole("group", { name: "Header style" }));
  const color = within(screen.getByRole("group", { name: "Color accent" }));

  const pressed = (card: HTMLElement) => card.getAttribute("aria-pressed");
  expect(pressed(header.getByRole("button", { name: "Compact" }))).toBe("true");
  expect(pressed(header.getByRole("button", { name: "Spacious" }))).toBe("false");
  expect(color.getAllByRole("button").map((card) => card.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
  for (const name of ["Tint", "Stripe", "Dot"]) color.getByRole("button", { name });

  fireEvent.click(header.getByRole("button", { name: "Spacious" }));
  fireEvent.click(color.getByRole("button", { name: "Dot" }));
  expect(mocks.setSectionHeaderStyle).toHaveBeenCalledWith("spacious");
  expect(mocks.setSectionColorStyle).toHaveBeenCalledWith("dot");
});

test("each preview stays fixed when the other setting changes", () => {
  const { rerender } = render(<AppearanceSection />);
  const previews = () =>
    [...document.querySelectorAll("[role=group] button > div[aria-hidden]")].map((el) => el.outerHTML);
  const before = previews();

  mocks.sectionHeaderStyle = "spacious";
  mocks.sectionColorStyle = "dot";
  rerender(<AppearanceSection />);
  mocks.sectionHeaderStyle = "compact";
  mocks.sectionColorStyle = "tint";

  expect(before).toHaveLength(5);
  expect(previews()).toEqual(before);
});

test("card labels sit at the bottom so they line up across preview heights", () => {
  render(<AppearanceSection />);
  for (const card of document.querySelectorAll("[role=group] button")) {
    expect(card.className).toContain("justify-between");
  }
});

test("the task sections description sits under its label", () => {
  render(<AppearanceSection />);
  const label = screen.getByText("Task sections");
  expect(label.nextElementSibling?.textContent).toBe(
    "How section headers and colors look in task lists and boards.",
  );
});

test("the color accent label says it only applies to sections", () => {
  render(<AppearanceSection />);
  const group = screen.getByRole("group", { name: "Color accent" });
  expect(group.firstElementChild?.textContent).toBe("Color accent (sections only)");
});
