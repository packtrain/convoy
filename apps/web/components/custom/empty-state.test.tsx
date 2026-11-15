/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { Tag } from "lucide-react";
import { afterEach, describe, expect, test } from "vitest";

import { expectEmptyState } from "@/test-utils/empty-state";
import { Empty, EmptyState } from "./empty-state";

const FRAME_CLASSES = ["border", "border-dashed", "bg-card", "bg-background", "bg-muted"];

describe("EmptyState", () => {
  afterEach(cleanup);

  test("renders the icon in the muted circle, then the title and description", () => {
    render(<EmptyState icon={Tag} title="No labels yet" description="Create labels to group the Board." />);

    const empty = expectEmptyState("No labels yet");
    const circle = empty.querySelector(".rounded-full.bg-muted")!;
    expect(circle.querySelector("svg")).not.toBeNull();
    const heading = screen.getByRole("heading", { level: 3, name: "No labels yet" });
    expect(circle.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(empty).getByText("Create labels to group the Board.").tagName).toBe("P");
  });

  test("puts the action inside the empty state, below the header", () => {
    render(
      <EmptyState
        icon={Tag}
        title="No labels yet"
        action={<button type="button">Create label</button>}
        actionClassName="w-full max-w-md"
      />
    );

    const empty = expectEmptyState("No labels yet", { action: { role: "button", name: "Create label" } });
    const content = screen.getByRole("button", { name: "Create label" }).parentElement!;
    expect(content.parentElement).toBe(empty);
    expect(content.className.split(" ")).toEqual(expect.arrayContaining(["mt-4", "w-full", "max-w-md"]));
  });

  test("the description wraps without leaving one short word on its last line", () => {
    render(<EmptyState icon={Tag} title="No labels yet" description="Create labels to group the Board." />);
    expect(screen.getByText("Create labels to group the Board.").className).toContain("text-pretty");
  });

  test("omits the description and action slots when not given", () => {
    render(<EmptyState icon={Tag} title="No labels yet" />);

    const empty = expectEmptyState("No labels yet");
    expect(empty.querySelector("p")).toBeNull();
    expect(empty.children).toHaveLength(1);
  });

  test("fill grows into the flex column and centers its content", () => {
    render(<EmptyState icon={Tag} title="No labels yet" fill />);

    const classes = expectEmptyState("No labels yet").className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["flex", "flex-1", "flex-col", "items-center", "justify-center"]));
  });

  test("has no frame of its own", () => {
    render(<EmptyState icon={Tag} title="No labels yet" fill />);

    const classes = expectEmptyState("No labels yet").className.split(" ");
    expect(classes.filter((name) => FRAME_CLASSES.includes(name))).toEqual([]);
  });

  test("passes the title level, className, test id and aria props through to the root", () => {
    render(
      <EmptyState
        icon={Tag}
        title="Page not found"
        titleAs="h1"
        className="min-h-80"
        data-testid="probe"
        aria-live="polite"
      />
    );

    const root = screen.getByTestId("probe");
    expect(root.getAttribute("data-slot")).toBe("empty");
    expect(root.getAttribute("aria-live")).toBe("polite");
    expect(root.className.split(" ")).toContain("min-h-80");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeDefined();
  });
});

describe("Empty dashed", () => {
  afterEach(cleanup);

  test("styles a bare no-match message as muted small text", () => {
    render(<Empty variant="dashed">No agents match this search.</Empty>);

    const classes = screen.getByText("No agents match this search.").className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["border-dashed", "text-sm", "text-muted-foreground"]));
  });
});
