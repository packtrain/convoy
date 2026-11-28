import { describe, expect, test } from "vitest";
import { threadBranchLabel } from "./repo-branches";

describe("threadBranchLabel (OS-2523)", () => {
  test("shows the branch, or N branches with each repo's branch on hover", () => {
    expect(threadBranchLabel({ branch: "main" })).toEqual({ text: "main", title: "Branch: main", branch: "main" });
    expect(threadBranchLabel({ repoBranches: [{ repo: "new-app", branch: "feat/x" }, { repo: "old-app" }] })).toEqual({
      text: "2 branches",
      title: "new-app · feat/x\nold-app · no branch",
      repoLines: ["new-app · feat/x", "old-app · no branch"],
      shortText: "2",
    });
    // Counts branches, not repos: "N repos" already means a folder's repos (UX OS-2523 round 1).
    const three = [{ repo: "new-app", branch: "feat/x" }, { repo: "old-app", branch: "main" }, { repo: "packages/api", branch: "main" }];
    expect(threadBranchLabel({ repoBranches: three })?.text).toBe("2 branches");
    expect(threadBranchLabel({})).toBeUndefined();
  });
});
