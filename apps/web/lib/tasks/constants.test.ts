import { describe, expect, test } from "vitest";
import { STATUS_CONFIG, STATUS_OPTIONS } from "./constants";
import { Status } from "./types";

describe("STATUS_OPTIONS", () => {
  test("matches the selector-visible workflow statuses in order", () => {
    expect(STATUS_OPTIONS).toEqual([
      Status.TODO,
      Status.TRIAGE,
      Status.PLANNING,
      Status.PLAN_REVIEW,
      Status.IN_PROGRESS,
      Status.IN_REVIEW,
      Status.BLOCKED,
      Status.DONE,
      Status.CANCELED,
    ]);
  });
});

describe("STATUS_CONFIG colors", () => {
  test("states with a semantic meaning use the status tokens", () => {
    expect(STATUS_CONFIG[Status.IN_PROGRESS].color).toBe("text-warning");
    expect(STATUS_CONFIG[Status.IN_REVIEW].color).toBe("text-info");
    expect(STATUS_CONFIG[Status.BLOCKED].color).toBe("text-destructive");
    expect(STATUS_CONFIG[Status.DONE].color).toBe("text-success");
  });

  test("categorical hues pair a 600 light shade with a 400 dark shade", () => {
    expect(STATUS_CONFIG[Status.TRIAGE].color).toBe("text-orange-600 dark:text-orange-400");
    expect(STATUS_CONFIG[Status.PLANNING].color).toBe("text-purple-600 dark:text-purple-400");
    expect(STATUS_CONFIG[Status.PLAN_REVIEW].color).toBe("text-cyan-600 dark:text-cyan-400");
  });
});
