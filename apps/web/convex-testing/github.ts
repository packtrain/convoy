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
  comments?: { id: number; login: string; body: string; created_at: string }[];
  assignees?: string[];
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
  }[];
  checkRuns?: { id: number; name: string; status: string; conclusion: string | null; title?: string; app?: { id: number } }[];
  statuses?: { id: number; context: string; state: string; description: string }[];
  behindBy?: number;
};

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
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      merged_at: pr.merged ? new Date(pr.updatedAt).toISOString() : null,
      draft: pr.draft,
      labels: pr.labels.map((name) => ({ name })),
      user: { login: "octocat" },
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
  function pullDetailJson(pr: FakePullRequest) {
    return {
      ...pullJson(pr),
      mergeable: pr.mergeable === undefined ? true : pr.mergeable,
      commits: pr.commits?.length ?? 0,
      requested_reviewers: (pr.requestedReviewers ?? []).map((login) => ({ login })),
      requested_teams: [],
      assignees: (pr.assignees ?? []).map(githubUser),
      milestone: pr.milestone ? { ...pr.milestone, html_url: `https://github.com/milestone/${pr.milestone.number}` } : null,
    };
  }

  function overviewJson(pr: FakePullRequest, part: string) {
    if (part === "/commits") {
      return (pr.commits ?? []).map((commit) => ({
        sha: commit.sha,
        html_url: `https://github.com/commit/${commit.sha}`,
        author: commit.login ? { login: commit.login } : null,
        commit: { message: commit.message, author: { name: commit.name, date: commit.date } },
      }));
    }
    if (part === "/comments") {
      return (pr.reviewComments ?? []).map((comment) => ({ ...comment, user: githubUser(comment.login), html_url: `https://github.com/rc/${comment.id}` }));
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
      const body = JSON.parse(String(init?.body)) as { code: string };
      return json(200, body.code === GOOD_CODE ? { access_token: "user-token" } : { error: "bad_verification_code" });
    }
    if (path === "/user/installations") {
      return json(200, { installations: [...state.installations.keys()].map((id) => ({ id })) });
    }
    let match = /^\/user\/installations\/(\d+)\/repositories$/.exec(path);
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
      return pr ? json(200, overviewJson(pr, part)) : json(404, {});
    }
    match = /^\/repositories\/(\d+)\/issues\/(\d+)\/comments$/.exec(path);
    if (match) {
      const [, repositoryId, number] = match;
      const pr = state.pulls.get(Number(repositoryId))?.find((candidate) => candidate.number === Number(number));
      return pr
        ? json(200, (pr.comments ?? []).map((comment) => ({ ...comment, user: githubUser(comment.login), html_url: `https://github.com/c/${comment.id}` })))
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
      return json(200, pullDetailJson(pr));
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

