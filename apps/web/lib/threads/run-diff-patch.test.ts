import { describe, expect, it } from "vitest";
import { parseRunPatchFiles, splitRunPatch } from "./run-diff-patch";

const PATCH = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+line one",
  "+line two",
  "diff --git a/src/mod.ts b/src/mod.ts",
  "index 2222222..3333333 100644",
  "--- a/src/mod.ts",
  "+++ b/src/mod.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " kept",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/pic.png b/pic.png",
  "index 5555555..6666666 100644",
  "Binary files a/pic.png and b/pic.png differ",
  "",
].join("\n");

describe("splitRunPatch + parseRunPatchFiles", () => {
  it("counts combined hunk lines that look like file headers (OS-2534 round 2 #2)", () => {
    const octopus = "diff --cc a.txt\nindex 1,2,3..4\n--- a/a.txt\n+++ b/a.txt\n@@@@ -1,1 -1,1 -1,1 +1,1 @@@@\n-  one\n - two\n  -three\n+++resolved\n";
    const plus = "diff --cc b.txt\nindex 1,2..3\n--- a/b.txt\n+++ b/b.txt\n@@@ -1,1 -1,1 +1,1 @@@\n++++x\n---y\n";

    expect(parseRunPatchFiles(splitRunPatch(octopus + plus))).toEqual([
      { path: "a.txt", kind: "modified", additions: 1, deletions: 3 },
      { path: "b.txt", kind: "modified", additions: 1, deletions: 1 },
    ]);
  });

  it("keeps a binary conflict resolution and counts combined lines over every parent column (OS-2534 review #6)", () => {
    const binary = "diff --cc b.bin\nindex 1,2..3\nBinary files differ\n";
    const text = "diff --cc a.txt\nindex 1,2..3\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- one\n -two\n++both\n";
    const sections = splitRunPatch(binary + text);

    expect(parseRunPatchFiles(sections)).toEqual([
      { path: "b.bin", kind: "modified", additions: 0, deletions: 0, binary: true },
      { path: "a.txt", kind: "modified", additions: 1, deletions: 2 },
    ]);
  });

  it("keeps a merge commit's combined (--cc) sections, keyed by path (OS-2534)", () => {
    const combined = "diff --cc a.txt\nindex 1,2..3\n--- a/a.txt\n+++ b/a.txt\n@@@ -1,1 -1,1 +1,1 @@@\n- one\n -two\n++both\n";
    const sections = splitRunPatch(combined);
    expect([...sections.keys()]).toEqual(["a.txt"]);
    expect(sections.get("a.txt")).toBe(combined);
  });

  it("splits sections and derives kinds, counts, and binary flags", () => {
    const sections = splitRunPatch(PATCH);
    expect([...sections.keys()]).toEqual(["src/new.ts", "src/mod.ts", "gone.txt", "pic.png"]);

    expect(parseRunPatchFiles(sections)).toEqual([
      { path: "src/new.ts", kind: "added", additions: 2, deletions: 0 },
      { path: "src/mod.ts", kind: "modified", additions: 1, deletions: 1 },
      { path: "gone.txt", kind: "deleted", additions: 0, deletions: 1 },
      { path: "pic.png", kind: "modified", additions: 0, deletions: 0, binary: true },
    ]);
  });

  it("returns empty results for an empty patch", () => {
    const sections = splitRunPatch("");
    expect(sections.size).toBe(0);
    expect(parseRunPatchFiles(sections)).toEqual([]);
  });
});

describe("sections without content lines", () => {
  // An empty file or a mode flip has no ---/+++ lines; the path must come
  // from the diff --git header (OS-2036 review #4).
  const HEADER_ONLY = [
    "diff --git a/empty.txt b/empty.txt",
    "new file mode 100644",
    "index 0000000..e69de29",
    "diff --git a/tracked.txt b/tracked.txt",
    "old mode 100644",
    "new mode 100755",
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "index e69de29..0000000",
    "diff --git a/with space.txt b/with space.txt",
    "new file mode 100644",
    "index 0000000..e69de29",
    "",
  ].join("\n");

  it("keeps header-only files with zero counts", () => {
    const files = parseRunPatchFiles(splitRunPatch(HEADER_ONLY));
    expect(files).toEqual([
      { path: "empty.txt", kind: "added", additions: 0, deletions: 0 },
      { path: "tracked.txt", kind: "modified", additions: 0, deletions: 0 },
      { path: "gone.txt", kind: "deleted", additions: 0, deletions: 0 },
      { path: "with space.txt", kind: "added", additions: 0, deletions: 0 },
    ]);
  });
});
