/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { connectedProject, linkGithubAccount, signedWebhook, stubGithubAppEnv, type FakeGithubUser, type T } from "../../../convex-testing/github";
import { errors } from "./errors";
import { readGithubAppConfig } from "./lib/constants";
import { encryptToken } from "./lib/github";

type AsUser = ReturnType<T["withIdentity"]>;

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

/** `expiring`: the App expires tokens, so links get 8-hour tokens with a refresh token. */
async function linkedProject({ expiring = false } = {}) {
  const setup = await connectedProject();
  setup.github.state.expiringTokens = expiring;
  await linkGithubAccount(setup.asUser, setup.github, setup.org._id, MAYA);
  const target = { projectId: setup.project._id, repositoryId: setup.repositoryId, number: 1 };
  return { ...setup, target };
}

async function myAccount(asUser: AsUser) {
  return (await asUser.query(api.integrations.github.accounts.listMine, {})).organizations[0]?.account ?? null;
}

describe("integrations.github.accounts", () => {
  test("Connect links the member's GitHub account in the organization and returns to the page it started on", async () => {
    const { asUser, github, org } = await connectedProject();
    expect(await asUser.query(api.integrations.github.accounts.listMine, {})).toMatchObject({
      configured: true,
      organizations: [{ organizationId: org._id, account: null }],
    });

    expect(await linkGithubAccount(asUser, github, org._id, MAYA)).toEqual({ returnTo: "/o/acme/WEB/pull-requests?repo=r&pr=1" });
    expect(await myAccount(asUser)).toEqual({ githubUserId: 42, login: "maya", avatarUrl: "https://avatars.githubusercontent.com/u/42", status: "active" });
  });

  test("a return path off the app falls back to the app's root", async () => {
    const { asUser, github, org } = await connectedProject();
    expect(await linkGithubAccount(asUser, github, org._id, MAYA, "//evil.example/steal")).toEqual({ returnTo: "/" });
    expect(await linkGithubAccount(asUser, github, org._id, MAYA, "https://evil.example")).toEqual({ returnTo: "/" });
  });

  test("a state started by one member can't be finished by another, and a tampered state is refused", async () => {
    const { asUser, github, org, ctx } = await connectedProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    const { authorizeUrl } = await asUser.mutation(api.integrations.github.accounts.beginLink, { organizationId: org._id, returnTo: "/" });
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    github.state.oauthCodes.set("code", MAYA);

    await expect(ctx.asUser(other).action(api.integrations.github.accounts.completeLink, { state, code: "code" })).rejects.toThrow(errors.ACCOUNT_LINK_INVALID);
    await expect(asUser.action(api.integrations.github.accounts.completeLink, { state: `${state}x`, code: "code" })).rejects.toThrow(errors.ACCOUNT_LINK_INVALID);
    await expect(asUser.action(api.integrations.github.accounts.completeLink, { state: "account.!!.%%", code: "code" })).rejects.toThrow(errors.ACCOUNT_LINK_INVALID);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await expect(asUser.action(api.integrations.github.accounts.completeLink, { state, code: "code" })).rejects.toThrow(errors.ACCOUNT_LINK_EXPIRED);
    expect(await myAccount(asUser)).toBeNull();
  });

  test("a second member of the organization can't link a GitHub account another member already linked", async () => {
    const { asUser, github, org, ctx } = await connectedProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    await linkGithubAccount(asUser, github, org._id, MAYA);
    await expect(linkGithubAccount(ctx.asUser(other), github, org._id, MAYA)).rejects.toThrow(errors.ACCOUNT_LINKED_TO_ANOTHER_MEMBER);
    // Relinking your own account is fine.
    await linkGithubAccount(asUser, github, org._id, MAYA);
  });

  test("Disconnect unlinks the account and revokes that token on GitHub", async () => {
    const { asUser, github, org } = await linkedProject();
    const [token] = github.state.userTokens.keys();
    await asUser.action(api.integrations.github.accounts.disconnect, { organizationId: org._id });
    expect(await myAccount(asUser)).toBeNull();
    expect(github.state.revokedTokens).toEqual([token]);
  });

  test("leaving the organization deletes the member's Linked GitHub account", async () => {
    const { github, org, ctx, t } = await connectedProject();
    const other = await ctx.user();
    await ctx.orgMember(org._id, other._id, "member");
    await linkGithubAccount(ctx.asUser(other), github, org._id, MAYA);
    await ctx.asUser(other).mutation(api.organizations.members.leave, { organizationId: org._id });
    expect(await t.run((run) => run.db.query("integrationLinkedAccounts").collect())).toEqual([]);
  });

  test("GitHub's revoked authorization event marks every link to that person for Reconnect", async () => {
    const { asUser, t } = await linkedProject();
    const response = await signedWebhook(t, "github_app_authorization", { action: "revoked", sender: { id: 42, login: "maya" } });
    expect(response.status).toBe(202);
    expect((await myAccount(asUser))?.status).toBe("reconnect");
  });

  test("reads the linked account's permission on the repository", async () => {
    const { asUser, github, target } = await linkedProject();
    expect(await asUser.action(api.integrations.github.accounts.readRepositoryPermission, target)).toBe("read");
    github.state.userPermissions.set(42, { pull: true, triage: true, push: true });
    expect(await asUser.action(api.integrations.github.accounts.readRepositoryPermission, target)).toBe("write");
    github.state.failures.push({ match: /GET \/repositories\/1$/, status: 404 });
    expect(await asUser.action(api.integrations.github.accounts.readRepositoryPermission, target)).toBe("none");
  });
});

describe("integrations.github.comments", () => {
  test("comments, edits, and deletes on the PR as the member's own GitHub account", async () => {
    const { asUser, github, target } = await linkedProject();
    const created = await asUser.action(api.integrations.github.comments.create, { ...target, body: "  Looks good  " });
    expect(created).toMatchObject({ author: "maya", authorId: 42, body: "Looks good" });
    const pr = github.state.pulls.get(1)!.find((candidate) => candidate.number === 1)!;
    expect(pr.comments).toMatchObject([{ id: created.id, login: "maya", body: "Looks good" }]);

    expect(await asUser.action(api.integrations.github.comments.update, { ...target, commentId: created.id, body: "Ship it" })).toMatchObject({ body: "Ship it" });
    await asUser.action(api.integrations.github.comments.remove, { ...target, commentId: created.id });
    expect(pr.comments).toEqual([]);
  });

  test("the Overview marks the viewer's own comments by GitHub user id", async () => {
    const { asUser, target } = await linkedProject();
    await asUser.action(api.integrations.github.comments.create, { ...target, body: "Mine" });
    const diff = await asUser.action(api.integrations.github.pullRequests.readDiff, target);
    const overview = await asUser.action(api.integrations.github.pullRequests.readOverview, { ...target, baseSha: diff.baseSha, headSha: diff.headSha });
    expect(overview.comments).toMatchObject([{ body: "Mine", authorId: 42 }]);
  });

  test("without a Linked GitHub account the member can only read", async () => {
    const { asUser, project, repositoryId } = await connectedProject();
    await expect(asUser.action(api.integrations.github.comments.create, { projectId: project._id, repositoryId, number: 1, body: "Hi" })).rejects.toThrow(
      errors.GITHUB_ACCOUNT_REQUIRED
    );
  });

  test("an empty comment never reaches GitHub, and GitHub's refusal reads as a catalog message", async () => {
    const { asUser, github, target } = await linkedProject();
    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "  " })).rejects.toThrow(errors.COMMENT_EMPTY);
    github.state.failures.push({ match: /POST .*\/comments$/, status: 403 });
    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" })).rejects.toThrow(errors.COMMENT_REFUSED);
    expect((await myAccount(asUser))?.status).toBe("active");
  });

  test("a token about to expire is refreshed before the write, rotating both tokens", async () => {
    const { asUser, github, target } = await linkedProject({ expiring: true });
    const [firstRefresh] = github.state.refreshTokens.keys();
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 - 60_000);

    await asUser.action(api.integrations.github.comments.create, { ...target, body: "After lunch" });
    expect(github.state.refreshTokens.has(firstRefresh)).toBe(false);
    expect(github.state.refreshTokens.size).toBe(1);
    expect((await myAccount(asUser))?.status).toBe("active");
  });

  test("GitHub refusing the refresh token marks the account for Reconnect", async () => {
    const { asUser, github, target } = await linkedProject({ expiring: true });
    github.state.refreshTokens.clear();
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);

    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" })).rejects.toThrow(errors.GITHUB_RECONNECT_REQUIRED);
    expect((await myAccount(asUser))?.status).toBe("reconnect");
  });

  test("a refresh that fails on GitHub's side keeps the account", async () => {
    const { asUser, github, target } = await linkedProject({ expiring: true });
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    github.state.failures.push({ match: /POST \/login\/oauth\/access_token$/, status: 502 });

    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" })).rejects.toThrow(errors.GITHUB_UNAVAILABLE);
    expect((await myAccount(asUser))?.status).toBe("active");
    // The lease was released: the next write refreshes and posts.
    await asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" });
  });

  test("a 401 on a write marks the account for Reconnect", async () => {
    const { asUser, github, target } = await linkedProject();
    github.state.userTokens.clear();
    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" })).rejects.toThrow(errors.GITHUB_RECONNECT_REQUIRED);
    expect((await myAccount(asUser))?.status).toBe("reconnect");
    await expect(asUser.action(api.integrations.github.comments.create, { ...target, body: "Hi" })).rejects.toThrow(errors.GITHUB_RECONNECT_REQUIRED);
  });

  test("editing or deleting someone else's comment, or one on another PR, is refused before GitHub sees the write", async () => {
    const { asUser, github, target } = await linkedProject();
    const pulls = github.state.pulls.get(1)!;
    pulls[0].comments = [{ id: 70, login: "alex", userId: 2, body: "Theirs", created_at: new Date().toISOString() }];
    pulls[1].comments = [{ id: 71, login: "maya", userId: 42, body: "Mine, on #2", created_at: new Date().toISOString() }];

    for (const commentId of [70, 71]) {
      await expect(asUser.action(api.integrations.github.comments.update, { ...target, commentId, body: "Changed" })).rejects.toThrow(errors.COMMENT_NOT_YOURS);
      await expect(asUser.action(api.integrations.github.comments.remove, { ...target, commentId })).rejects.toThrow(errors.COMMENT_NOT_YOURS);
    }
    expect(pulls[0].comments[0].body).toBe("Theirs");
    expect(pulls[1].comments).toHaveLength(1);
    expect(github.state.requests.filter((request) => /^(PATCH|DELETE) /.test(request))).toEqual([]);
  });
});

describe("integrations.github.accounts refresh races", () => {
  /** Another action holds the refresh lease and GitHub already rotated the pair; it hasn't stored the new one yet. */
  async function refreshInFlight(setup: Awaited<ReturnType<typeof linkedProject>>) {
    const [account] = await setup.t.run((run) => run.db.query("integrationLinkedAccounts").collect());
    await setup.t.run((run) => run.db.patch("integrationLinkedAccounts", account._id, { github: { ...account.github, refreshLeaseUntil: Date.now() + 30_000 } }));
    setup.github.state.userTokens.clear();
    setup.github.state.userTokens.set("ghu-maya-new", MAYA);
    return async () => {
      const encryptedAccessToken = await encryptToken(readGithubAppConfig()!, "ghu-maya-new");
      await setup.t.run((run) =>
        run.db.patch("integrationLinkedAccounts", account._id, {
          github: { ...account.github, encryptedAccessToken, accessTokenExpiresAt: Date.now() + 8 * 60 * 60 * 1000 },
        })
      );
    };
  }

  test("a 401 while another refresh holds the lease waits for the new token instead of asking to reconnect", async () => {
    const setup = await linkedProject({ expiring: true });
    const store = await refreshInFlight(setup);
    const pending = setup.asUser.action(api.integrations.github.comments.create, { ...setup.target, body: "Hi" });
    await vi.advanceTimersByTimeAsync(200);
    await store();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ body: "Hi" });
    expect((await myAccount(setup.asUser))?.status).toBe("active");
  });

  test("a token about to expire never runs while another refresh rotates it", async () => {
    const setup = await linkedProject({ expiring: true });
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 - 60_000);
    const store = await refreshInFlight(setup);
    const pending = setup.asUser.action(api.integrations.github.comments.create, { ...setup.target, body: "Hi" });
    await vi.advanceTimersByTimeAsync(200);
    await store();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ body: "Hi" });
    expect((await myAccount(setup.asUser))?.status).toBe("active");
  });
});

