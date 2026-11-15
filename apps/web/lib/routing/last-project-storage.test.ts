/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getLastProjectAlias, setLastProjectAlias } from "./last-project-storage";

describe("last project storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("returns null when nothing is stored", () => {
    expect(getLastProjectAlias("my-org")).toBeNull();
  });

  test("round-trips a project alias", () => {
    setLastProjectAlias("my-org", "ABC");
    expect(getLastProjectAlias("my-org")).toBe("ABC");
  });

  test("scopes storage per org", () => {
    setLastProjectAlias("org-a", "PROJ1");
    setLastProjectAlias("org-b", "PROJ2");

    expect(getLastProjectAlias("org-a")).toBe("PROJ1");
    expect(getLastProjectAlias("org-b")).toBe("PROJ2");
  });

  test("overwrites previous value for the same org", () => {
    setLastProjectAlias("my-org", "OLD");
    setLastProjectAlias("my-org", "NEW");

    expect(getLastProjectAlias("my-org")).toBe("NEW");
  });

  test("fails soft when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(getLastProjectAlias("my-org")).toBeNull();

    vi.restoreAllMocks();
  });

  test("fails soft when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => setLastProjectAlias("my-org", "ABC")).not.toThrow();

    vi.restoreAllMocks();
  });
});
