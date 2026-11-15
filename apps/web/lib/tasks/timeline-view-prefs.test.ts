/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_TIMELINE_SOURCES,
  readTimelineSortDirection,
  readTimelineSources,
  writeTimelineSortDirection,
  writeTimelineSource,
} from "./timeline-view-prefs";

const ACTIVITY_KEY = "convoy.task-timeline-source-activity";
const THREADS_KEY = "convoy.task-timeline-source-threads";
const SORT_KEY = "convoy.task-timeline-sort-direction";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("timeline source preferences", () => {
  test("defaults every source on when nothing is stored", () => {
    expect(readTimelineSources()).toEqual({ activity: true, comments: true, threads: true });
    expect(readTimelineSources()).toEqual(DEFAULT_TIMELINE_SOURCES);
  });

  test("round-trips a source being turned off and back on", () => {
    writeTimelineSource("activity", false);
    expect(readTimelineSources()).toEqual({ activity: false, comments: true, threads: true });

    writeTimelineSource("activity", true);
    expect(readTimelineSources().activity).toBe(true);
  });

  test("keeps each source independent", () => {
    writeTimelineSource("comments", false);
    writeTimelineSource("threads", false);

    expect(readTimelineSources()).toEqual({ activity: true, comments: false, threads: false });
  });

  test("persists all-off rather than treating it as a special case", () => {
    writeTimelineSource("activity", false);
    writeTimelineSource("comments", false);
    writeTimelineSource("threads", false);

    expect(readTimelineSources()).toEqual({ activity: false, comments: false, threads: false });
  });

  // The default here is *on*, unlike every pref in `changes-view-prefs`, so a
  // corrupt value must not read as off. Only an explicit "0" disables a source.
  test("reads an unrecognized stored value as on", () => {
    window.localStorage.setItem(ACTIVITY_KEY, "nope");
    window.localStorage.setItem(THREADS_KEY, "");

    expect(readTimelineSources()).toEqual({ activity: true, comments: true, threads: true });
  });

  test("falls back to every source on when storage throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(readTimelineSources()).toEqual(DEFAULT_TIMELINE_SOURCES);
  });
});

describe("timeline sort direction preference", () => {
  test("defaults to oldest-first", () => {
    expect(readTimelineSortDirection()).toBe("asc");
  });

  test("round-trips newest-first", () => {
    writeTimelineSortDirection("desc");
    expect(readTimelineSortDirection()).toBe("desc");

    writeTimelineSortDirection("asc");
    expect(readTimelineSortDirection()).toBe("asc");
  });

  test("falls back to oldest-first for an unrecognized stored value", () => {
    window.localStorage.setItem(SORT_KEY, "sideways");
    expect(readTimelineSortDirection()).toBe("asc");
  });
});
