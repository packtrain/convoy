import { describe, expect, test } from "vitest";
import {
  isArray,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
} from "./type-guards";

describe("type-guards", () => {
  test("isRecord accepts plain objects and rejects arrays/null", () => {
    expect(isRecord({ foo: "bar" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  test("primitive guards only accept matching primitive values", () => {
    expect(isString("hello")).toBe(true);
    expect(isString(1)).toBe(false);

    expect(isNumber(1)).toBe(true);
    expect(isNumber("1")).toBe(false);

    expect(isBoolean(true)).toBe(true);
    expect(isBoolean("true")).toBe(false);
  });

  test("array guards distinguish generic arrays from string arrays", () => {
    expect(isArray(["a", "b"])).toBe(true);
    expect(isArray("nope")).toBe(false);

    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray({ 0: "a" })).toBe(false);
  });
});
