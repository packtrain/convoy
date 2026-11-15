import { describe, expect, it } from "vitest";
import {
  getProjectAliasFromTaskRef,
  isTaskRef,
  parseScopedTaskRef,
  parseOptionalCommentsLimit,
  parseOptionalTaskArchiveMode,
  parseOptionalDueDate,
  parseOptionalListIdentifier,
  parseOptionalTags,
  parseOptionalTaskPriority,
  parseOptionalTaskStatus,
  parseOptionalTaskTypeKey,
  validateNoConflict,
} from "./parsers.js";

describe("tasks parsers", () => {
  it("rejects empty status values", () => {
    expect(() => parseOptionalTaskStatus("   ")).toThrow(/Status must be a non-empty string/);
  });

  it("parses optional priority, status, and task type key", () => {
    expect(parseOptionalTaskPriority("High")).toBe("High");
    expect(parseOptionalTaskStatus("Plan Review")).toBe("Plan Review");
    expect(parseOptionalTaskArchiveMode("archived")).toBe("archived");
    expect(parseOptionalTaskTypeKey(" bug ")).toBe("bug");
  });

  it("parses List identifiers without normalizing them", () => {
    expect(parseOptionalListIdentifier(undefined)).toBeUndefined();
    expect(parseOptionalListIdentifier(" SPRINT-1 ")).toBe("SPRINT-1");
    expect(parseOptionalListIdentifier(" nx7b79ahee74yeq64gtx2wxbr1879rnv ")).toBe(
      "nx7b79ahee74yeq64gtx2wxbr1879rnv"
    );
  });

  it("rejects empty and scoped List identifiers", () => {
    expect(() => parseOptionalListIdentifier("   ")).toThrow(/non-empty/);
    expect(() => parseOptionalListIdentifier("OTHER/SPRINT-1")).toThrow(
      /Cross-project List refs/
    );
  });

  it("detects task refs", () => {
    expect(isTaskRef("OS-667")).toBe(true);
    expect(isTaskRef("os-667")).toBe(true);
    expect(isTaskRef("task_123")).toBe(false);
    expect(isTaskRef("contoso/OS-667")).toBe(false);
  });

  it("parses scoped refs", () => {
    expect(parseScopedTaskRef("acme/OS-667")).toEqual({
      orgSlug: "acme",
      ref: "OS-667",
    });
    expect(parseScopedTaskRef("  acme/os-667  ")).toEqual({
      orgSlug: "acme",
      ref: "OS-667",
    });
    expect(parseScopedTaskRef("OS-667")).toBeUndefined();
    expect(getProjectAliasFromTaskRef("OS-667")).toBe("OS");
  });

  it("parses optional tags", () => {
    expect(parseOptionalTags(["a", "b,c"])).toEqual(["a", "b", "c"]);
    expect(parseOptionalTags(undefined)).toBeUndefined();
  });

  it("parses optional comments limit", () => {
    expect(parseOptionalCommentsLimit(undefined)).toBeUndefined();
    expect(parseOptionalCommentsLimit("1")).toBe(1);
    expect(parseOptionalCommentsLimit("50")).toBe(50);
  });

  it("rejects invalid comments limits", () => {
    expect(() => parseOptionalCommentsLimit("0")).toThrow(/integer from 1 to 50/);
    expect(() => parseOptionalCommentsLimit("-1")).toThrow(/integer from 1 to 50/);
    expect(() => parseOptionalCommentsLimit("51")).toThrow(/integer from 1 to 50/);
    expect(() => parseOptionalCommentsLimit("abc")).toThrow(/integer from 1 to 50/);
  });

  it("parses due dates from seconds, milliseconds, and ISO", () => {
    expect(parseOptionalDueDate("1700000000")).toBe(1700000000000);
    expect(parseOptionalDueDate("01700000000")).toBe(1700000000000);
    expect(parseOptionalDueDate("1700000000000")).toBe(1700000000000);
    expect(parseOptionalDueDate("2026-01-01T00:00:00.000Z")).toBe(
      Date.parse("2026-01-01T00:00:00.000Z")
    );
  });

  it("rejects invalid due date", () => {
    expect(() => parseOptionalDueDate("not-a-date")).toThrow(/Invalid due date/);
  });

  it("validates conflicts", () => {
    expect(() => validateNoConflict(true, true, "boom")).toThrow(/boom/);
    expect(() => validateNoConflict(true, false, "boom")).not.toThrow();
  });
});
