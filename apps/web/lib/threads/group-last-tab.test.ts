/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import { readGroupLastTab, writeGroupLastTab } from "./group-last-tab";

describe("group-last-tab", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("returns undefined when nothing was stored", () => {
    expect(readGroupLastTab("container-1")).toBeUndefined();
  });

  test("round-trips the last viewed child per container", () => {
    writeGroupLastTab("container-1", "child-a");
    writeGroupLastTab("container-2", "child-b");

    expect(readGroupLastTab("container-1")).toBe("child-a");
    expect(readGroupLastTab("container-2")).toBe("child-b");

    writeGroupLastTab("container-1", "child-c");
    expect(readGroupLastTab("container-1")).toBe("child-c");
  });
});
