import { describe, expect, test } from "vitest";
import { parsePositiveInteger } from "./numbers";

describe("numbers", () => {
  test("parses positive integer strings", () => {
    expect(parsePositiveInteger("30000")).toBe(30000);
  });

  test("rejects malformed or non-positive values", () => {
    expect(parsePositiveInteger("30000abc")).toBeNull();
    expect(parsePositiveInteger("1.5")).toBeNull();
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-1")).toBeNull();
    expect(parsePositiveInteger("")).toBeNull();
    expect(parsePositiveInteger(undefined)).toBeNull();
  });
});

