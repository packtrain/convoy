import { describe, expect, test } from "vitest";
import { deriveProjectRouteState } from "./nav-projects-route-state";

describe("deriveProjectRouteState", () => {
  test("returns null state for unrelated paths", () => {
    expect(deriveProjectRouteState("/", "org")).toEqual({
      activeProjectAlias: null,
      activeSection: null,
    });
    expect(deriveProjectRouteState("", "org")).toEqual({
      activeProjectAlias: null,
      activeSection: null,
    });
    expect(deriveProjectRouteState("/o/other-org/ABC", "org")).toEqual({
      activeProjectAlias: null,
      activeSection: null,
    });
  });

  test("returns null state when no project alias segment is present", () => {
    expect(deriveProjectRouteState("/o/org", "org")).toEqual({
      activeProjectAlias: null,
      activeSection: null,
    });
    expect(deriveProjectRouteState("/o/org/", "org")).toEqual({
      activeProjectAlias: null,
      activeSection: null,
    });
  });

  test("derives list section for project root route", () => {
    expect(deriveProjectRouteState("/o/org/ABC", "org")).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "list",
    });
  });

  test("derives list section for project root route with trailing slash", () => {
    expect(deriveProjectRouteState("/o/org/ABC/", "org")).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "list",
    });
  });

  test("derives kanban section for kanban route", () => {
    expect(deriveProjectRouteState("/o/org/ABC/kanban", "org")).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "kanban",
    });
  });

  test("derives threads section for thread list route", () => {
    expect(deriveProjectRouteState("/o/org/ABC/threads", "org")).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "threads",
    });
  });

  test("keeps threads section for thread detail route", () => {
    expect(deriveProjectRouteState("/o/org/ABC/threads/thread_123", "org")).toEqual(
      {
        activeProjectAlias: "ABC",
        activeSection: "threads",
      }
    );
  });

  test("derives artifacts section for artifact full-page route", () => {
    expect(
      deriveProjectRouteState("/o/org/ABC/artifacts/artifact_123", "org")
    ).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "artifacts",
    });
  });

  test("derives other section for non-list project sub-routes", () => {
    expect(deriveProjectRouteState("/o/org/ABC/settings", "org")).toEqual({
      activeProjectAlias: "ABC",
      activeSection: "other",
    });
  });
  test("recognizes project pull requests", () => {
    expect(deriveProjectRouteState("/o/org/ABC/pull-requests", "org")).toEqual({
      activeProjectAlias: "ABC", activeSection: "pull-requests",
    });
  });

  test("recognizes project Watch Tower", () => {
    expect(deriveProjectRouteState("/o/org/ABC/watch-tower", "org")).toEqual({
      activeProjectAlias: "ABC", activeSection: "watch-tower",
    });
  });
});
