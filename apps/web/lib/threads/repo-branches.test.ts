import { describe, expect, test } from "vitest";
import { threadBranchLabel } from "./repo-branches";

describe("threadBranchLabel (OS-2523)", () => {
  test("shows the branch, or N repos with each repo's branch on hover", () => {
    expect(threadBranchLabel({ branch: "main" })).toEqual({ text: "main", title: "Branch: main", branch: "main" });
    expect(threadBranchLabel({ repoBranches: [{ repo: "new-app", branch: "feat/x" }, { repo: "old-app" }] })).toEqual({
      text: "2 repos",
      title: "new-app · feat/x\nold-app · no branch",
      repoLines: ["new-app · feat/x", "old-app · no branch"],
    });
    expect(threadBranchLabel({})).toBeUndefined();
  });
});
