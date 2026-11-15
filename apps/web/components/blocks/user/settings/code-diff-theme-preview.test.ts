import { describe, expect, test, vi } from "vitest";
import { processFile } from "@pierre/diffs";
import { PREVIEW_PATCH } from "./code-diff-theme-preview";

describe("code diff theme preview patch", () => {
  test("parses without pierre logging a line-level complaint", () => {
    // `throwOnError` does not cover parseLineType — a bad prefix only reaches
    // console.error ("Invalid firstChar" / "invalid rawLine"), which is how this
    // surfaced in the app, so assert on the log itself.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => processFile(PREVIEW_PATCH, { throwOnError: true })).not.toThrow();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("every hunk body line carries a diff prefix", () => {
    const lines = PREVIEW_PATCH.split("\n");
    const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
    expect(hunkStart).toBeGreaterThan(-1);

    // A blank context line must be a single space, never truly empty — that is
    // what made pierre log `Invalid firstChar` for the hand-written patch.
    const body = lines.slice(hunkStart + 1).filter((line, index, all) => index < all.length - 1);
    for (const line of body) {
      expect(["+", "-", " ", "\\"], `bad prefix on: ${JSON.stringify(line)}`).toContain(line[0]);
    }
  });

  test("hunk header counts match the body", () => {
    const lines = PREVIEW_PATCH.split("\n");
    const header = lines.find((line) => line.startsWith("@@"));
    const match = /^@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(header ?? "");
    expect(match).not.toBeNull();

    const body = lines.slice(lines.indexOf(header!) + 1).filter((line) => line !== "");
    const deletions = body.filter((line) => line[0] === "-" || line[0] === " ").length;
    const additions = body.filter((line) => line[0] === "+" || line[0] === " ").length;

    expect(Number(match![1])).toBe(deletions);
    expect(Number(match![2])).toBe(additions);
  });

  test("previews an addition and a deletion so +/- colors are visible", () => {
    const body = PREVIEW_PATCH.split("\n");
    expect(body.some((line) => line.startsWith("+") && !line.startsWith("+++"))).toBe(true);
    expect(body.some((line) => line.startsWith("-") && !line.startsWith("---"))).toBe(true);
  });
});
