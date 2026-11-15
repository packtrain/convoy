import { describe, expect, test } from "vitest";
import {
  normalizeTaskTitleForCreate,
  parseSectionTitleForCreate,
  parseTaskTitleForCreate,
  sanitizeTaskTitleInputForCreate,
} from "./create-title";

describe("sanitizeTaskTitleInputForCreate", () => {
  test("removes line breaks without trimming surrounding spaces", () => {
    expect(sanitizeTaskTitleInputForCreate("  Ship\nrelease  ")).toBe(
      "  Ship release  "
    );
  });
});

describe("normalizeTaskTitleForCreate", () => {
  test("trims whitespace, collapses repeated spaces, and removes line breaks", () => {
    expect(normalizeTaskTitleForCreate("  Ship\n\nrelease   notes  ")).toBe(
      "Ship release notes"
    );
  });
});

describe("parseTaskTitleForCreate", () => {
  test("returns the normalized title unchanged when no trailing tags exist", () => {
    expect(parseTaskTitleForCreate("Ship release notes")).toEqual({
      name: "Ship release notes",
      tags: [],
    });
  });

  test("extracts multiple trailing tags", () => {
    expect(parseTaskTitleForCreate("Ship release notes #release #qa")).toEqual({
      name: "Ship release notes",
      tags: ["release", "qa"],
    });
  });

  test.each([
    ["#bug", "bug"],
    ["#feat", "feature"],
    ["#feature", "feature"],
    ["#epic", "epic"],
    ["#chore", "chore"],
    ["#idea", "idea"],
    ["#inv", "investigation"],
    ["#investigation", "investigation"],
    ["#investigate", "investigation"],
  ])("infers task type from trailing %s directive", (tag, taskTypeKey) => {
    expect(parseTaskTitleForCreate(`Fix the parser ${tag}`)).toEqual({
      name: "Fix the parser",
      tags: [],
      taskTypeKey,
    });
  });

  test("matches type directives case-insensitively", () => {
    expect(parseTaskTitleForCreate("Fix sign in #Bug #QA")).toEqual({
      name: "Fix sign in",
      tags: ["QA"],
      taskTypeKey: "bug",
    });
  });

  test("keeps regular trailing tags and consumes type directives", () => {
    expect(parseTaskTitleForCreate("Fix auth #backend #bug #QA")).toEqual({
      name: "Fix auth",
      tags: ["backend", "QA"],
      taskTypeKey: "bug",
    });
  });

  test("uses the rightmost type directive when multiple are present", () => {
    expect(parseTaskTitleForCreate("Plan release #bug #feature #epic")).toEqual({
      name: "Plan release",
      tags: [],
      taskTypeKey: "epic",
    });
  });

  test("keeps mid-title hashtags in the task name", () => {
    expect(parseTaskTitleForCreate("Investigate #123 crash report")).toEqual({
      name: "Investigate #123 crash report",
      tags: [],
    });
  });

  test("dedupes trailing tags case-insensitively while preserving first casing", () => {
    expect(parseTaskTitleForCreate("Ship release notes #Backend #backend #QA")).toEqual(
      {
        name: "Ship release notes",
        tags: ["Backend", "QA"],
      }
    );
  });

  test("treats tags-only input as a literal title", () => {
    expect(parseTaskTitleForCreate("#release #qa")).toEqual({
      name: "#release #qa",
      tags: [],
    });
  });
});

describe("parseSectionTitleForCreate", () => {
  test("reads '# Name' as a section name", () => {
    expect(parseSectionTitleForCreate("  #   Design  review ")).toBe("Design review");
  });

  test("leaves tags, bare hashes and mid-title hashes to task creation", () => {
    for (const value of ["#design", "#", "#   ", "Fix # bug"]) {
      expect(parseSectionTitleForCreate(value)).toBeNull();
    }
  });
});
