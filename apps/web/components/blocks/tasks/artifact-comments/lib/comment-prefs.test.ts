/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_COMMENT_PREFS,
  readCommentPrefs,
  writeCommentPrefs,
} from "./comment-prefs";

const STORAGE_KEY = "task-artifact-comment-prefs";

describe("comment-prefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(readCommentPrefs()).toEqual(DEFAULT_COMMENT_PREFS);
  });

  it("round-trips written prefs", () => {
    writeCommentPrefs({ showResolved: false, sort: "newest", isOpen: true });
    expect(readCommentPrefs()).toEqual({
      showResolved: false,
      sort: "newest",
      isOpen: true,
    });
  });

  it("merges partial writes into the stored prefs", () => {
    writeCommentPrefs({ showResolved: false, sort: "newest" });
    writeCommentPrefs({ isOpen: true });
    expect(readCommentPrefs()).toEqual({
      showResolved: false,
      sort: "newest",
      isOpen: true,
    });
  });

  it("falls back to defaults on invalid JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(readCommentPrefs()).toEqual(DEFAULT_COMMENT_PREFS);
  });

  it("self-corrects invalid stored fields", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showResolved: "yes", sort: "sideways" })
    );
    expect(readCommentPrefs()).toEqual(DEFAULT_COMMENT_PREFS);
  });
});
