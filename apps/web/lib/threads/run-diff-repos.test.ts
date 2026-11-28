import { describe, expect, test } from "vitest";
import { checkoutPathOf, folderPathOf, pickChangesRepo, repoPathIdOf, scopeRunToRepo, threadChangesRepos } from "./run-diff-repos";

const repos = [
  { id: "r-api", label: "packages/api" },
  { id: "r-new", label: "new-app" },
  { id: "r-old", label: "old-app" },
];
const run = {
  preRef: "pre",
  postRef: "post",
  files: [
    { path: "a.ts", repo: "new-app" },
    { path: "b.ts", repo: "old-app" },
  ],
  repos: [{ path: "new-app", pathId: "r-new" }, { path: "old-app", pathId: "r-old" }],
};

describe("run-diff-repos", () => {
  test("scopes a multi-repo run to one repo and passes a single-repo run through", () => {
    expect(scopeRunToRepo(run, repos[2])?.files).toEqual([{ path: "b.ts", repo: "old-app" }]);
    const preview = { ...run, fileCount: 9, additions: 9, deletions: 9, repos: [{ path: "old-app", pathId: "r-old", fileCount: 2, additions: 3, deletions: 1 }] };
    expect(scopeRunToRepo(preview, repos[2])).toMatchObject({ fileCount: 2, additions: 3, deletions: 1 });
    expect(scopeRunToRepo(run, repos[0])).toBeNull();
    const single = { preRef: "pre", postRef: "post", files: [{ path: "a.ts" }] };
    expect(scopeRunToRepo(single, repos[0])).toBe(single);
  });

  test("names a file from the folder and finds its repo entry", () => {
    expect(folderPathOf(run.files[0])).toBe("new-app/a.ts");
    expect(folderPathOf({ path: "a.ts" })).toBe("a.ts");
    expect(repoPathIdOf(run, run.files[1])).toBe("r-old");
    expect(repoPathIdOf(run, { repo: "gone" })).toBeUndefined();
  });

  test("picks the remembered repo, else the newest run's first changed repo, else the first", () => {
    expect(pickChangesRepo(repos, "r-old", [run])).toBe(repos[2]);
    expect(pickChangesRepo(repos, "deleted", [{}, run])).toBe(repos[1]);
    expect(pickChangesRepo(repos, null, [])).toBe(repos[0]);
    expect(pickChangesRepo([], null, [run])).toBeUndefined();
  });

  test("lists a repo or worktree thread's own checkout first, then its folder's other repos (OS-2647)", () => {
    const paths = [
      { id: "acme", path: "/code/acme", label: "acme" },
      { id: "new", path: "/code/acme/new-app", label: "new-app", kind: "repo" as const, parentPathId: "acme" },
      { id: "old", path: "/code/acme/old-app", label: "old-app", kind: "repo" as const, parentPathId: "acme" },
      { id: "wt", path: "/code/acme/new-app-worktrees/x", label: "x", kind: "worktree" as const, parentPathId: "new" },
      { id: "solo", path: "/code/solo", label: "solo" },
    ];
    const ids = (pathId: string) => threadChangesRepos(paths, pathId).map(({ id, label }) => [id, label]);
    expect(ids("acme")).toEqual([["new", "new-app"], ["old", "old-app"]]);
    expect(ids("old")).toEqual([["old", "old-app"], ["new", "new-app"]]);
    expect(ids("wt")).toEqual([["wt", "new-app-worktrees/x"], ["new", "new-app"], ["old", "old-app"]]);
    expect(ids("solo")).toEqual([]);
  });

  test("names a file from a repo thread's own checkout (OS-2647)", () => {
    expect(checkoutPathOf({ path: "a.ts", repo: "new-app" }, "new-app")).toBe("a.ts");
    expect(checkoutPathOf({ path: "a.ts", repo: "old-app" }, "new-app")).toBe("../old-app/a.ts");
    expect(checkoutPathOf({ path: "a.ts", repo: "old-app" }, "new-app-worktrees/x")).toBe("../../old-app/a.ts");
    // A run from a CLI before 0.189 has no repo: its paths are the checkout's own.
    expect(checkoutPathOf({ path: "src/a.ts" }, "new-app")).toBe("src/a.ts");
  });
});
