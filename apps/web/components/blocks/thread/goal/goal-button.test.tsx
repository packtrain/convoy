/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { GoalButton } from ".";

const ACTIVE = { objective: "count.txt contains 3", status: "active" as const, iterations: 2, lastReason: "It contains 2." };

describe("GoalButton", () => {
  test("renders nothing without a goal", () => {
    const { container } = render(<GoalButton goal={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  test("names the goal state on the icon button", () => {
    render(<GoalButton goal={ACTIVE} />);
    expect(screen.getByRole("button", { name: "Goal active · 2 checks: count.txt contains 3" })).toBeTruthy();
  });

  test("names a met goal", () => {
    render(<GoalButton goal={{ ...ACTIVE, status: "complete" }} />);
    expect(screen.getByRole("button", { name: "Goal met: count.txt contains 3" })).toBeTruthy();
  });

  test("the popover shows the goal and clears it", () => {
    const onClear = vi.fn();
    render(<GoalButton goal={ACTIVE} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("count.txt contains 3")).toBeTruthy();
    expect(screen.getByText("Last check: It contains 2.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear goal" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("offers no clear action when the runtime cannot clear", () => {
    render(<GoalButton goal={ACTIVE} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("button", { name: "Clear goal" })).toBeNull();
  });

  test.each([
    ["paused", "Goal paused"],
    ["blocked", "Goal blocked"],
    ["usageLimited", "Goal stopped at a usage limit"],
    ["budgetLimited", "Goal reached its token budget"],
  ] as const)("names a Codex %s goal (OS-2277)", (status, label) => {
    render(<GoalButton goal={{ objective: "ship it", status, iterations: 0, tokensUsed: 1200 }} />);
    expect(screen.getByRole("button", { name: `${label}: ship it` })).toBeTruthy();
  });

  test("shows Codex token use on the label and in the popover", () => {
    render(<GoalButton goal={{ objective: "ship it", status: "active", iterations: 0, tokensUsed: 1200, tokenBudget: 5000 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Goal active · 1.2k tokens: ship it" }));
    expect(screen.getByText("Tokens: 1.2k used of 5k")).toBeTruthy();
  });

  test("tells how to continue a paused goal", () => {
    render(<GoalButton goal={{ objective: "ship it", status: "paused", iterations: 0 }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Send /goal resume to continue.")).toBeTruthy();
  });
});
