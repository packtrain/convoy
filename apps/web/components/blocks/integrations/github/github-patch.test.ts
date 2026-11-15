import { describe, expect, test } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
import { toSectionFile, toUnifiedPatch } from "./github-patch";

const base = { additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+hi" };

describe("github patch adapter", () => {
  test("adds git headers for added, removed, and renamed files", () => {
    expect(toUnifiedPatch({ ...base, path: "a.ts", status: "added" })).toBe(
      "diff --git a/a.ts b/a.ts\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1 @@\n+hi\n"
    );
    expect(toUnifiedPatch({ ...base, path: "a.ts", status: "removed" })).toContain("--- a/a.ts\n+++ /dev/null\n");
    expect(toUnifiedPatch({ ...base, path: "new.ts", previousPath: "old.ts", status: "renamed" })).toContain(
      "diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n"
    );
  });

  test("the renderer parses names with control characters, quotes, and backslashes", () => {
    for (const path of ["a\nb.ts", "tab\there.ts", 'we ird "q" \\b.ts']) {
      const patch = toUnifiedPatch({ ...base, path, previousPath: `old-${path}`, status: "renamed" })!;
      const [{ files }] = parsePatchFiles(patch);
      expect(files).toHaveLength(1);
      expect(files[0].hunks).toHaveLength(1);
    }
  });

  test("a file without a patch has no diff instead of an empty one", () => {
    expect(toUnifiedPatch({ path: "logo.png", status: "added", additions: 0, deletions: 0 })).toBeNull();
  });

  test("maps GitHub statuses onto the section header kinds", () => {
    expect(toSectionFile({ ...base, path: "a", status: "removed" }).kind).toBe("deleted");
    expect(toSectionFile({ ...base, path: "a", status: "renamed" }).kind).toBe("modified");
  });
});
