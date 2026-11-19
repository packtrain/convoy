/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { connectedProject, drain, fakePullRequest, linkGithubAccount, stubGithubAppEnv, type FakeGithubUser } from "../../../convex-testing/github";
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

/** A connected project whose member linked MAYA, with `role` on the repository. */
async function linkedProject(role: Record<string, boolean> = { pull: true, triage: true, push: true }) {
  const setup = await connectedProject([fakePullRequest(1), fakePullRequest(2, { state: "closed", merged: true })]);
  await linkGithubAccount(setup.asUser, setup.github, setup.org._id, MAYA);
  setup.github.state.userPermissions.set(MAYA.id, role);
  const pr = (number: number) => setup.github.state.pulls.get(1)!.find((candidate) => candidate.number === number)!;
  const stored = async (number: number) =>
    (await setup.asUser.query(api.integrations.github.pullRequests.get, { projectId: setup.project._id, repositoryId: setup.repositoryId, number }))
      ?.pullRequest;
  const target = (number: number) => ({ projectId: setup.project._id, repositoryId: setup.repositoryId, number });
  return { ...setup, pr, stored, target };
}

describe("integrations.github.states", () => {
  test("closes, reopens, converts to draft, and marks ready as the member, and the stored row follows", async () => {
    const { asUser, t, pr, stored, target, github } = await linkedProject();
    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "close" });
    expect(pr(1).state).toBe("closed");
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "closed" });

    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "reopen" });
    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "draft" });
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "open", draft: true });
    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "ready" });
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ draft: false });
    // Every write used the member's own token, never the installation's.
    expect(github.state.requests.filter((request) => request === "POST /graphql")).toHaveLength(2);
  });

  test("archiving closes an open PR and keeps a merged one merged; unarchiving leaves it closed", async () => {
    const { asUser, t, stored, target } = await linkedProject();
    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "archive" });
    await asUser.action(api.integrations.github.states.update, { ...target(2), change: "archive" });
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "closed", archived: true });
    expect(await stored(2)).toMatchObject({ state: "merged", archived: true });

    await asUser.action(api.integrations.github.states.update, { ...target(1), change: "unarchive" });
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ state: "closed", archived: false });
  });

  test("GitHub's role decides: triage closes but can't convert to draft, read-only can't close", async () => {
    const triage = await linkedProject({ pull: true, triage: true });
    await triage.asUser.action(api.integrations.github.states.update, { ...triage.target(1), change: "close" });
    await expect(triage.asUser.action(api.integrations.github.states.update, { ...triage.target(1), change: "draft" })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
    vi.unstubAllGlobals();

    const reader = await linkedProject({ pull: true });
    await expect(reader.asUser.action(api.integrations.github.states.update, { ...reader.target(1), change: "close" })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
    expect(reader.pr(1).state).toBe("open");
  });

  test("a merged PR can't be closed, and a member without a Linked GitHub account can't write", async () => {
    const { asUser, target, ctx, org, project } = await linkedProject();
    await expect(asUser.action(api.integrations.github.states.update, { ...target(2), change: "close" })).rejects.toThrow(errors.PULL_REQUEST_WRITE_REFUSED);

    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");
    await expect(ctx.asUser(other).action(api.integrations.github.states.update, { ...target(1), change: "close" })).rejects.toThrow(errors.GITHUB_ACCOUNT_REQUIRED);
  });
});

describe("integrations.github.assignees", () => {
  test("searches GitHub's assignable people, 20 at a time", async () => {
    const { asUser, target, github } = await linkedProject();
    github.state.assignable = Array.from({ length: 30 }, (_, index) => `dev${index}`);
    const list = (query?: string) => asUser.action(api.integrations.github.assignees.list, { ...target(1), query });
    expect((await list()).map((person) => person.login)).toEqual(Array.from({ length: 20 }, (_, index) => `dev${index}`));
    // Past the first 20: GitHub searches them all.
    expect((await list("dev29")).map((person) => person.login)).toEqual(["dev29"]);
  });

  test("lists assignable people, assigns and unassigns one at a time, and assigns to nobody", async () => {
    const { asUser, t, pr, stored, target } = await linkedProject();
    expect((await asUser.action(api.integrations.github.assignees.list, target(1))).map((person) => person.login)).toEqual(["octocat", "maya", "sam"]);

    await asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "maya", assigned: true });
    const after = await asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "sam", assigned: true });
    expect(after.map((person) => person.login)).toEqual(["maya", "sam"]);
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ assignees: ["maya", "sam"] });

    expect((await asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "maya", assigned: false })).map((person) => person.login)).toEqual([
      "sam",
    ]);
    await asUser.action(api.integrations.github.assignees.clear, target(1));
    expect(pr(1).assignees).toEqual([]);
    await drain(t, 15_000);
    expect(await stored(1)).toMatchObject({ assignees: [] });
  });

  test("a write GitHub answers but quietly drops reads as refused", async () => {
    const { asUser, github, pr, target } = await linkedProject();
    pr(1).assignees = ["maya"];
    github.state.dropAssigneeWrites = true;
    await expect(asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "sam", assigned: true })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
    await expect(asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "maya", assigned: false })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
    await expect(asUser.action(api.integrations.github.assignees.clear, target(1))).rejects.toThrow(errors.PULL_REQUEST_WRITE_REFUSED);
  });

  test("a read-only account can't assign", async () => {
    const { asUser, target } = await linkedProject({ pull: true });
    await expect(asUser.action(api.integrations.github.assignees.update, { ...target(1), login: "sam", assigned: true })).rejects.toThrow(
      errors.PULL_REQUEST_WRITE_REFUSED
    );
  });
});
