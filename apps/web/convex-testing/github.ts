import { vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createTestContext } from "./context";

export type T = ReturnType<typeof createTestContext>["t"];

/**
 * In-memory GitHub for integration tests: the REST routes the integrations
 * domain calls, behind a stubbed global fetch. Mutate the state to simulate
 * GitHub-side changes (edits, closes, uninstalls).
 */

export type FakePullRequest = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  labels: string[];
  headRef: string;
  headSha: string;
  baseSha: string;
  createdAt: number;
  updatedAt: number;
  files: { filename: string; status: string; additions: number; deletions: number; patch?: string; previous_filename?: string; sha?: string }[];
  stack?: { id: number; number: number; size: number; position: number };
  archived?: boolean;
  /** GitHub's `mergeable`, only on single-PR reads; null while it computes. */
  mergeable?: boolean | null;
  /** Overview data; the defaults are empty. */
  commits?: { sha: string; message: string; login: string | null; name: string; date: string }[];
  reviews?: { id: number; login: string; state: string; submitted_at: string; body?: string }[];
  requestedReviewers?: string[];
  requestedTeams?: string[];
  comments?: { id: number; login: string; userId?: number; body: string; created_at: string }[];
  assignees?: string[];
  /** The PR's author; octocat by default. */
  author?: FakeGithubUser;
  milestone?: { title: string; number: number };
  /** Inline review comments; GitHub nulls `line` once the diff moves past it. */
  reviewComments?: {
    id: number;
    login: string;
    body: string;
    path: string;
    line: number | null;
    start_line?: number;
    original_line?: number;
    side?: "LEFT" | "RIGHT";
    created_at: string;
    diff_hunk?: string;
    pull_request_review_id?: number;
  }[];
  /** GraphQL review threads; each thread's first comment is enough for the Overview. */
  reviewThreads?: { isResolved: boolean; isOutdated: boolean; path: string; line: number | null; originalLine: number; comments: { nodes: { author: { login: string }; body: string }[] } }[];
  checkRuns?: { id: number; name: string; status: string; conclusion: string | null; title?: string; app?: { id: number } }[];
  statuses?: { id: number; context: string; state: string; description: string }[];
  behindBy?: number;
  /** GitHub's `mergeable_state` on single-PR reads, such as "blocked" by branch rules. */
  mergeableState?: string;
  /** A fork's repository id; the head lives in the base repository by default. */
  headRepositoryId?: number;
};

export type FakeGithubUser = { id: number; login: string };

export type FakeRepository = { id: number; owner: string; name: string; private: boolean; admin: boolean; installationId: number };

export type FakeGithub = ReturnType<typeof createFakeGithub>;

/** The installation-token permission each endpoint the reader calls needs. */
const REQUIRED_PERMISSIONS: [RegExp, string][] = [
  [/\/commits\/[^/]+\/check-runs$/, "checks"],
  [/\/commits\/[^/]+\/status$/, "statuses"],
  [/\/(compare|contents)\//, "contents"],
  [/\/pulls/, "pull_requests"],
];

const githubUser = (login: string) => ({ login, avatar_url: `https://avatars.githubusercontent.com/${login}` });

/** A stable GitHub user ID for a fake login. */
export const fakeUserId = (login: string) => [...login].reduce((id, char) => (id * 31 + char.charCodeAt(0)) % 1_000_000, 7);

export const GOOD_CODE = "good-code";

async function pkcs8Pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}

/** Stub the GitHub App env vars; returns the webhook secret. */
export async function stubGithubAppEnv(): Promise<string> {
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_APP_SLUG", "convoy-test");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", await pkcs8Pem());
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "client-id");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "webhook-secret");
  return "webhook-secret";
}

let nextPullId = 1000;

export function fakePullRequest(number: number, overrides: Partial<FakePullRequest> = {}): FakePullRequest {
  const at = Date.parse("2026-11-01T10:00:00Z") + number * 1000;
  return {
    id: nextPullId++,
    number,
    title: `PR ${number}`,
    body: "",
    state: "open",
    merged: false,
    draft: false,
    labels: [],
    headRef: `feature-${number}`,
    headSha: `head-${number}`,
    baseSha: "base",
    createdAt: at,
    updatedAt: at,
    files: [{ filename: "src/a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" }],
    ...overrides,
  };
}

export function createFakeGithub() {
  const state = {
    repositories: new Map<number, FakeRepository>(),
    installations: new Map<number, { login: string; repositoryIds: Set<number>; suspended: boolean }>(),
    pulls: new Map<number, FakePullRequest[]>(),
    /** File contents by `<repositoryId>:<ref>:<path>`, served base64 by the Contents API. */
    contents: new Map<string, string>(),
    /** Changed files of a compare by `<base>...<head>`, for a revision the PR has moved past. */
    compares: new Map<string, FakePullRequest["files"]>(),
    /** Status codes to answer instead, consumed per matching request. */
    failures: [] as { match: RegExp; status: number; headers?: Record<string, string>; message?: string }[],
    /** The GitHub person each OAuth code authorizes, for Connect GitHub; GOOD_CODE stays the setup admin. */
    oauthCodes: new Map<string, FakeGithubUser>(),
    /** When set, codes return 8-hour tokens with a refresh token, as with the App's token expiration on. */
    expiringTokens: false,
    /** Live user-to-server tokens and refresh tokens; a refresh rotates both. */
    userTokens: new Map<string, FakeGithubUser>(),
    refreshTokens: new Map<string, FakeGithubUser>(),
    revokedTokens: [] as string[],
    /** A person's `permissions` on every repository; the default reads only. */
    userPermissions: new Map<number, Record<string, boolean>>(),
    /** Who GitHub lists as assignable on every repository. */
    assignable: ["octocat", "maya", "sam"],
    /** GitHub answers assignee writes with 200 but drops them, as it does without push access. */
    dropAssigneeWrites: false,
    /** The repository settings GraphQL reports for every repository. */
    mergeSettings: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: false },
    /** Every merge GitHub accepted, and the `merge-async` polls it answers "pending" before it settles. */
    merges: [] as { number: number; method: string; title?: string; message?: string; async: boolean }[],
    asyncMergePolls: 0,
    /** Every review GitHub accepted, as it was sent. */
    reviewRequests: [] as { number: number; commit_id: string; event: string; body: string; comments: { path: string; line: number; side: string; body: string }[] }[],
    /** Branches deleted through the Git refs API, as `<repositoryId>:<ref>`. */
    deletedBranches: [] as string[],
    /** Called between the two PR reads of a diff, to simulate a push mid-read. */
    onFilesRead: null as (() => void) | null,
    requests: [] as string[],
    /** Every `/search/issues` query, and items GitHub adds to every answer (another repository's, say). */
    searches: [] as string[],
    extraSearchItems: [] as unknown[],
    searchIncomplete: false,
    /** Check runs Convoy created, by repository; the commit's check-runs list returns them too. */
    createdCheckRuns: [] as {
      id: number;
      repositoryId: number;
      head_sha: string;
      name: string;
      conclusion: string;
      completed_at: string;
      external_id: string;
      details_url: string;
      output: { title: string; summary: string };
      app: { id: number };
    }[],
  };

  function addRepository(repo: Partial<FakeRepository> & { id: number }, pulls: FakePullRequest[] = []) {
    const full: FakeRepository = { owner: "acme", name: `repo-${repo.id}`, private: true, admin: true, installationId: 77, ...repo };
    state.repositories.set(full.id, full);
    const installation = state.installations.get(full.installationId) ?? { login: full.owner, repositoryIds: new Set(), suspended: false };
    installation.repositoryIds.add(full.id);
    state.installations.set(full.installationId, installation);
    state.pulls.set(full.id, pulls);
    return full;
  }

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function repoJson(repo: FakeRepository) {
    return {
      id: repo.id,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      owner: { login: repo.owner },
      private: repo.private,
      html_url: `https://github.com/${repo.owner}/${repo.name}`,
      permissions: { admin: repo.admin, pull: true },
    };
  }

  function pullJson(pr: FakePullRequest) {
    return {
      id: pr.id,
      node_id: `PR_${pr.id}`,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      merged_at: pr.merged ? new Date(pr.updatedAt).toISOString() : null,
      draft: pr.draft,
      labels: pr.labels.map((name) => ({ name })),
      assignees: (pr.assignees ?? []).map((login) => ({ ...githubUser(login), id: fakeUserId(login) })),
      user: pr.author ?? { id: fakeUserId("octocat"), login: "octocat" },
      head: { ref: pr.headRef, sha: pr.headSha },
      base: { ref: "main", sha: pr.baseSha },
      created_at: new Date(pr.createdAt).toISOString(),
      updated_at: new Date(pr.updatedAt).toISOString(),
      changed_files: pr.files.length,
      html_url: `https://github.com/pr/${pr.number}`,
      ...(pr.stack ? { stack: pr.stack } : {}),
      ...(pr.archived ? { archived: true } : {}),
    };
  }

  /** A search hit is an issue: no branches or SHAs, and `pull_request.merged_at` for the merge. */
  function searchItemJson(pr: FakePullRequest) {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      labels: pr.labels.map((name) => ({ name })),
      user: { login: "octocat" },
      created_at: new Date(pr.createdAt).toISOString(),
      updated_at: new Date(pr.updatedAt).toISOString(),
      pull_request: { merged_at: pr.merged ? new Date(pr.updatedAt).toISOString() : null },
    };
  }

  /** The single-PR read adds what GitHub leaves out of list pages. */
  function pullDetailJson(pr: FakePullRequest, repositoryId: number) {
    const json = pullJson(pr);
    return {
      ...json,
      head: { ...json.head, repo: { id: pr.headRepositoryId ?? repositoryId } },
      mergeable: pr.mergeable === undefined ? true : pr.mergeable,
      mergeable_state: pr.mergeableState ?? "clean",
      commits: pr.commits?.length ?? 0,
      requested_reviewers: (pr.requestedReviewers ?? []).map((login) => ({ login })),
      requested_teams: (pr.requestedTeams ?? []).map((name) => ({ name, slug: name })),
      milestone: pr.milestone ? { ...pr.milestone, html_url: `https://github.com/milestone/${pr.milestone.number}` } : null,
    };
  }

  function overviewJson(pr: FakePullRequest, part: string, direction: string | null) {
    if (part === "/commits") {
      return (pr.commits ?? []).map((commit) => ({
        sha: commit.sha,
        html_url: `https://github.com/commit/${commit.sha}`,
        author: commit.login ? { login: commit.login } : null,
        commit: { message: commit.message, author: { name: commit.name, date: commit.date } },
      }));
    }
    if (part === "/comments") {
      const comments = (pr.reviewComments ?? []).map((comment) => ({ ...comment, user: githubUser(comment.login), html_url: `https://github.com/rc/${comment.id}` }));
      return direction === "desc" ? comments.reverse() : comments;
    }
    return (pr.reviews ?? []).map((review) => ({ id: review.id, user: githubUser(review.login), state: review.state, submitted_at: review.submitted_at, body: review.body ?? "" }));
  }

  function pullForSha(repositoryId: number, sha: string) {
    return (state.pulls.get(repositoryId) ?? []).find((pr) => pr.headSha === sha);
  }

  function findRepo(owner: string, name: string) {
    return [...state.repositories.values()].find((repo) => repo.owner === owner && repo.name === name);
  }

  const tokens = new Map<string, Record<string, string>>();
  let issued = 0;

  function issueTokens(user: FakeGithubUser) {
    const accessToken = `ghu-${user.login}-${++issued}`;
    state.userTokens.set(accessToken, user);
    if (!state.expiringTokens) return { access_token: accessToken };
    const refreshToken = `ghr-${user.login}-${issued}`;
    state.refreshTokens.set(refreshToken, user);
    return { access_token: accessToken, expires_in: 28_800, refresh_token: refreshToken, refresh_token_expires_in: 15_897_600 };
  }

  async function handle(url: URL, init: RequestInit | undefined): Promise<Response> {
    const method = init?.method ?? "GET";
    const path = url.pathname;
    state.requests.push(`${method} ${path}`);
    const failure = state.failures.findIndex((entry) => entry.match.test(`${method} ${path}`));
    if (failure !== -1) {
      const [{ status, headers, message }] = state.failures.splice(failure, 1);
      return new Response(JSON.stringify({ message: message ?? "fake failure" }), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }
    if (url.hostname === "github.com" && path === "/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body)) as { code?: string; grant_type?: string; refresh_token?: string };
      if (body.grant_type === "refresh_token") {
        const user = state.refreshTokens.get(body.refresh_token ?? "");
        if (!user) return json(200, { error: "bad_refresh_token" });
        state.refreshTokens.delete(body.refresh_token!);
        for (const [token, holder] of state.userTokens) if (holder === user) state.userTokens.delete(token);
        return json(200, issueTokens(user));
      }
      if (body.code === GOOD_CODE) return json(200, { access_token: "user-token" });
      const user = state.oauthCodes.get(body.code ?? "");
      return json(200, user ? issueTokens(user) : { error: "bad_verification_code" });
    }
    if (url.hostname === "api.github.com" && path === "/applications/client-id/token" && method === "DELETE") {
      const { access_token } = JSON.parse(String(init?.body)) as { access_token: string };
      state.revokedTokens.push(access_token);
      state.userTokens.delete(access_token);
      return new Response(null, { status: 204 });
    }
    const bearer = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    const person = state.userTokens.get(bearer);
    if (path === "/user") {
      return person ? json(200, { id: person.id, login: person.login, avatar_url: `https://avatars.githubusercontent.com/u/${person.id}` }) : json(401, {});
    }
    let match = /^\/repositories\/(\d+)\/issues\/(?:(\d+)\/comments|comments\/(\d+))$/.exec(path);
    if (match && (method !== "GET" || match[3])) {
      if (!person) return json(401, {});
      const [, repositoryId, number, commentId] = match;
      const pulls = state.pulls.get(Number(repositoryId)) ?? [];
      const pr = number ? pulls.find((candidate) => candidate.number === Number(number)) : pulls.find((candidate) => candidate.comments?.some((comment) => comment.id === Number(commentId)));
      if (!pr) return json(404, {});
      const comments = (pr.comments ??= []);
      const toJson = (comment: (typeof comments)[number]) => ({ ...comment, user: { ...githubUser(comment.login), id: comment.userId }, html_url: `https://github.com/c/${comment.id}` });
      if (method === "GET") {
        const comment = comments.find((candidate) => candidate.id === Number(commentId))!;
        return json(200, { ...toJson(comment), issue_url: `https://api.github.com/repos/acme/repo-${repositoryId}/issues/${pr.number}` });
      }
      if (method === "POST") {
        const comment = { id: 5000 + comments.length, login: person.login, userId: person.id, body: (JSON.parse(String(init?.body)) as { body: string }).body, created_at: new Date().toISOString() };
        comments.push(comment);
        return json(201, toJson(comment));
      }
      // Like GitHub, anyone with write access may edit or delete any comment.
      const index = comments.findIndex((comment) => comment.id === Number(commentId));
      if (method === "DELETE") {
        comments.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      comments[index] = { ...comments[index], body: (JSON.parse(String(init?.body)) as { body: string }).body };
      return json(200, toJson(comments[index]));
    }
    // State and assignee writes, refused like GitHub below the role each needs.
    const allowed = (role: "triage" | "write") => {
      const granted = person ? (state.userPermissions.get(person.id) ?? { pull: true }) : {};
      return Boolean(granted.admin || granted.maintain || granted.push || (role === "triage" && granted.triage));
    };
    const changed = (pr: FakePullRequest) => {
      pr.updatedAt = Math.max(Date.now(), pr.updatedAt + 1);
    };
    if (path === "/graphql" && method === "POST") {
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: { id: string; owner: string; name: string; query: string | null } };
      if (query.includes("mergeCommitAllowed")) {
        const pr = [...state.pulls.values()].flat().find((candidate) => `PR_${candidate.id}` === variables.id);
        return pr
          ? json(200, { data: { node: { repository: state.mergeSettings, reviewThreads: { nodes: pr.reviewThreads ?? [] } } } })
          : json(200, { data: { node: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
      }
      if (!person) return json(401, {});
      if (query.includes("assignableUsers")) {
        if (!findRepo(variables.owner, variables.name)) return json(200, { data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
        const nodes = state.assignable
          .filter((login) => !variables.query || login.includes(variables.query))
          .slice(0, 20)
          .map(githubUser);
        return json(200, { data: { repository: { assignableUsers: { nodes } } } });
      }
      const pr = [...state.pulls.values()].flat().find((candidate) => `PR_${candidate.id}` === variables.id);
      const mutation = /\{\s*(\w+)\(/.exec(query)?.[1] ?? "";
      const role = mutation === "archivePullRequest" || mutation === "unarchivePullRequest" ? "triage" : "write";
      if (!pr) return json(200, { data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] });
      if (!allowed(role)) return json(200, { data: null, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by user" }] });
      if (mutation === "convertPullRequestToDraft") pr.draft = true;
      else if (mutation === "markPullRequestReadyForReview") pr.draft = false;
      else if (mutation === "archivePullRequest") Object.assign(pr, { archived: true, state: "closed" });
      else if (mutation === "unarchivePullRequest") pr.archived = false;
      else return json(200, { data: null, errors: [{ type: "UNPROCESSABLE", message: `no ${mutation}` }] });
      changed(pr);
      return json(200, { data: { [mutation]: { clientMutationId: null } } });
    }
    match = /^\/repositories\/(\d+)\/pulls\/(\d+)\/(merge|merge-async|update-branch)(?:\/([^/]+))?$/.exec(path);
    if (match) {
      if (!person) return json(401, {});
      const [, repositoryId, number, action, uuid] = match;
      const pulls = state.pulls.get(Number(repositoryId)) ?? [];
      const pr = pulls.find((candidate) => candidate.number === Number(number));
      if (!pr) return json(404, {});
      if (action === "merge-async" && method === "GET") {
        if (state.asyncMergePolls > 0) {
          state.asyncMergePolls--;
          return json(200, { status: "pending", details: { uuid } });
        }
        return json(200, { status: "merged", details: {} });
      }
      if (!allowed("write")) return json(403, { message: "Must have write access" });
      const body = JSON.parse(String(init?.body)) as { merge_method?: string; sha?: string; commit_title?: string; commit_message?: string; expected_head_sha?: string };
      if (action === "update-branch") {
        if (body.expected_head_sha !== pr.headSha) return json(422, { message: "expected head sha didn't match current head ref." });
        Object.assign(pr, { headSha: `${pr.headSha}-updated`, behindBy: 0, mergeable: null });
        changed(pr);
        return json(202, { message: "Updating pull request branch.", url: `https://github.com/pr/${pr.number}` });
      }
      if (body.sha !== pr.headSha) return json(409, { message: "Head branch was modified. Review and try the merge again." });
      // merge-async refuses a closed or draft PR with a 400; the merge endpoint with a 405.
      if (action === "merge-async" && (pr.state !== "open" || pr.draft)) return json(400, { message: "Pull request is closed or a draft" });
      if (pr.state !== "open" || pr.draft || pr.mergeable === false) return json(405, { message: "Pull Request is not mergeable" });
      if (pr.mergeableState === "blocked") return json(405, { message: "At least 1 approving review is required by reviewers with write access." });
      // GitHub merges a stack bottom up: the open Layers below go first.
      const below = pr.stack
        ? pulls.filter((layer) => layer.stack?.id === pr.stack!.id && layer.stack.position < pr.stack!.position && layer.state === "open")
        : [];
      if (action === "merge-async") {
        const stuck = below.find((layer) => layer.draft || layer.mergeable === false);
        if (stuck) return json(202, { status: "failed", details: { message: `#${stuck.number} can't be merged.` } });
      }
      for (const layer of [...below.sort((a, b) => a.stack!.position - b.stack!.position), pr]) {
        Object.assign(layer, { state: "closed", merged: true });
        changed(layer);
        state.merges.push({ number: layer.number, method: body.merge_method ?? "merge", title: layer === pr ? body.commit_title : undefined, message: layer === pr ? body.commit_message : undefined, async: action === "merge-async" });
      }
      if (action === "merge") return json(200, { merged: true, sha: `merge-${pr.number}` });
      return state.asyncMergePolls > 0
        ? json(202, { status: "pending", details: { uuid: `merge-${pr.number}` } })
        : json(202, { status: "merged", details: {} });
    }
    match = /^\/repositories\/(\d+)\/git\/refs\/heads\/(.+)$/.exec(path);
    if (match && method === "DELETE") {
      if (!person) return json(401, {});
      if (!allowed("write")) return json(403, { message: "Must have write access" });
      const key = `${match[1]}:${decodeURIComponent(match[2])}`;
      if (state.deletedBranches.includes(key)) return json(422, { message: "Reference does not exist" });
      state.deletedBranches.push(key);
      return new Response(null, { status: 204 });
    }
    // Reviews and reviewer requests: anyone who can read reviews, triage requests, and nobody reviews their own PR but to comment.
    match = /^\/repositories\/(\d+)\/pulls\/(\d+)\/(reviews|requested_reviewers)$/.exec(path);
    if (match && method !== "GET") {
      if (!person) return json(401, {});
      const pr = state.pulls.get(Number(match[1]))?.find((candidate) => candidate.number === Number(match![2]));
      if (!pr) return json(404, {});
      const granted = state.userPermissions.get(person.id) ?? { pull: true };
      if (match[3] === "reviews") {
        if (!granted.pull) return json(404, {});
        const body = JSON.parse(String(init?.body)) as { commit_id: string; event: string; body: string; comments: { path: string; start_line?: number; line: number; side: "LEFT" | "RIGHT"; body: string }[] };
        if (body.commit_id !== pr.headSha) return json(422, { message: "commit_id is not part of the pull request" });
        if (person.login === "octocat" && body.event !== "COMMENT") return json(422, { message: "Can not approve your own pull request" });
        const states: Record<string, string> = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" };
        const review = { id: 7000 + (pr.reviews ??= []).length, login: person.login, state: states[body.event], submitted_at: new Date().toISOString(), body: body.body };
        pr.reviews.push(review);
        for (const comment of body.comments) {
          (pr.reviewComments ??= []).push({
            id: 8000 + pr.reviewComments.length,
            login: person.login,
            body: comment.body,
            path: comment.path,
            start_line: comment.start_line,
            line: comment.line,
            side: comment.side,
            created_at: new Date().toISOString(),
            diff_hunk: `@@ -1,1 +1,${comment.line} @@\n+line ${comment.line}`,
            pull_request_review_id: review.id,
          });
        }
        state.reviewRequests.push({ number: pr.number, ...body });
        return json(200, { ...review, user: githubUser(person.login), html_url: `https://github.com/review/${review.id}` });
      }
      if (!allowed("triage")) return json(403, { message: "Must have triage access" });
      const { reviewers } = JSON.parse(String(init?.body)) as { reviewers: string[] };
      if (reviewers.includes("octocat") || reviewers.some((login) => !state.assignable.includes(login))) {
        return json(422, { message: "Reviews may only be requested from collaborators." });
      }
      const current = pr.requestedReviewers ?? [];
      pr.requestedReviewers = method === "POST" ? [...new Set([...current, ...reviewers])] : current.filter((login) => !reviewers.includes(login));
      return json(method === "POST" ? 201 : 200, pullDetailJson(pr, Number(match[1])));
    }
    match = /^\/repositories\/(\d+)\/(issues|pulls)\/(\d+)(\/assignees)?$/.exec(path);
    if (match && method !== "GET") {
      if (!person) return json(401, {});
      const pr = state.pulls.get(Number(match[1]))?.find((candidate) => candidate.number === Number(match![3]));
      if (!pr) return json(404, {});
      if (!allowed("triage")) return json(403, { message: "Must have triage access" });
      const body = JSON.parse(String(init?.body)) as { state?: "open" | "closed"; assignees?: string[] };
      const current = pr.assignees ?? [];
      if (state.dropAssigneeWrites && (match[4] || body.assignees)) {
        return json(200, pullDetailJson(pr, Number(match[1])));
      }
      if (match[4]) {
        const named = (body.assignees ?? []).filter((login) => state.assignable.includes(login));
        pr.assignees = method === "POST" ? [...new Set([...current, ...named])] : current.filter((login) => !named.includes(login));
      } else if (body.assignees) {
        pr.assignees = body.assignees;
      } else if (body.state) {
        if (pr.merged) return json(422, { message: "Cannot change the state of a merged pull request" });
        pr.state = body.state;
      }
      changed(pr);
      return json(200, pullDetailJson(pr, Number(match[1])));
    }
    if (path === "/user/installations") {
      return json(200, { installations: [...state.installations.keys()].map((id) => ({ id })) });
    }
    match = /^\/user\/installations\/(\d+)\/repositories$/.exec(path);
    if (match) {
      const installation = state.installations.get(Number(match[1]));
      const all = [...(installation?.repositoryIds ?? [])].map((id) => repoJson(state.repositories.get(id)!));
      const perPage = Number(url.searchParams.get("per_page"));
      const page = Number(url.searchParams.get("page"));
      return json(200, { total_count: all.length, repositories: all.slice((page - 1) * perPage, page * perPage) });
    }
    match = /^\/repositories\/(\d+)$/.exec(path);
    if (match) {
      const repo = state.repositories.get(Number(match[1]));
      if (repo && person) return json(200, { ...repoJson(repo), permissions: state.userPermissions.get(person.id) ?? { pull: true } });
      return repo ? json(200, repoJson(repo)) : json(404, {});
    }
    match = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path);
    if (match) {
      const repo = findRepo(match[1], match[2]);
      const installation = repo && state.installations.get(repo.installationId);
      return repo && installation ? json(200, { id: repo.installationId, account: { login: installation.login } }) : json(404, {});
    }
    match = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
    if (match) {
      const installation = state.installations.get(Number(match[1]));
      if (!installation) return json(404, {});
      if (installation.suspended) return json(403, {});
      const { repository_ids, permissions } = JSON.parse(String(init?.body)) as { repository_ids: number[]; permissions?: Record<string, string> };
      if (!repository_ids.every((id) => installation.repositoryIds.has(id))) return json(422, {});
      const token = `installation-${match[1]}-${tokens.size}`;
      tokens.set(token, permissions ?? {});
      return json(201, { token });
    }
    // GitHub answers 403 when the installation token lacks the endpoint's permission.
    const required = REQUIRED_PERMISSIONS.find(([pattern]) => pattern.test(path))?.[1];
    const granted = tokens.get(new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "");
    if (required && granted && !granted[required]) return json(403, { message: "Resource not accessible by integration" });
    match = /^\/repositories\/(\d+)\/pulls\/(\d+)(\/commits|\/reviews|\/comments)$/.exec(path);
    if (match) {
      const [, repositoryId, number, part] = match;
      const pr = state.pulls.get(Number(repositoryId))?.find((candidate) => candidate.number === Number(number));
      return pr ? json(200, overviewJson(pr, part, url.searchParams.get("direction"))) : json(404, {});
    }
    match = /^\/repositories\/(\d+)\/issues\/(\d+)\/comments$/.exec(path);
    if (match) {
      const [, repositoryId, number] = match;
      const pr = state.pulls.get(Number(repositoryId))?.find((candidate) => candidate.number === Number(number));
      return pr
        ? json(200, (pr.comments ?? []).map((comment) => ({ ...comment, user: { ...githubUser(comment.login), id: comment.userId }, html_url: `https://github.com/c/${comment.id}` })))
        : json(404, {});
    }
    match = /^\/repositories\/(\d+)\/check-runs$/.exec(path);
    if (match && method === "POST") {
      if (granted?.checks !== "write") return json(403, { message: "Resource not accessible by integration" });
      const body = JSON.parse(String(init?.body)) as Omit<(typeof state.createdCheckRuns)[number], "id" | "repositoryId" | "app">;
      const run = { ...body, id: 9000 + state.createdCheckRuns.length, repositoryId: Number(match[1]), app: { id: 123 } };
      state.createdCheckRuns.push(run);
      return json(201, { id: run.id });
    }
    match = /^\/repositories\/(\d+)\/commits\/([^/]+)\/(check-runs|status)$/.exec(path);
    if (match) {
      const pr = pullForSha(Number(match[1]), match[2]);
      if (match[3] === "status") return json(200, { statuses: pr?.statuses ?? [] });
      const created = state.createdCheckRuns
        .filter((run) => run.repositoryId === Number(match![1]) && run.head_sha === match![2])
        .map((run) => ({ id: run.id, name: run.name, status: "completed", conclusion: run.conclusion, title: run.output.title, app: run.app }));
      return json(200, {
        check_runs: [...(pr?.checkRuns ?? []), ...created].map((run) => ({ ...run, output: { title: run.title ?? null }, html_url: `https://github.com/runs/${run.id}` })),
      });
    }
    match = /^\/repositories\/(\d+)\/compare\/([^.]+)\.\.\.(.+)$/.exec(path);
    if (match) {
      const compared = state.compares.get(`${match[2]}...${match[3]}`);
      if (compared) return json(200, { behind_by: 0, files: compared });
      const pr = pullForSha(Number(match[1]), match[3]);
      return pr ? json(200, { behind_by: pr.behindBy ?? 0, files: pr.files }) : json(404, {});
    }
    match = /^\/repositories\/(\d+)\/contents\/(.+)$/.exec(path);
    if (match) {
      const key = `${match[1]}:${url.searchParams.get("ref")}:${decodeURIComponent(match[2])}`;
      const contents = state.contents.get(key);
      if (contents === undefined) return json(404, {});
      const size = new TextEncoder().encode(contents).byteLength;
      return size > 1024 * 1024
        ? json(200, { type: "file", size, encoding: "none", content: "" })
        : json(200, { type: "file", size, encoding: "base64", content: btoa(contents) });
    }
    if (path === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      state.searches.push(q);
      const repos = [...q.matchAll(/(?:^| )repo:(\S+)\/(\S+)/g)].map(([, owner, name]) => findRepo(owner, name)).filter((repo) => repo !== undefined);
      const terms = [...q.matchAll(/"([^"]*)"/g)].map(([, term]) => term.toLowerCase());
      const items = repos
        .flatMap((repo) => (state.pulls.get(repo.id) ?? []).map((pr) => ({ repo, pr })))
        .filter(({ pr }) => terms.every((term) => pr.title.toLowerCase().includes(term)))
        .sort((a, b) => b.pr.updatedAt - a.pr.updatedAt)
        .map(({ repo, pr }) => ({ ...searchItemJson(pr), repository_url: `https://api.github.com/repos/${repo.owner}/${repo.name}` }));
      const perPage = Number(url.searchParams.get("per_page"));
      const page = Number(url.searchParams.get("page"));
      const all = [...items, ...state.extraSearchItems];
      return json(200, { total_count: all.length, incomplete_results: state.searchIncomplete, items: all.slice((page - 1) * perPage, page * perPage) });
    }
    match = /^\/repositories\/(\d+)\/pulls(?:\/(\d+)(\/files)?)?$/.exec(path);
    if (match) {
      const pulls = state.pulls.get(Number(match[1])) ?? [];
      if (!match[2]) {
        const perPage = Number(url.searchParams.get("per_page"));
        const page = Number(url.searchParams.get("page"));
        const listState = url.searchParams.get("state");
        const listed =
          listState === "all"
            ? [...pulls].sort((a, b) => b.updatedAt - a.updatedAt)
            : listState === "closed"
              ? pulls.filter((pr) => pr.state === "closed").sort((a, b) => b.updatedAt - a.updatedAt)
              : pulls.filter((pr) => pr.state === "open").sort((a, b) => a.createdAt - b.createdAt);
        return json(200, listed.slice((page - 1) * perPage, page * perPage).map(pullJson));
      }
      const pr = pulls.find((candidate) => candidate.number === Number(match[2]));
      if (!pr) return json(404, {});
      if (match[3]) {
        const perPage = Number(url.searchParams.get("per_page"));
        const page = Number(url.searchParams.get("page") ?? 1);
        const files = pr.files.slice((page - 1) * perPage, page * perPage);
        state.onFilesRead?.();
        return json(200, files);
      }
      return json(200, pullDetailJson(pr, Number(match[1])));
    }
    return json(404, { message: `fake GitHub has no route for ${method} ${path}` });
  }

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handle(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url), init)
  );
  vi.stubGlobal("fetch", fetchMock);

  return { state, addRepository, fetchMock };
}

// --- Flow helpers ---

/** Run scheduled jobs for `ms` of fake time (excludes the 30-day purge). */
export async function drain(t: T, ms = 60_000) {
  for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();
  }
}

export async function authorizedSetup(asUser: ReturnType<T["withIdentity"]>, projectId: Id<"projects">) {
  const { setupId, authorizeUrl } = await asUser.mutation(api.integrations.github.setup.beginSetup, { projectId });
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  await asUser.action(api.integrations.github.setup.completeSetup, { state, code: GOOD_CODE });
  return setupId;
}

export async function connectedProject(
  pulls = [fakePullRequest(1), fakePullRequest(2)],
  options: Parameters<typeof createTestContext>[0] = {}
) {
  const ctx = createTestContext(options);
  const setup = await ctx.setupProject();
  const github = createFakeGithub();
  github.addRepository({ id: 1 }, pulls);
  const setupId = await authorizedSetup(setup.asUser, setup.project._id);
  const [repositoryLinkId] = await setup.asUser.action(api.integrations.github.setup.saveRepositories, {
    setupId,
    providerRepositoryIds: [1],
    removeRepositoryLinkIds: [],
  });
  await drain(setup.t);
  const link = await setup.t.run((run) => run.db.get("integrationRepositoryLinks", repositoryLinkId));
  return { ...setup, ctx, github, repositoryLinkId, repositoryId: link!.repositoryId };
}

/** Connect GitHub as `person`: the authorize URL's state comes back through the callback with GitHub's code. */
export async function linkGithubAccount(
  asUser: ReturnType<T["withIdentity"]>,
  github: FakeGithub,
  organizationId: Id<"organizations">,
  person: FakeGithubUser,
  returnTo = "/o/acme/WEB/pull-requests?repo=r&pr=1"
) {
  const { authorizeUrl } = await asUser.mutation(api.integrations.github.accounts.beginLink, { organizationId, returnTo });
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  const code = `code-${person.login}-${Math.random()}`;
  github.state.oauthCodes.set(code, person);
  return asUser.action(api.integrations.github.accounts.completeLink, { state, code });
}

export async function listTitles(
  asUser: ReturnType<T["withIdentity"]>,
  projectId: Id<"projects">,
  options: Partial<Omit<FunctionArgs<typeof api.integrations.github.pullRequests.list>, "projectId" | "paginationOpts">> = {}
) {
  const result = await asUser.query(api.integrations.github.pullRequests.list, {
    projectId,
    tab: "open",
    sort: "updated",
    order: "desc",
    ...options,
    paginationOpts: { numItems: 100, cursor: null },
  });
  return result.page.map((pr) => pr.title);
}

export async function signedWebhook(t: T, event: string, payload: unknown, secret = "webhook-secret") {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return t.fetch("/api/integrations/github/webhook", {
    method: "POST",
    headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": `sha256=${hex}` },
    body,
  });
}

