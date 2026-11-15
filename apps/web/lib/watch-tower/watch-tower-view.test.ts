/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  readWatchTowerScope,
  writeWatchTowerScope,
  DEFAULT_WATCH_TOWER_VIEW_MODE,
  WATCH_TOWER_SECTIONS,
  readHiddenWatchTowerSections,
  readWatchTowerViewMode,
  writeHiddenWatchTowerSections,
  writeWatchTowerViewMode,
} from "./watch-tower-view";

const VIEW_MODE_KEY = "convoy.watch-tower.view-mode";
const HIDDEN_KEY = "convoy.watch-tower.hidden-sections";

describe("watch tower view preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("defaults to the list layout when nothing is stored", () => {
    expect(readWatchTowerViewMode()).toBe(DEFAULT_WATCH_TOWER_VIEW_MODE);
    expect(DEFAULT_WATCH_TOWER_VIEW_MODE).toBe("list");
  });

  test("round-trips the board layout", () => {
    writeWatchTowerViewMode("board");
    expect(readWatchTowerViewMode()).toBe("board");
  });

  test("falls back to the default for an unknown stored mode", () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "kanban");
    expect(readWatchTowerViewMode()).toBe("list");
  });

  test("round-trips hidden sections and drops unknown keys", () => {
    writeHiddenWatchTowerSections(new Set(["done", "running"]));
    expect([...readHiddenWatchTowerSections()].sort()).toEqual(["done", "running"]);

    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(["done", "bogus", 7]));
    expect([...readHiddenWatchTowerSections()]).toEqual(["done"]);
  });

  test("ignores a malformed hidden-sections payload", () => {
    window.localStorage.setItem(HIDDEN_KEY, "{not json");
    expect(readHiddenWatchTowerSections().size).toBe(0);
  });

  test("keeps the section order the board renders columns in", () => {
    expect(WATCH_TOWER_SECTIONS.map((section) => section.status)).toEqual([
      "running",
      "waiting_input",
      "failed",
      "needs_review",
      "done",
    ]);
  });

  test("project scope defaults to all, persists mine, and stays separate by project", () => {
    window.localStorage.clear();
    window.localStorage.setItem("convoy.watch-tower.scope", "mine");
    expect(readWatchTowerScope("org/OS")).toBe("all");
    writeWatchTowerScope("org/OS", "mine");
    expect(readWatchTowerScope("org/OS")).toBe("mine");
    expect(readWatchTowerScope("org/OTHER")).toBe("all");
    expect(readWatchTowerScope("other/OS")).toBe("all");
    window.localStorage.setItem("convoy.watch-tower.project-scope.org/OS", "other");
    expect(readWatchTowerScope("org/OS")).toBe("all");
  });
});
