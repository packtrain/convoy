import { describe, expect, test } from "vitest";
import {
  supportsWorktreeChanges,
  supportsWorktreeDownload,
  supportsWorktreeOpenFile,
  supportsWorktreeRevertAll,
} from "./cli-version";

describe("supportsWorktreeChanges", () => {
  test("accepts the first supporting version and anything newer", () => {
    expect(supportsWorktreeChanges("0.77.0")).toBe(true);
    expect(supportsWorktreeChanges("0.77.1")).toBe(true);
    expect(supportsWorktreeChanges("0.100.0")).toBe(true);
    expect(supportsWorktreeChanges("1.0.0")).toBe(true);
  });

  test("rejects older and unknown versions", () => {
    expect(supportsWorktreeChanges("0.76.2")).toBe(false);
    expect(supportsWorktreeChanges("0.9.9")).toBe(false);
    expect(supportsWorktreeChanges(undefined)).toBe(false);
  });
});

describe("supportsWorktreeOpenFile", () => {
  test("needs the CLI that reads files from disk", () => {
    expect(supportsWorktreeOpenFile("0.82.0")).toBe(true);
    expect(supportsWorktreeOpenFile("0.81.1")).toBe(false);
    expect(supportsWorktreeOpenFile(undefined)).toBe(false);
  });
});

describe("supportsWorktreeDownload", () => {
  test("needs the CLI that uploads a file for download", () => {
    expect(supportsWorktreeDownload("0.83.0")).toBe(true);
    expect(supportsWorktreeDownload("0.82.0")).toBe(false);
  });
});

describe("supportsWorktreeRevertAll", () => {
  test("needs the CLI that answers revertWorkingTree", () => {
    expect(supportsWorktreeRevertAll("0.125.0")).toBe(true);
    expect(supportsWorktreeRevertAll("0.124.2")).toBe(false);
  });
});
