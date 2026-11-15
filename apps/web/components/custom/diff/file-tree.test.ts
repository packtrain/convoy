import { describe, expect, test } from "vitest";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { buildFileTree } from "./file-tree";

const file = (path: string, additions = 1, deletions = 0): CliRunDiffFile => ({
  path,
  kind: "modified",
  additions,
  deletions,
});

describe("buildFileTree", () => {
  test("groups files by directory, folders first, and sums counts per folder", () => {
    const tree = buildFileTree([file("README.md", 5), file("src/a.ts", 2, 1), file("src/b.ts", 3, 4), file("src/lib/c.ts", 0, 7)]);

    expect(tree).toEqual([
      {
        kind: "dir",
        name: "src",
        path: "src",
        additions: 5,
        deletions: 12,
        children: [
          {
            kind: "dir",
            name: "lib",
            path: "src/lib",
            additions: 0,
            deletions: 7,
            children: [{ kind: "file", name: "c.ts", file: file("src/lib/c.ts", 0, 7) }],
          },
          { kind: "file", name: "a.ts", file: file("src/a.ts", 2, 1) },
          { kind: "file", name: "b.ts", file: file("src/b.ts", 3, 4) },
        ],
      },
      { kind: "file", name: "README.md", file: file("README.md", 5) },
    ]);
  });

  test("collapses single-child folder chains into one node", () => {
    const tree = buildFileTree([file("apps/web/lib/x.ts"), file("apps/web/lib/y.ts")]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: "dir", name: "apps/web/lib", path: "apps/web/lib" });
    expect((tree[0] as { children: unknown[] }).children).toHaveLength(2);
  });
});
