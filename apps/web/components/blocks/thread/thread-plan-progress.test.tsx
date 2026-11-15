/**
 * @vitest-environment jsdom
 */
import { render, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { PlanProgress } from "@/lib/threads/plan-progress";
import { ThreadPlanProgress } from "./thread-plan-progress";

function plan(overrides: Partial<PlanProgress> = {}): PlanProgress {
  return {
    steps: [
      { text: "Investigate", status: "completed" },
      { text: "Implement", status: "in-progress" },
      { text: "Test", status: "pending" },
    ],
    completed: 1,
    total: 3,
    currentIndex: 2,
    currentStep: "Implement",
    ...overrides,
  };
}

describe("ThreadPlanProgress", () => {
  test("renders nothing without a plan", () => {
    const { container } = render(<ThreadPlanProgress plan={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("shows the step counter without the step title", () => {
    const { container } = render(<ThreadPlanProgress plan={plan()} />);
    const view = within(container);

    expect(view.getByText("Step 2 / 3")).toBeTruthy();
    expect(view.queryByText("Implement")).toBeNull();
    expect(view.getByRole("button", { name: "Plan progress: Step 2 / 3" })).toBeTruthy();
  });

  test("a finished plan drops the counter and keeps only the ring", () => {
    const { container } = render(
      <ThreadPlanProgress
        plan={plan({
          steps: [
            { text: "Investigate", status: "completed" },
            { text: "Implement", status: "completed" },
          ],
          completed: 2,
          total: 2,
          currentIndex: 2,
          currentStep: "Implement",
        })}
      />
    );
    const view = within(container);

    expect(view.queryByText(/^Step /)).toBeNull();
    expect(view.getByRole("button", { name: "Plan complete: 2 steps" })).toBeTruthy();
  });

  test("the counter collapses out in narrow composer bars", () => {
    const { container } = render(<ThreadPlanProgress plan={plan()} />);

    // Same container-query idiom as the bar's other chips: hidden by default,
    // shown at @lg. The ring is always visible.
    expect(within(container).getByText("Step 2 / 3").className).toContain(
      "@lg/composer-bar:inline"
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
