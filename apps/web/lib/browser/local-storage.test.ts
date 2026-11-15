/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readLocalJson,
  readLocalString,
  removeLocalValue,
  writeLocalJson,
  writeLocalString,
} from "./local-storage";

const KEY = "convoy.test-local-storage";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readLocalString", () => {
  test("returns null when the key is unset", () => {
    expect(readLocalString(KEY)).toBeNull();
  });

  test("returns the stored value", () => {
    window.localStorage.setItem(KEY, "stored");
    expect(readLocalString(KEY)).toBe("stored");
  });

  test("returns null when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readLocalString(KEY)).toBeNull();
  });
});

describe("writeLocalString", () => {
  test("round-trips through readLocalString", () => {
    expect(writeLocalString(KEY, "value")).toBe(true);
    expect(readLocalString(KEY)).toBe("value");
  });

  test("reports failure instead of throwing when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeLocalString(KEY, "value")).toBe(false);
  });
});

describe("removeLocalValue", () => {
  test("clears a stored value", () => {
    writeLocalString(KEY, "value");
    expect(removeLocalValue(KEY)).toBe(true);
    expect(readLocalString(KEY)).toBeNull();
  });

  test("reports failure instead of throwing when storage throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(removeLocalValue(KEY)).toBe(false);
  });
});

describe("readLocalJson", () => {
  test("returns undefined when the key is unset", () => {
    expect(readLocalJson(KEY)).toBeUndefined();
  });

  test("returns undefined for malformed JSON", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readLocalJson(KEY)).toBeUndefined();
  });

  test("parses stored payloads, including falsy ones", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(readLocalJson(KEY)).toEqual({ a: 1 });

    window.localStorage.setItem(KEY, JSON.stringify(null));
    expect(readLocalJson(KEY)).toBeNull();

    window.localStorage.setItem(KEY, JSON.stringify(false));
    expect(readLocalJson(KEY)).toBe(false);
  });
});

describe("writeLocalJson", () => {
  test("round-trips through readLocalJson", () => {
    expect(writeLocalJson(KEY, { list: ["a", "b"] })).toBe(true);
    expect(readLocalJson(KEY)).toEqual({ list: ["a", "b"] });
  });

  test("reports failure for unserializable payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(writeLocalJson(KEY, cyclic)).toBe(false);
    expect(readLocalString(KEY)).toBeNull();
  });

  test("reports failure for values JSON.stringify drops", () => {
    expect(writeLocalJson(KEY, undefined)).toBe(false);
    expect(readLocalString(KEY)).toBeNull();
  });

  test("reports failure instead of throwing when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(writeLocalJson(KEY, { a: 1 })).toBe(false);
  });
});
