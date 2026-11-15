/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getLastOrganizationSlug, setLastOrganizationSlug } from "./last-org-storage";

describe("last organization storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test("returns null when nothing is stored", () => {
    expect(getLastOrganizationSlug()).toBeNull();
  });

  test("round-trips an org slug, latest write winning", () => {
    setLastOrganizationSlug("acme");
    expect(getLastOrganizationSlug()).toBe("acme");

    setLastOrganizationSlug("globex");
    expect(getLastOrganizationSlug()).toBe("globex");
  });

  test("keeps the storage key stable so existing visitors keep their org", () => {
    setLastOrganizationSlug("acme");
    expect(window.localStorage.getItem("lastOrganizationSlug")).toBe("acme");
  });

  test("fails soft when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setLastOrganizationSlug("acme")).not.toThrow();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getLastOrganizationSlug()).toBeNull();
  });
});
