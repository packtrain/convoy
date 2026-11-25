/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import {
  readFileTreeSide,
  useFileTreeSide,
  writeFileTreeSide,
  readChangesFileTree,
  writeChangesFileTree,
  readThreadLayoutMode,
  writeThreadLayoutMode,
} from "./changes-view-prefs";

const KEY = "convoy.thread-layout-mode";

describe("thread layout mode preference", () => {
  afterEach(() => window.localStorage.clear());

  test("defaults to the split layout when unset", () => {
    expect(readThreadLayoutMode()).toBe("split");
  });

  test("round-trips the full layout", () => {
    writeThreadLayoutMode("full");
    expect(readThreadLayoutMode()).toBe("full");

    writeThreadLayoutMode("split");
    expect(readThreadLayoutMode()).toBe("split");
  });

  test("falls back to split for unrecognized stored values", () => {
    window.localStorage.setItem(KEY, "tabs");
    expect(readThreadLayoutMode()).toBe("split");
  });
});


describe("Changes file tree preference", () => {
  afterEach(() => window.localStorage.clear());
  test("defaults to hidden and rejects unknown stored values", () => {
    expect(readChangesFileTree()).toBe(false);
    window.localStorage.setItem("convoy.thread-changes-file-tree", "true");
    expect(readChangesFileTree()).toBe(false);
  });
  test("remembers both open and closed states", () => {
    writeChangesFileTree(true);
    expect(readChangesFileTree()).toBe(true);
    writeChangesFileTree(false);
    expect(readChangesFileTree()).toBe(false);
  });
});

describe("file tree side preference", () => {
  afterEach(() => window.localStorage.clear());
  test("defaults to the right and rejects unknown stored values", () => {
    expect(readFileTreeSide()).toBe("right");
    window.localStorage.setItem("convoy.changes-file-tree-side", "top");
    expect(readFileTreeSide()).toBe("right");
  });
  test("a write reaches already-mounted readers", () => {
    const { result } = renderHook(() => useFileTreeSide());
    expect(result.current).toBe("right");
    act(() => writeFileTreeSide("left"));
    expect(result.current).toBe("left");
    expect(readFileTreeSide()).toBe("left");
  });
});
