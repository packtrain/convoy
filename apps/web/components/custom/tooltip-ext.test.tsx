/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";
import { afterEach, describe, expect, test } from "vitest";

import { TooltipExt } from "./tooltip-ext";

describe("TooltipExt", () => {
  afterEach(cleanup);

  test("names an icon-only trigger after the tooltip", () => {
    render(
      <TooltipExt content="Delete task">
        <button type="button">
          <Trash2 />
        </button>
      </TooltipExt>
    );

    expect(screen.getByRole("button", { name: "Delete task" })).toBeTruthy();
  });

  test("follows a changed tooltip", () => {
    const { rerender } = render(
      <TooltipExt content="Set due date">
        <button type="button">
          <Trash2 />
        </button>
      </TooltipExt>
    );
    rerender(
      <TooltipExt content="Change due date">
        <button type="button">
          <Trash2 />
        </button>
      </TooltipExt>
    );

    expect(screen.getByRole("button", { name: "Change due date" })).toBeTruthy();
  });

  test("keeps the visible text as the name", () => {
    render(
      <TooltipExt content="Add task (N)">
        <button type="button">
          <Trash2 />
          <span>Add task</span>
        </button>
      </TooltipExt>
    );

    expect(screen.getByRole("button", { name: "Add task" }).hasAttribute("aria-label")).toBe(false);
  });

  test("keeps the trigger's own aria-label", () => {
    render(
      <TooltipExt content="Copies the command">
        <button type="button" aria-label="Copy command">
          <Trash2 />
        </button>
      </TooltipExt>
    );

    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
  });
});
