/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  loadCollapsedProjectIds,
  projectListCollapseStorageKey,
  saveCollapsedProjectIds,
} from "./project-list-collapse-storage";

describe("project list collapse storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  test("returns an empty set when storage is empty", () => {
    expect(loadCollapsedProjectIds()).toEqual(new Set());
  });

  test("reads valid collapsed project ids", () => {
    window.localStorage.setItem(
      projectListCollapseStorageKey,
      JSON.stringify(["project_1", "project_2"])
    );

    expect(loadCollapsedProjectIds()).toEqual(
      new Set(["project_1", "project_2"])
    );
  });

  test("ignores malformed and non-string storage values", () => {
    window.localStorage.setItem(projectListCollapseStorageKey, "{oops");
    expect(loadCollapsedProjectIds()).toEqual(new Set());

    window.localStorage.setItem(
      projectListCollapseStorageKey,
      JSON.stringify(["project_1", 123, null])
    );
    expect(loadCollapsedProjectIds()).toEqual(new Set(["project_1"]));
  });

  test("saves collapsed project ids and removes the key for an empty set", () => {
    saveCollapsedProjectIds(new Set(["project_1"]));
    expect(window.localStorage.getItem(projectListCollapseStorageKey)).toBe(
      JSON.stringify(["project_1"])
    );

    saveCollapsedProjectIds(new Set());
    expect(window.localStorage.getItem(projectListCollapseStorageKey)).toBeNull();
  });

  test("fails soft when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadCollapsedProjectIds()).toEqual(new Set());

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      saveCollapsedProjectIds(new Set(["project_1"]))
    ).not.toThrow();
  });
});
