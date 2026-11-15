// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anchorsEqual,
  composeReviewFeedbackMessage,
  extractPatchExcerpt,
  loadRunReviewComments,
  reviewCommentsPillLabel,
  saveRunReviewComments,
  type RunReviewComment,
} from "./run-review-comments";

const PATCH = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 111..222 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  " const c = 3;",
  "@@ -10,3 +10,4 @@",
  " function tail() {",
  "+  return 42;",
  " }",
].join("\n");

function comment(overrides: Partial<RunReviewComment>): RunReviewComment {
  return {
    path: "src/foo.ts",
    side: "additions",
    lineNumber: 2,
    note: "note",
    createdAt: 1,
    ...overrides,
  };
}

describe("extractPatchExcerpt", () => {
  it("locates addition, deletion, and context lines by their side's numbering", () => {
    // Addition line 2 is `+const b = 20;` (post-run numbering).
    expect(extractPatchExcerpt(PATCH, "additions", 2)).toBe(
      [" const a = 1;", "-const b = 2;", "+const b = 20;", " const c = 3;"].join("\n")
    );
    // Deletion line 2 is `-const b = 2;` (pre-run numbering).
    expect(extractPatchExcerpt(PATCH, "deletions", 2)).toContain("-const b = 2;");
    // Context line via additions numbering.
    expect(extractPatchExcerpt(PATCH, "additions", 3)).toContain(" const c = 3;");
  });

  it("clamps the excerpt to the target's hunk", () => {
    // Addition line 11 (`  return 42;`) sits in the second hunk; the excerpt
    // must not bleed rows from the first hunk.
    const excerpt = extractPatchExcerpt(PATCH, "additions", 11);
    expect(excerpt).toBe([" function tail() {", "+  return 42;", " }"].join("\n"));
  });

  it("returns null for lines outside the patch", () => {
    expect(extractPatchExcerpt(PATCH, "additions", 999)).toBeNull();
  });
});

describe("composeReviewFeedbackMessage", () => {
  it("sorts by path/line and quotes stored excerpts with @path references", () => {
    const message = composeReviewFeedbackMessage([
      comment({ lineNumber: 11, note: "second", excerpt: "+  return 42;" }),
      comment({ lineNumber: 2, note: "first", excerpt: "-const b = 2;\n+const b = 20;" }),
      comment({ path: "a/first.ts", note: "no excerpt captured" }),
    ]);

    expect(message.startsWith("Review feedback on the run's changes:")).toBe(true);
    // Sorted: a/first.ts before src/foo.ts, then by line number.
    const firstIndex = message.indexOf("@a/first.ts (line 2):");
    const secondIndex = message.indexOf("@src/foo.ts (line 2):");
    const thirdIndex = message.indexOf("@src/foo.ts (line 11):");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);
    expect(message).toContain("```diff\n-const b = 2;\n+const b = 20;\n```\nfirst");
    // No excerpt → note without a fence.
    expect(message).toContain("@a/first.ts (line 2):\nno excerpt captured");
  });

  it("labels deletion-side comments as removed lines", () => {
    const message = composeReviewFeedbackMessage([
      comment({ side: "deletions", note: "why removed?" }),
    ]);
    expect(message).toContain("@src/foo.ts (removed line 2):");
  });
});

describe("reviewCommentsPillLabel", () => {
  it("shows the trimmed note for a single comment and a count otherwise", () => {
    expect(reviewCommentsPillLabel([comment({ note: "  fix   this\nplease  " })])).toBe(
      "fix this please"
    );
    expect(
      reviewCommentsPillLabel([comment({ note: "x".repeat(60) })])
    ).toBe(`${"x".repeat(40)}…`);
    expect(reviewCommentsPillLabel([comment({}), comment({ lineNumber: 9 })])).toBe(
      "2 review comments"
    );
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips comments per run and drops malformed entries", () => {
    saveRunReviewComments("ref-a", [comment({ excerpt: "+added line" })]);
    saveRunReviewComments("ref-b", [comment({ lineNumber: 7 })]);

    expect(loadRunReviewComments("ref-a")).toEqual([comment({ excerpt: "+added line" })]);
    expect(loadRunReviewComments("ref-b")[0].lineNumber).toBe(7);
    expect(loadRunReviewComments("ref-missing")).toEqual([]);

    window.localStorage.setItem("convoy.run-review-comments", "{not json");
    expect(loadRunReviewComments("ref-a")).toEqual([]);
  });

  it("deletes a run's entry when saved empty and prunes to the newest 20 runs", () => {
    saveRunReviewComments("ref-a", [comment({})]);
    saveRunReviewComments("ref-a", []);
    expect(loadRunReviewComments("ref-a")).toEqual([]);

    // Distinct updatedAt per save so "newest 20" is deterministic.
    vi.useFakeTimers();
    for (let index = 0; index < 25; index += 1) {
      vi.setSystemTime(1_000 + index);
      saveRunReviewComments(`ref-${index}`, [comment({ note: `note ${index}` })]);
    }
    expect(loadRunReviewComments("ref-0")).toEqual([]);
    expect(loadRunReviewComments("ref-24")[0].note).toBe("note 24");
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("anchorsEqual", () => {
  it("compares path, side, and line", () => {
    expect(anchorsEqual(comment({}), comment({ note: "other" }))).toBe(true);
    expect(anchorsEqual(comment({}), comment({ side: "deletions" }))).toBe(false);
  });
});
