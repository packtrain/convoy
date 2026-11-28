import { expect, test } from "vitest";
import { repoScopedPullRequests, type ThreadPullRequest } from "./pull-request";

const pr = (repo: string | undefined, number: number): ThreadPullRequest => ({
  provider: "github",
  number,
  title: "t",
  url: `https://github.com/acme/${repo ?? "app"}/pull/${number}`,
  state: "open",
  headBranch: "feat/x",
  baseBranch: "main",
  capturedAt: 0,
  repo,
});

// UX OS-2523 round 1: the Changes tab shows one repo, so its toolbar shows that repo's PR only.
test("a repo-scoped view keeps that repo's PR; an unscoped one keeps them all", () => {
  const prs = [pr("new-app", 1), pr("packages/api", 2)];
  expect(repoScopedPullRequests(prs, "packages/api")).toEqual([prs[1]]);
  expect(repoScopedPullRequests(prs, "old-app")).toEqual([]);
  expect(repoScopedPullRequests(prs, undefined)).toEqual(prs);
});
