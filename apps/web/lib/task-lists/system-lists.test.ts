import { describe, expect, test } from "vitest";
import { isBacklogListRef, isSystemListRef } from "./system-lists";

describe("system Lists", () => {
  test("recognizes the Backlog system List ref case-insensitively", () => {
    expect(isBacklogListRef("BACKLOG")).toBe(true);
    expect(isBacklogListRef("backlog")).toBe(true);
    expect(isBacklogListRef(" Backlog ")).toBe(true);
    expect(isBacklogListRef("ARCHIVED")).toBe(false);
    expect(isBacklogListRef("SPRINT")).toBe(false);
    expect(isBacklogListRef(null)).toBe(false);
    expect(isBacklogListRef(undefined)).toBe(false);
  });

  test("recognizes any system List ref", () => {
    expect(isSystemListRef("BACKLOG")).toBe(true);
    expect(isSystemListRef("backlog")).toBe(true);
    expect(isSystemListRef(" Backlog ")).toBe(true);
    expect(isSystemListRef("ARCHIVED")).toBe(false);
    expect(isSystemListRef("SPRINT")).toBe(false);
    expect(isSystemListRef(null)).toBe(false);
    expect(isSystemListRef(undefined)).toBe(false);
  });
});
