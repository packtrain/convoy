import { describe, expect, test } from "vitest";
import { toPlanProgress } from "./plan-progress";

describe("toPlanProgress", () => {
  test("returns null without steps", () => {
    expect(toPlanProgress(undefined)).toBeNull();
    expect(toPlanProgress([])).toBeNull();
  });

  test("points at the reported in-progress step", () => {
    expect(
      toPlanProgress([
        { text: "A", status: "completed" },
        { text: "B", status: "in-progress" },
        { text: "C", status: "pending" },
      ])
    ).toMatchObject({ completed: 1, total: 3, currentIndex: 2, currentStep: "B" });
  });

  test("falls back to the first incomplete step when none is in-progress", () => {
    expect(
      toPlanProgress([
        { text: "A", status: "completed" },
        { text: "B", status: "pending" },
        { text: "C", status: "pending" },
      ])
    ).toMatchObject({ currentIndex: 2, currentStep: "B" });
  });

  test("a fully completed plan reads as N/N", () => {
    expect(
      toPlanProgress([
        { text: "A", status: "completed" },
        { text: "B", status: "completed" },
      ])
    ).toMatchObject({ completed: 2, total: 2, currentIndex: 2, currentStep: "B" });
  });
});
