import { describe, expect, it } from "vitest";
import { parseId } from "./id.js";

describe("parseId", () => {
  it("trims and returns valid id-like values", () => {
    expect(parseId("  abc123_DEF  ", "taskId")).toBe("abc123_DEF");
  });

  it("rejects empty values", () => {
    expect(() => parseId("   ", "taskId")).toThrow(/taskId is required/);
  });

  it("rejects obviously invalid ids", () => {
    expect(() => parseId("abc 123", "taskId")).toThrow(/valid Convex ID/);
    expect(() => parseId("abc/123", "taskId")).toThrow(/valid Convex ID/);
  });

  it("rejects a task ref before it reaches Convex", () => {
    expect(() => parseId("OS-2256", "taskId")).toThrow(
      'taskId "OS-2256" looks like a ref, not a Convex ID'
    );
  });
});
