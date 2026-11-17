import { ConvexError } from "convex/values";
import { errors } from "../errors";
import { GITHUB_API_URL, GITHUB_WEB_URL, githubCallbackUrl, readGithubAppConfig, type GithubAppConfig } from "./constants";
import { record, str } from "./parsers";
import type { SyncContext } from "./validators";

// GitHub REST client and credentials: App JWT, installation tokens, setup token encryption, and the OAuth exchange.

const FETCH_TIMEOUT_MS = 15_000;

export class GithubError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
    readonly rateLimited = false,
    /** GitHub's requested wait (Retry-After or the primary reset), when it gave one. */
    readonly retryAfterMs: number | null = null
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
async function readRateLimit(response: Response): Promise<{ rateLimited: boolean; retryAfterMs: number | null }> {
  const retryAfter = Number(response.headers.get("retry-after"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const primary = response.headers.get("x-ratelimit-remaining") === "0";
  const secondary =
    response.status === 403 &&
    ((Number.isFinite(retryAfter) && retryAfter > 0) || /rate limit/i.test(await response.text().catch(() => "")));
  const retryAfterMs = retryAfter > 0 ? retryAfter * 1000 : primary && reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : null;
  return { rateLimited: response.status === 429 || primary || secondary, retryAfterMs };
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
    const { rateLimited, retryAfterMs } =
      response.status === 403 || response.status === 429 ? await readRateLimit(response) : { rateLimited: false, retryAfterMs: null };
    throw new GithubError(response.status, `GitHub returned ${response.status}`, rateLimited, retryAfterMs);
  }
  return response.status === 204 ? null : response.json();
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

// --- Setup token encryption (AES-GCM, key derived from the App's client secret) ---

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

/** OAuth code → user-to-server token. Only proves setup authority; never stored past setup. */
export async function exchangeCode(config: GithubAppConfig, code: string): Promise<string> {
  const response = await fetch(`${GITHUB_WEB_URL}/login/oauth/access_token`, {
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Convoy" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: githubCallbackUrl(),
    }),
  }).catch(() => null);
  const body: unknown = response?.ok ? await response.json().catch(() => null) : null;
  const token = typeof body === "object" && body !== null && "access_token" in body ? body.access_token : null;
  if (typeof token !== "string") {
    throw new ConvexError(errors.GITHUB_AUTHORIZATION_FAILED);
  }
  return token;
}

/** By id, so a rename or a reused name never points sync at another repository. */
export function repoPath(context: SyncContext): string {
  return `/repositories/${context.providerRepositoryId}`;
}

