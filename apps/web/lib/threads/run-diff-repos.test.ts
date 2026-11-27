import { describe, expect, test } from "vitest";
import { folderPathOf, pickChangesRepo, repoPathIdOf, scopeRunToRepo } from "./run-diff-repos";

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
});
