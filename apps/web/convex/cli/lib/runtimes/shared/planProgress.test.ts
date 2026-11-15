import { describe, expect, test } from "vitest";
import type { CliNormalizedEvent, CliPlanStep } from "@/convex/lib/contracts/validators";
import { foldPlanEvents, planProgressEvent, planStepUpdateEvent } from "./planProgress";

describe("planProgressEvent", () => {
  test("drops blank steps and returns null when nothing is left", () => {
    expect(planProgressEvent([{ text: "  ", status: "pending" }])).toBeNull();
    expect(planProgressEvent([])).toBeNull();
  });
});

describe("planStepUpdateEvent", () => {
  test("ignores patches that say nothing about a step", () => {
    expect(planStepUpdateEvent([{ id: "1" }])).toBeNull();
    expect(planStepUpdateEvent([{ id: "", text: "x" }])).toBeNull();
  });
});

describe("foldPlanEvents", () => {
  const current: CliPlanStep[] = [
    { id: "1", text: "Investigate", status: "completed" },
    { id: "2", text: "Implement", status: "pending" },
  ];

  test("returns null when no event touches the plan", () => {
    expect(foldPlanEvents(current, [{ kind: "text", text: "hi" }])).toBeNull();
  });

  test("a snapshot replaces the whole plan", () => {
    expect(
      foldPlanEvents(current, [
        { kind: "plan-progress", steps: [{ text: "Something else", status: "pending" }] },
      ])
    ).toEqual([{ text: "Something else", status: "pending" }]);
  });

  test("an update patches only the named fields of the named step", () => {
    expect(
      foldPlanEvents(current, [
        { kind: "plan-step-update", steps: [{ id: "2", status: "in-progress" }] },
      ])
    ).toEqual([
      { id: "1", text: "Investigate", status: "completed" },
      { id: "2", text: "Implement", status: "in-progress" },
    ]);
  });

  test("an update for an unknown id appends when it carries text", () => {
    expect(
      foldPlanEvents(current, [
        { kind: "plan-step-update", steps: [{ id: "3", text: "Test" }] },
      ])
    ).toEqual([...current, { id: "3", text: "Test", status: "pending" }]);
  });

  test("an unknown id without text is dropped — there is nothing to render", () => {
    expect(
      foldPlanEvents(current, [
        { kind: "plan-step-update", steps: [{ id: "9", status: "completed" }] },
      ])
    ).toEqual(current);
  });

  test("events apply in stream order, so a snapshot resets earlier patches", () => {
    const events: CliNormalizedEvent[] = [
      { kind: "plan-step-update", steps: [{ id: "2", status: "completed" }] },
      { kind: "plan-progress", steps: [{ text: "Fresh", status: "pending" }] },
      { kind: "plan-step-update", steps: [{ id: "7", text: "After", status: "in-progress" }] },
    ];

    expect(foldPlanEvents(current, events)).toEqual([
      { text: "Fresh", status: "pending" },
      { id: "7", text: "After", status: "in-progress" },
    ]);
  });
});
