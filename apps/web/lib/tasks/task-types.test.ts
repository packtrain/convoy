import { describe, expect, test } from "vitest";
import {
  normalizeTaskTypeIcon,
  normalizeTaskTypeKey,
  isValidTaskTypeKey,
  resolveTaskTypeSummary,
  getBuiltInTaskTypeByKey,
  getBuiltInTaskTypeKeys,
  getDefaultTaskTypeSummary,
} from "./task-types";

describe("task-types helpers", () => {
  test("normalizes unknown icons to Dot", () => {
    expect(normalizeTaskTypeIcon("Nope")).toBe("Dot");
    expect(normalizeTaskTypeIcon("Bug")).toBe("Bug");
  });

  test("normalizeTaskTypeKey derives a slug from freeform input", () => {
    expect(normalizeTaskTypeKey("Infrastructure chore")).toBe("infrastructure-chore");
    expect(normalizeTaskTypeKey("  Support  ")).toBe("support");
    expect(normalizeTaskTypeKey("ABC DEF")).toBe("abc-def");
  });

  test("isValidTaskTypeKey validates slug format", () => {
    expect(isValidTaskTypeKey("task")).toBe(true);
    expect(isValidTaskTypeKey("infrastructure-chore")).toBe(true);
    expect(isValidTaskTypeKey("")).toBe(false);
    expect(isValidTaskTypeKey("Invalid Key")).toBe(false);
    expect(isValidTaskTypeKey("-leading")).toBe(false);
  });
});

describe("resolveTaskTypeSummary", () => {
  test("returns correct type for known key", () => {
    const bug = resolveTaskTypeSummary("bug");
    expect(bug.key).toBe("bug");
    expect(bug.name).toBe("Bug");
    expect(bug.icon).toBe("Bug");
    expect(bug.isSystem).toBe(true);
  });

  test("returns correct type for idea", () => {
    const idea = resolveTaskTypeSummary("idea");
    expect(idea.key).toBe("idea");
    expect(idea.name).toBe("Idea");
    expect(idea.icon).toBe("Lightbulb");
    expect(idea.color).toBe("#eab308");
    expect(idea.isSystem).toBe(true);
  });

  test("returns default for unknown key", () => {
    const result = resolveTaskTypeSummary("nonexistent");
    expect(result.key).toBe("task");
    expect(result.name).toBe("Task");
  });

  test("returns default for null/undefined", () => {
    expect(resolveTaskTypeSummary(null).key).toBe("task");
    expect(resolveTaskTypeSummary(undefined).key).toBe("task");
  });
});

describe("getBuiltInTaskTypeByKey", () => {
  test("returns definition for valid key", () => {
    const feature = getBuiltInTaskTypeByKey("feature");
    expect(feature).not.toBeNull();
    expect(feature!.key).toBe("feature");
    expect(feature!.name).toBe("Feature");
    expect(feature!.isSystem).toBe(true);
  });

  test("returns null for invalid key", () => {
    expect(getBuiltInTaskTypeByKey("nonexistent")).toBeNull();
  });
});

describe("getBuiltInTaskTypeKeys", () => {
  test("returns array of 7 keys", () => {
    const keys = getBuiltInTaskTypeKeys();
    expect(keys).toHaveLength(7);
    expect(keys).toEqual([
      "task",
      "bug",
      "feature",
      "epic",
      "investigation",
      "chore",
      "idea",
    ]);
  });
});

describe("getDefaultTaskTypeSummary", () => {
  test("returns default task type without isArchived", () => {
    const result = getDefaultTaskTypeSummary();
    expect(result).toEqual({
      key: "task",
      name: "Task",
      icon: "SquareCheckBig",
      color: "#64748b",
      isSystem: true,
    });
  });
});
