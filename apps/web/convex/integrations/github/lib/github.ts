import { ConvexError } from "convex/values";
import { errors } from "../errors";
import { GITHUB_API_URL, GITHUB_WEB_URL, githubCallbackUrl, readGithubAppConfig, type GithubAppConfig } from "./constants";
import { list, normalizeRequiredChecks, record, str } from "./parsers";
import type { SyncContext } from "./validators";

// GitHub REST client and credentials: App JWT, installation tokens, token encryption, and user-to-server tokens.

const FETCH_TIMEOUT_MS = 15_000;

export class GithubError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
    readonly rateLimited = false,
    /** GitHub's requested wait (Retry-After or the primary reset), when it gave one. */
    readonly retryAfterMs: number | null = null,
    /** GitHub's own `message`, such as why it refused a merge. */
    readonly detail: string | null = null
  ) {
    super(message);
  }
}

/** Public actions rethrow provider failures as catalog messages; Convex hides plain errors from clients. */
export function toUserError(error: unknown, notFound?: string): unknown {
  if (!(error instanceof GithubError)) return error;
  if (error.rateLimited) return new ConvexError(errors.GITHUB_RATE_LIMITED);
  return new ConvexError(error.status === 404 && notFound ? notFound : errors.GITHUB_UNAVAILABLE);
}

/** GitHub says the installation lost the repository. Throttling and outages never count. */
export function isAccessLoss(error: unknown): boolean {
  return error instanceof GithubError && !error.rateLimited && (error.status === 403 || error.status === 404 || error.status === 422);
}

/** Primary and secondary limits (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). */
function readRateLimit(response: Response, body: string): { rateLimited: boolean; retryAfterMs: number | null } {
  const retryAfter = Number(response.headers.get("retry-after"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const primary = response.headers.get("x-ratelimit-remaining") === "0";
  const secondary =
    response.status === 403 &&
    ((Number.isFinite(retryAfter) && retryAfter > 0) || /rate limit/i.test(body));
  const retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : primary && reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : null;
  return { rateLimited: response.status === 429 || primary || secondary, retryAfterMs };
}

function githubMessage(body: string): string | null {
  try {
    const message = record(JSON.parse(body)).message;
    return typeof message === "string" && message ? message : null;
  } catch {
    return null;
  }
}

type GithubAuth = { token: string } | { appJwt: string };

export async function githubFetch(path: string, auth: GithubAuth, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_URL}${path}`, {
      method: init.method ?? "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${"token" in auth ? auth.token : auth.appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Convoy",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new GithubError(null, errors.GITHUB_UNAVAILABLE);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const { rateLimited, retryAfterMs } =
      response.status === 403 || response.status === 429 ? readRateLimit(response, body) : { rateLimited: false, retryAfterMs: null };
    throw new GithubError(response.status, `GitHub returned ${response.status}`, rateLimited, retryAfterMs, githubMessage(body));
  }
  return response.status === 204 ? null : response.json();
}

/** REST's status for a GraphQL error type; any other type reads as GitHub refusing the change. */
const GRAPHQL_ERROR_STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404 };

/** GitHub GraphQL. It reports errors with a 200, so they are rethrown as REST would answer them. */
export async function githubGraphql(token: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const body = record(await githubFetch("/graphql", { token }, { method: "POST", body: { query, variables } }));
  const [error] = list(body.errors ?? []);
  if (error !== undefined) {
    const type = record(error).type;
    const rateLimited = type === "RATE_LIMITED";
    throw new GithubError(rateLimited ? 403 : (GRAPHQL_ERROR_STATUS[String(type)] ?? 422), `GitHub GraphQL returned ${String(type)}`, rateLimited);
  }
  return body.data;
}

// --- App and installation credentials ---

function base64Url(bytes: Uint8Array | string): string {
  const binary = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** RS256 App JWT. The key must be PKCS#8 ("BEGIN PRIVATE KEY"); see the deployment guide. */
export async function createAppJwt(config: GithubAppConfig, now = Date.now()): Promise<string> {
  const pem = config.privateKey.replace(/\\n/g, "\n");
  const der = base64ToBytes(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const seconds = Math.floor(now / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: config.appId })
  )}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

/** Every read Convoy makes: PRs and their comments, check runs, commit statuses, and compare/file contents. */
const READ_PERMISSIONS = { pull_requests: "read", checks: "read", statuses: "read", contents: "read", metadata: "read" };

/** An installation token limited to the given repositories, read-only. */
export async function mintRepositoryToken(config: GithubAppConfig, installationId: number, ...providerRepositoryIds: number[]) {
  return mintToken(config, installationId, providerRepositoryIds, READ_PERMISSIONS);
}

/** A token that can only read the repository's issues: who closed a watched PR is only on its issue. */
export async function mintIssueReadToken(config: GithubAppConfig, installationId: number, providerRepositoryId: number) {
  return mintToken(config, installationId, [providerRepositoryId], { issues: "read", metadata: "read" });
}

/** A token that can only publish check runs on one repository (Pull request checks, OS-2401). */
export async function mintCheckRunToken(config: GithubAppConfig, installationId: number, providerRepositoryId: number) {
  return mintToken(config, installationId, [providerRepositoryId], { checks: "write", metadata: "read" });
}

async function mintToken(config: GithubAppConfig, installationId: number, repositoryIds: number[], permissions: Record<string, string>) {
  const response = record(
    await githubFetch(
      `/app/installations/${installationId}/access_tokens`,
      { appJwt: await createAppJwt(config) },
      { method: "POST", body: { repository_ids: repositoryIds, permissions } }
    )
  );
  return str(response.token);
}

export function requireConfig(): GithubAppConfig {
  const config = readGithubAppConfig();
  if (!config) throw new ConvexError(errors.NOT_CONFIGURED);
  return config;
}

// --- Token encryption (AES-GCM, key derived from the App's client secret) ---

async function setupKey(config: GithubAppConfig): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`convoy-github-setup:${config.clientSecret}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(config: GithubAppConfig, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await setupKey(config), new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(sealed)));
}

export async function decryptToken(config: GithubAppConfig, encrypted: string): Promise<string> {
  const bytes = base64ToBytes(encrypted);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await setupKey(config), bytes.slice(12));
  return new TextDecoder().decode(plain);
}

/** A user-to-server token; `expiresAt` and `refreshToken` only when the App expires tokens (8 hours, refreshable for 6 months). */
export type UserTokens = { accessToken: string; expiresAt?: number; refreshToken?: string };

async function requestUserTokens(config: GithubAppConfig, grant: Record<string, string>): Promise<UserTokens | null> {
  const response = await fetch(`${GITHUB_WEB_URL}/login/oauth/access_token`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Convoy" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...grant }),
  }).catch(() => null);
  if (!response?.ok) throw new GithubError(response?.status ?? null, errors.GITHUB_UNAVAILABLE);
  // GitHub answers 200 with an `error` field for a bad code or refresh token.
  const body = record(await response.json().catch(() => null));
  if (typeof body.access_token !== "string") return null;
  return {
    accessToken: body.access_token,
    ...(typeof body.expires_in === "number" ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}),
    ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}),
  };
}

/** OAuth code → user-to-server tokens. */
export async function exchangeCode(config: GithubAppConfig, code: string): Promise<UserTokens> {
  const tokens = await requestUserTokens(config, { code, redirect_uri: githubCallbackUrl() }).catch(() => null);
  if (!tokens) throw new ConvexError(errors.GITHUB_AUTHORIZATION_FAILED);
  return tokens;
}

/** A new token pair, or null when GitHub refuses the refresh token (expired or revoked). Rotates both tokens. */
export async function refreshUserTokens(config: GithubAppConfig, refreshToken: string): Promise<UserTokens | null> {
  return requestUserTokens(config, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Revokes one token, never the App grant the person's other organizations share. Best effort. */
export async function revokeUserToken(config: GithubAppConfig, accessToken: string): Promise<void> {
  await fetch(`${GITHUB_API_URL}/applications/${encodeURIComponent(config.clientId)}/token`, {
    method: "DELETE",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      "Content-Type": "application/json",
      "User-Agent": "Convoy",
    },
    body: JSON.stringify({ access_token: accessToken }),
  }).catch(() => null);
}

/** By id, so a rename or a reused name never points sync at another repository. */
export function repoPath(context: SyncContext): string {
  return `/repositories/${context.providerRepositoryId}`;
}


const CHECKS_PAGE_SIZE = 100;
// ponytail: 10 pages, 1,000 check runs, statuses, comments, or reviews; reviews come oldest first, so past 1,000 the newest are cut. Read them from the last page when a PR outgrows that.
const CHECKS_PAGES_MAX = 10;

/** Up to CHECKS_PAGES_MAX pages of `path`, each page's items picked by `items`. */
async function readPages(token: string, path: string, items: (page: unknown) => unknown[]): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= CHECKS_PAGES_MAX; page++) {
    const batch = items(await githubFetch(`${path}${path.includes("?") ? "&" : "?"}per_page=${CHECKS_PAGE_SIZE}&page=${page}`, { token }));
    all.push(...batch);
    if (batch.length < CHECKS_PAGE_SIZE) break;
  }
  return all;
}

/** Every check run and commit status on `headSha`, as GitHub's own responses would hold them unpaged. */
export async function fetchHeadChecks(token: string, context: SyncContext, headSha: string): Promise<{ checkRuns: unknown; status: unknown }> {
  const base = `${repoPath(context)}/commits/${headSha}`;
  const readAll = async (path: string, key: string) => ({ [key]: await readPages(token, `${base}/${path}`, (page) => list(record(page)[key] ?? [])) });
  const [checkRuns, status] = await Promise.all([readAll("check-runs", "check_runs"), readAll("status", "statuses")]);
  return { checkRuns, status };
}

/**
 * PR `number`'s comments and review comments changed since `since`, and all its reviews: GitHub filters reviews by nothing.
 * Reviews are read last, so every review comment read has its review.
 */
export async function fetchPullRequestComments(token: string, context: SyncContext, number: number, since: number) {
  const base = repoPath(context);
  const after = encodeURIComponent(new Date(since).toISOString());
  const [comments, reviewComments] = await Promise.all([
    readPages(token, `${base}/issues/${number}/comments?since=${after}`, list),
    readPages(token, `${base}/pulls/${number}/comments?since=${after}&sort=created&direction=asc`, list),
  ]);
  return { comments, reviewComments, reviews: await readPages(token, `${base}/pulls/${number}/reviews`, list) };
}

/** The checks `baseRef` requires before a merge: branch protection (Contents read) and rulesets (Metadata read). */
export async function fetchRequiredChecks(token: string, context: SyncContext, baseRef: string): Promise<string[]> {
  const branch = encodeURIComponent(baseRef);
  const [protection, rules] = await Promise.all([
    githubFetch(`${repoPath(context)}/branches/${branch}`, { token }),
    githubFetch(`${repoPath(context)}/rules/branches/${branch}?per_page=100`, { token }),
  ]);
  return normalizeRequiredChecks(protection, rules);
}
