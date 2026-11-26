import { describe, expect, it } from "vitest";
import { defaultCommitMessage } from "./pull-request-merge";

const pr = { number: 8, title: "Worktree setup scripts", headRef: "os-1116-setup" };
const commits = [
  "refactor(worktrees): split the setup runner",
  "feat(worktrees): run a repo's setup script in new worktrees (OS-2572)",
  "fixup! feat(worktrees): run a repo's setup script in new worktrees (OS-2572)",
  "Merge branch 'main' into os-1116-setup",
  "feat(worktrees): let teammates approve a repo's setup script (OS-2573)",
  "feat(worktrees): let teammates approve a repo's setup script (OS-2573)",
  "squash! feat(worktrees): let teammates approve",
].map((message) => ({ message }));
const bullets = [
  "- refactor(worktrees): split the setup runner",
  "- feat(worktrees): run a repo's setup script in new worktrees (OS-2572)",
  "- feat(worktrees): let teammates approve a repo's setup script (OS-2573)",
].join("\n");

describe("defaultCommitMessage", () => {
  it("squash: borrows the feat prefix, adds the PR's task ref, and lists each commit once", () => {
    expect(defaultCommitMessage("squash", pr, commits, ["OS-1116"], commits.length)).toBe(`feat(worktrees): Worktree setup scripts (OS-1116) (#8)\n\n${bullets}`);
  });

  it("squash: keeps a conventional title and a ref it already names", () => {
    const titled = { ...pr, title: "fix(ux): OS-1116 setup polish" };
    expect(defaultCommitMessage("squash", titled, commits, ["OS-1116"], commits.length).split("\n")[0]).toBe("fix(ux): OS-1116 setup polish (#8)");
  });

  it("squash: adds no prefix when the commits aren't conventional", () => {
    expect(defaultCommitMessage("squash", pr, [{ message: "Add setup scripts" }], [], 1)).toBe("Worktree setup scripts (#8)\n\n- Add setup scripts");
  });

  it("leaves the body to GitHub when the Overview holds only part of the commits", () => {
    expect(defaultCommitMessage("squash", pr, commits, ["OS-1116"], commits.length + 1)).toBe("feat(worktrees): Worktree setup scripts (OS-1116) (#8)");
  });

  it("merge: lists the commits under GitHub's default title", () => {
    expect(defaultCommitMessage("merge", pr, commits, ["OS-1116"], commits.length)).toBe(`Merge pull request #8 from os-1116-setup\n\n${bullets}`);
  });
});
