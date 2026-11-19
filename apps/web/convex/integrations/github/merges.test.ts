/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { connectedProject, drain, fakePullRequest, linkGithubAccount, stubGithubAppEnv, type FakeGithubUser, type FakePullRequest } from "../../../convex-testing/github";
import { errors } from "./errors";

beforeEach(async () => {
  vi.useFakeTimers();
  await stubGithubAppEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const MAYA: FakeGithubUser = { id: 42, login: "maya" };

const layer = (number: number, position: number, overrides: Partial<FakePullRequest> = {}) =>
  fakePullRequest(number, { stack: { id: 7, number: 12, size: 3, position }, ...overrides });

/** A connected project whose member linked MAYA, with `role` on the repository. */
async function linkedProject(pulls = [fakePullRequest(1)], role: Record<string, boolean> = { pull: true, triage: true, push: true }) {
  const setup = await connectedProject(pulls);
  await linkGithubAccount(setup.asUser, setup.github, setup.org._id, MAYA);
  setup.github.state.userPermissions.set(MAYA.id, role);
  const pr = (number: number) => setup.github.state.pulls.get(1)!.find((candidate) => candidate.number === number)!;
  const stored = async (number: number) =>
    (await setup.asUser.query(api.integrations.github.pullRequests.get, { projectId: setup.project._id, repositoryId: setup.repositoryId, number }))
      ?.pullRequest;
  const target = (number: number) => ({ projectId: setup.project._id, repositoryId: setup.repositoryId, number });
  const merge = (number: number, options: { method?: "merge" | "squash" | "rebase"; commitTitle?: string; commitMessage?: string; layersBelow?: number[]; deleteBranch?: boolean; headSha?: string } = {}) =>
    setup.asUser.action(api.integrations.github.merges.merge, {
      ...target(number),
      method: options.method ?? "squash",
      headSha: options.headSha ?? pr(number).headSha,
      commitTitle: options.commitTitle,
      commitMessage: options.commitMessage,
      layersBelow: options.layersBelow,
      deleteBranch: options.deleteBranch ?? false,
    });
  return { ...setup, pr, stored, target, merge };
}

describe("integrations.github.merges", () => {
  test("squashes one PR with its commit title as the member, and the stored row follows", async () => {
    const { t, github, merge, stored } = await linkedProject();
    expect(await merge(1, { commitTitle: "  PR 1 (#1)  ", commitMessage: "First line\n\nSecond paragraph" })).toEqual({ status: "merged", branchesKept: [] });
    expect(github.state.merges).toEqual([{ number: 1, method: "squash", title: "PR 1 (#1)", message: "First line\n\nSecond paragraph", async: false }]);
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "merged" });
  });

  test("a head that moved past the reviewed one, or a merge GitHub refuses, reads with GitHub's reason", async () => {
    const { merge, pr } = await linkedProject();
    await expect(merge(1, { headSha: "old-head" })).rejects.toThrow(errors.MERGE_HEAD_CHANGED);
    pr(1).mergeableState = "blocked";
    await expect(merge(1)).rejects.toThrow(`${errors.MERGE_FAILED} At least 1 approving review is required by reviewers with write access.`);
    expect(pr(1).merged).toBe(false);
  });

  test("triage access can't merge, and neither can a member without a Linked GitHub account", async () => {
    const triage = await linkedProject([fakePullRequest(1)], { pull: true, triage: true });
    await expect(triage.merge(1)).rejects.toThrow(errors.PULL_REQUEST_WRITE_REFUSED);
    vi.unstubAllGlobals();

    const { ctx, org, project, target, pr } = await linkedProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");
    await expect(
      ctx.asUser(other).action(api.integrations.github.merges.merge, { ...target(1), method: "merge", headSha: pr(1).headSha, deleteBranch: false })
    ).rejects.toThrow(errors.GITHUB_ACCOUNT_REQUIRED);
  });

  test("a mid-stack Layer merges the open Layers below through merge-async, waiting while GitHub works", async () => {
    const { t, github, merge, stored } = await linkedProject([layer(1, 1), layer(2, 2), layer(3, 3)]);
    github.state.asyncMergePolls = 2;
    let settled = false;
    const merging = merge(2, { layersBelow: [1] }).finally(() => (settled = true));
    // The action registers its poll timers between real awaits; advance a second per real check until it answers.
    await vi.waitFor(() => {
      vi.advanceTimersByTime(1000);
      if (!settled) throw new Error("still merging");
    });
    expect(await merging).toEqual({ status: "merged", branchesKept: [] });
    expect(github.state.requests.filter((request) => request.startsWith("GET") && request.includes("/merge-async/"))).toHaveLength(3);
    expect(github.state.merges.map(({ number, async }) => ({ number, async }))).toEqual([
      { number: 1, async: true },
      { number: 2, async: true },
    ]);
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "merged" });
    expect(await stored(2)).toMatchObject({ state: "merged" });
    expect(await stored(3)).toMatchObject({ state: "open" });
  });

  test("a draft Layer below fails the stack merge with GitHub's reason", async () => {
    const { merge, pr } = await linkedProject([layer(1, 1, { draft: true }), layer(2, 2)]);
    await expect(merge(2, { layersBelow: [1] })).rejects.toThrow(`${errors.MERGE_FAILED} #1 can't be merged.`);
    expect(pr(2).merged).toBe(false);
  });

  test("deletes each merged branch, never a fork's", async () => {
    const { github, merge } = await linkedProject([layer(1, 1), layer(2, 2, { headRef: "stack/two" }), fakePullRequest(4, { headRepositoryId: 99 })]);
    expect(await merge(2, { layersBelow: [1], deleteBranch: true })).toEqual({ status: "merged", branchesKept: [] });
    expect(github.state.deletedBranches).toEqual(["1:feature-1", "1:stack/two"]);

    expect(await merge(4, { deleteBranch: true })).toEqual({ status: "merged", branchesKept: [4] });
    expect(github.state.deletedBranches).toHaveLength(2);
  });

  test("a deletion GitHub refuses keeps the branch; one already gone counts as deleted", async () => {
    const { github, merge } = await linkedProject([fakePullRequest(1), fakePullRequest(2)]);
    github.state.failures.push({ match: /^DELETE .*\/git\/refs\/heads\/feature-1$/, status: 422, message: "Cannot delete this protected branch" });
    expect(await merge(1, { deleteBranch: true })).toEqual({ status: "merged", branchesKept: [1] });

    github.state.deletedBranches.push("1:feature-2");
    expect(await merge(2, { deleteBranch: true })).toEqual({ status: "merged", branchesKept: [] });
  });

  test("a stack merge still running when Convoy stops waiting reports its branches as kept", async () => {
    const { github, merge } = await linkedProject([layer(1, 1), layer(2, 2)]);
    github.state.asyncMergePolls = 1000;
    let settled = false;
    const merging = merge(2, { layersBelow: [1], deleteBranch: true }).finally(() => (settled = true));
    await vi.waitFor(() => {
      vi.advanceTimersByTime(10_000);
      if (!settled) throw new Error("still merging");
    });
    expect(await merging).toEqual({ status: "pending", branchesKept: [1, 2] });
    expect(github.state.deletedBranches).toEqual([]);
  });

  test("merge-async refusing a draft Layer reads with GitHub's reason, not as an outage", async () => {
    const { merge } = await linkedProject([layer(1, 1, { draft: true })]);
    await expect(merge(1, { layersBelow: [] })).rejects.toThrow(`${errors.MERGE_FAILED} Pull request is closed or a draft`);
  });

  test("a merge-async GitHub already has pending reads as in progress, not as new commits", async () => {
    const { github, merge } = await linkedProject([layer(1, 1)]);
    github.state.failures.push({ match: /^PUT .*\/merge-async$/, status: 409, message: "A merge request for this pull request is already pending" });
    await expect(merge(1, { layersBelow: [] })).rejects.toThrow(errors.MERGE_IN_PROGRESS);
  });
});

describe("integrations.github.merges.updateBranch", () => {
  test("updates the branch at the reviewed head, and the stored row follows", async () => {
    const { asUser, t, target, pr, stored } = await linkedProject([fakePullRequest(1, { behindBy: 3 })]);
    await asUser.action(api.integrations.github.merges.updateBranch, { ...target(1), headSha: "head-1" });
    expect(pr(1).headSha).toBe("head-1-updated");
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ headSha: "head-1-updated" });

    await expect(asUser.action(api.integrations.github.merges.updateBranch, { ...target(1), headSha: "head-1" })).rejects.toThrow(
      `${errors.UPDATE_BRANCH_FAILED} expected head sha didn't match current head ref.`
    );
  });
});

describe("integrations.github.pullRequests.readOverview merge settings", () => {
  test("reads the repository's allowed methods and GitHub's branch-rule block", async () => {
    const { asUser, target, github, pr } = await linkedProject();
    github.state.mergeSettings = { mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: true };
    pr(1).mergeableState = "blocked";
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { ...target(1), baseSha: "base", headSha: "head-1" });
    expect(overview).toMatchObject({ mergeSettings: { methods: ["squash", "rebase"], deleteBranchOnMerge: true }, mergeBlock: "blocked" });
  });
});
