import { describe, expect, test, vi } from "vitest";
import { buildPatch, clearable, mapClearable, mapDefined, sameStoredValue } from "./patch";

type Patch = {
  name?: string;
  description?: string;
  category?: string;
  color?: string;
  count?: number;
  flag?: boolean;
  nullable?: string | null;
};

describe("buildPatch", () => {
  test("keeps defined values and drops undefined ones entirely", () => {
    const patch = buildPatch<Patch>({
      name: "Acme",
      description: undefined,
    });

    expect(patch).toEqual({ name: "Acme" });
    expect("description" in patch).toBe(false);
  });

  test("keeps falsy but defined values", () => {
    const patch = buildPatch<Patch>({
      name: "",
      count: 0,
      flag: false,
    });

    expect(patch).toEqual({ name: "", count: 0, flag: false });
  });

  test("passes null through for fields that allow it", () => {
    const patch = buildPatch<Patch>({ nullable: null });

    expect(patch).toEqual({ nullable: null });
    expect("nullable" in patch).toBe(true);
  });

  test("returns an empty patch when every value is undefined", () => {
    expect(buildPatch<Patch>({ name: undefined, count: undefined })).toEqual({});
  });
});

describe("clearable", () => {
  test("null becomes an explicitly-present undefined key (Convex field removal)", () => {
    const patch = buildPatch<Patch>({ color: clearable<string>(null) });

    expect("color" in patch).toBe(true);
    expect(patch.color).toBeUndefined();
  });

  test("undefined skips the key entirely", () => {
    const patch = buildPatch<Patch>({ color: clearable(undefined) });

    expect("color" in patch).toBe(false);
  });

  test("a value is set, mapped when a mapper is given", () => {
    expect(buildPatch<Patch>({ color: clearable("red") })).toEqual({ color: "red" });
    expect(buildPatch<Patch>({ color: clearable("red", (c) => c.toUpperCase()) })).toEqual({ color: "RED" });
  });

  test("the mapper is not called for null or undefined", () => {
    const map = vi.fn((c: string) => c.toUpperCase());

    clearable(null, map);
    clearable(undefined, map);

    expect(map).not.toHaveBeenCalled();
  });
});

describe("mapDefined", () => {
  test("maps defined values", () => {
    expect(mapDefined("abc", (s) => s.length)).toBe(3);
  });

  test("skips the mapper for undefined", () => {
    const map = vi.fn((s: string) => s.length);

    expect(mapDefined(undefined, map)).toBeUndefined();
    expect(map).not.toHaveBeenCalled();
  });

  test("composes with buildPatch for transform fields", () => {
    const patch = buildPatch<Patch>({
      name: mapDefined("  Acme  ", (name) => name.trim()),
      description: mapDefined(undefined, (d: string) => d.trim()),
    });

    expect(patch).toEqual({ name: "Acme" });
  });
});

describe("mapClearable", () => {
  test("skips the key for undefined input", () => {
    const patch = buildPatch<Patch>({
      description: mapClearable(undefined, (value: string) => value.trim()),
    });

    expect("description" in patch).toBe(false);
  });

  test("maps defined input", () => {
    const patch = buildPatch<Patch>({
      description: mapClearable("  Acme  ", (value) => value.trim()),
    });

    expect(patch).toEqual({ description: "Acme" });
  });

  test("clears the field when the mapper returns null or undefined", () => {
    const nullPatch = buildPatch<Patch>({
      description: mapClearable("", () => null),
    });
    const undefinedPatch = buildPatch<Patch>({
      category: mapClearable("", () => undefined),
    });

    expect("description" in nullPatch).toBe(true);
    expect(nullPatch.description).toBeUndefined();
    expect("category" in undefinedPatch).toBe(true);
    expect(undefinedPatch.category).toBeUndefined();
  });
});

describe("sameStoredValue", () => {
  test("ignores key order and absent-vs-undefined fields", () => {
    expect(sameStoredValue({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(sameStoredValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameStoredValue([{ slug: "p/m", name: "M" }], [{ name: "M", slug: "p/m" }])).toBe(true);
  });

  test("sees real differences, including in nested arrays", () => {
    expect(sameStoredValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameStoredValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameStoredValue([{ variants: ["low"] }], [{ variants: ["high"] }])).toBe(false);
    // Array order is meaningful: it is the order the picker renders.
    expect(sameStoredValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameStoredValue(undefined, [])).toBe(false);
  });
});
