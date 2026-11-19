/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { connectedProject, fakePullRequest, linkGithubAccount, stubGithubAppEnv, type FakeGithubUser } from "../../../convex-testing/github";
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

async function linkedProject(role: Record<string, boolean> = { pull: true, triage: true }, user = MAYA) {
  const setup = await connectedProject([fakePullRequest(1)]);
  await linkGithubAccount(setup.asUser, setup.github, setup.org._id, user);
  setup.github.state.userPermissions.set(user.id, role);
  const target = { projectId: setup.project._id, repositoryId: setup.repositoryId, number: 1 };
  const pr = setup.github.state.pulls.get(1)![0];
  return { ...setup, target, pr };
}

describe("integrations.github.reviews.submit", () => {
  test("approves at the displayed head with inline comments, and returns the review and its comments", async () => {
    const { asUser, target, github } = await linkedProject();
    const result = await asUser.action(api.integrations.github.reviews.submit, {
      ...target,
      headSha: "head-1",
      event: "approve",
      body: "  Looks good  ",
      comments: [
        { path: "src/a.ts", line: 3, side: "RIGHT", body: "Nice" },
        { path: "src/a.ts", line: 1, side: "LEFT", body: "Why remove this?" },
      ],
    });
    expect(github.state.reviewRequests).toEqual([
      {
        number: 1,
        commit_id: "head-1",
        event: "APPROVE",
        body: "Looks good",
        comments: [
          { path: "src/a.ts", line: 3, side: "RIGHT", body: "Nice" },
          { path: "src/a.ts", line: 1, side: "LEFT", body: "Why remove this?" },
        ],
      },
    ]);
    expect(result.review).toMatchObject({ author: "maya", state: "approved", body: "Looks good" });
    expect(result.comments.map(({ path, line, side, body, outdated }) => ({ path, line, side, body, outdated }))).toEqual([
      { path: "src/a.ts", line: 3, side: "RIGHT", body: "Nice", outdated: false },
      { path: "src/a.ts", line: 1, side: "LEFT", body: "Why remove this?", outdated: false },
    ]);
  });

  test("a comment on a range of lines posts GitHub's start line and side with its last line", async () => {
    const { asUser, target, github } = await linkedProject();
    await asUser.action(api.integrations.github.reviews.submit, {
      ...target,
      headSha: "head-1",
      event: "comment",
      body: "",
      comments: [
        { path: "src/a.ts", startLine: 2, startSide: "LEFT", line: 4, side: "RIGHT", body: "This loop reads twice" },
        { path: "src/a.ts", line: 9, side: "RIGHT", body: "One line" },
      ],
    });
    expect(github.state.reviewRequests[0].comments).toEqual([
      { path: "src/a.ts", start_line: 2, start_side: "LEFT", line: 4, side: "RIGHT", body: "This loop reads twice" },
      { path: "src/a.ts", line: 9, side: "RIGHT", body: "One line" },
    ]);
  });

  test("a comment review needs a body or an inline comment, and Request changes needs a body", async () => {
    const { asUser, target, github } = await linkedProject();
    const review = { ...target, headSha: "head-1", comments: [] };
    await expect(asUser.action(api.integrations.github.reviews.submit, { ...review, event: "comment", body: " " })).rejects.toThrow(errors.COMMENT_EMPTY);
    await expect(asUser.action(api.integrations.github.reviews.submit, { ...review, event: "request_changes", body: "" })).rejects.toThrow(
      errors.REVIEW_CHANGES_NEED_BODY
    );
    await expect(
      asUser.action(api.integrations.github.reviews.submit, { ...review, event: "comment", body: "", comments: [{ path: "a", line: 1, side: "RIGHT", body: " " }] })
    ).rejects.toThrow(errors.COMMENT_EMPTY);
    expect(github.state.reviewRequests).toEqual([]);

    // A single inline comment is a comment review with no body.
    const single = await asUser.action(api.integrations.github.reviews.submit, {
      ...review,
      event: "comment",
      body: "",
      comments: [{ path: "a", line: 1, side: "RIGHT", body: "Typo" }],
    });
    expect(single.review.state).toBe("commented");
    expect(single.comments).toHaveLength(1);
  });

  test("GitHub refusing the review (a moved head, approving your own PR) reads as refused", async () => {
    const { asUser, target } = await linkedProject();
    await expect(
      asUser.action(api.integrations.github.reviews.submit, { ...target, headSha: "stale", event: "approve", body: "", comments: [] })
    ).rejects.toThrow(errors.COMMENT_REFUSED);

    vi.unstubAllGlobals();
    const author = await linkedProject(undefined, { id: 7, login: "octocat" });
    await expect(
      author.asUser.action(api.integrations.github.reviews.submit, { ...author.target, headSha: "head-1", event: "approve", body: "", comments: [] })
    ).rejects.toThrow(errors.COMMENT_REFUSED);
  });

  test("a review GitHub accepted is never posted again when reading its comments fails", async () => {
    for (const status of [500, 401]) {
      vi.unstubAllGlobals();
      const { asUser, target, github } = await linkedProject();
      github.state.failures.push({ match: /^GET \/repositories\/1\/pulls\/1\/comments$/, status });
      const result = await asUser.action(api.integrations.github.reviews.submit, {
        ...target,
        headSha: "head-1",
        event: "comment",
        body: "",
        comments: [{ path: "a", line: 1, side: "RIGHT", body: "Typo" }],
      });
      expect(github.state.reviewRequests).toHaveLength(1);
      // Refresh shows the comments; the review itself is posted.
      expect(result).toMatchObject({ review: { state: "commented" }, comments: [] });
    }
  });

  test("a member without a Linked GitHub account can't review", async () => {
    const { ctx, org, project, target } = await linkedProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");
    await expect(
      ctx.asUser(other).action(api.integrations.github.reviews.submit, { ...target, headSha: "head-1", event: "comment", body: "Hi", comments: [] })
    ).rejects.toThrow(errors.GITHUB_ACCOUNT_REQUIRED);
  });
});

describe("integrations.github.reviews.requestReviewer", () => {
  test("requests and withdraws a review, returning GitHub's requested reviewers", async () => {
    const { asUser, target, pr } = await linkedProject();
    pr.requestedReviewers = ["sam"];
    expect(await asUser.action(api.integrations.github.reviews.requestReviewer, { ...target, login: "maya", requested: true })).toEqual(["sam", "maya"]);
    expect(await asUser.action(api.integrations.github.reviews.requestReviewer, { ...target, login: "sam", requested: false })).toEqual(["maya"]);
  });

  test("requested teams stay out of the requested people, which a person's request checks against", async () => {
    const { asUser, target, pr } = await linkedProject();
    pr.requestedTeams = ["core"];
    expect(await asUser.action(api.integrations.github.reviews.requestReviewer, { ...target, login: "sam", requested: true })).toEqual(["sam"]);
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { ...target, baseSha: "base", headSha: "head-1" });
    expect(overview).toMatchObject({ requestedReviewers: ["sam"], requestedTeams: ["core"] });
  });

  test("GitHub refusing the request (the author, or below triage) reads as refused", async () => {
    const { asUser, target } = await linkedProject();
    await expect(asUser.action(api.integrations.github.reviews.requestReviewer, { ...target, login: "octocat", requested: true })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
    vi.unstubAllGlobals();
    const reader = await linkedProject({ pull: true });
    await expect(reader.asUser.action(api.integrations.github.reviews.requestReviewer, { ...reader.target, login: "sam", requested: true })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
  });
});

describe("integrations.github.pullRequests.readOverview review threads", () => {
  test("lists resolved and outdated threads with their first comment, and leaves open ones out", async () => {
    const { asUser, target, pr } = await linkedProject();
    const thread = (isResolved: boolean, isOutdated: boolean, path: string, line: number | null) => ({
      isResolved,
      isOutdated,
      path,
      line,
      originalLine: 9,
      comments: { nodes: [{ author: { login: "sam" }, body: `About ${path}` }] },
    });
    pr.reviewThreads = [thread(true, false, "a.ts", 3), thread(false, true, "b.ts", null), thread(false, false, "c.ts", 5)];
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { ...target, baseSha: "base", headSha: "head-1" });
    expect(overview.settledThreads).toEqual([
      { path: "a.ts", line: 3, resolved: true, outdated: false, author: "sam", body: "About a.ts" },
      { path: "b.ts", line: 9, resolved: false, outdated: true, author: "sam", body: "About b.ts" },
    ]);
  });
});
