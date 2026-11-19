import { ConvexError, v, type Infer } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getAuthenticatedAccess, getOptionalAuthenticatedAccess } from "../../lib/access/auth";
import { ACCOUNT_STATE_PREFIX, linkedAccountStatusValidator } from "../../lib/contracts/github";
import { getActiveOrganizationById } from "../../organizations/lib/organizationsRepo";
import { getMembership, listMembershipsForUser } from "../../organizations/lib/membersRepo";
import { errors } from "./errors";
import { GITHUB_WEB_URL, githubCallbackUrl, readGithubAppConfig, type GithubAppConfig } from "./lib/constants";
import {
  GithubError,
  decryptToken,
  encryptToken,
  exchangeCode,
  githubFetch,
  refreshUserTokens,
  requireConfig,
  revokeUserToken,
  toUserError,
} from "./lib/github";
import {
  deleteLinkedAccount,
  findLinkedAccount,
  findLinkedAccountForGithubUser,
  getLinkedAccountById,
  listLinkedAccountsForGithubUser,
  normalizeOrganizationId,
  patchLinkedAccount,
  upsertLinkedAccount,
} from "./lib/integrationLinkedAccountsRepo";
import { num, record, str } from "./lib/parsers";

// Linked GitHub accounts and user-to-server tokens (docs/specs/github-integration.md → GitHub accounts and permissions).

const LINK_TTL_MS = 10 * 60 * 1000;
/** A write refreshes a token this close to expiry, so a slow request never runs on an expired one. */
const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REFRESH_LEASE_MS = 30 * 1000;
const REFRESH_WAIT_MS = 500;
/** Long enough to outlast a lease, so a waiter never gives up on a live refresh. */
const REFRESH_WAIT_ATTEMPTS = REFRESH_LEASE_MS / REFRESH_WAIT_MS;

/** The caller and the organization, which they must belong to. */
async function requireMember(ctx: QueryCtx | MutationCtx, organizationId: Id<"organizations">) {
  const { user } = await getAuthenticatedAccess(ctx);
  const organization = await getActiveOrganizationById(ctx, organizationId);
  if (!organization || !(await getMembership(ctx, organizationId, user._id))) {
    throw new ConvexError(errors.ACCOUNT_ORGANIZATION_NOT_FOUND);
  }
  return { user, organization };
}

const accountViewValidator = v.object({
  githubUserId: v.number(),
  login: v.string(),
  avatarUrl: v.union(v.string(), v.null()),
  status: linkedAccountStatusValidator,
});

/** Connected accounts: one row per organization the caller belongs to. Never returns tokens. */
export const listMine = query({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    organizations: v.array(
      v.object({
        organizationId: v.id("organizations"),
        organizationSlug: v.string(),
        organizationName: v.string(),
        account: v.union(accountViewValidator, v.null()),
      })
    ),
  }),
  handler: async (ctx) => {
    const configured = readGithubAppConfig() !== null;
    const auth = await getOptionalAuthenticatedAccess(ctx);
    if (!auth) return { configured, organizations: [] };
    const organizations = [];
    for (const membership of await listMembershipsForUser(ctx, auth.user._id)) {
      const organization = await getActiveOrganizationById(ctx, membership.organizationId);
      if (!organization) continue;
      const account = await findLinkedAccount(ctx, organization._id, auth.user._id);
      organizations.push({
        organizationId: organization._id,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        account: account
          ? { githubUserId: account.github.userId, login: account.github.login, avatarUrl: account.github.avatarUrl ?? null, status: account.status }
          : null,
      });
    }
    return { configured, organizations };
  },
});

// --- Connect: a signed state carries the member, organization, and return path, so no setup row is needed ---

/** `binary`: `text` holds one byte per char (a signature), not UTF-8. */
function base64Url(text: string, binary = false): string {
  const bytes = binary ? text : String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string, binary = false): string {
  const bytes = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return binary ? bytes : new TextDecoder().decode(Uint8Array.from(bytes, (char) => char.charCodeAt(0)));
}

async function stateKey(config: GithubAppConfig): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`convoy-github-account-state:${config.clientSecret}`);
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function stateSignature(config: GithubAppConfig, payload: string): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(config), new TextEncoder().encode(payload)));
  return base64Url(String.fromCharCode(...signature), true);
}

type LinkState = { userId: string; organizationId: string; returnTo: string; expiresAt: number };

async function verifyState(config: GithubAppConfig, state: string): Promise<LinkState> {
  const [payload, signature] = state.slice(ACCOUNT_STATE_PREFIX.length).split(".");
  // `verify` compares in constant time; malformed base64 reads as invalid too.
  const signed = async () => {
    const bytes = Uint8Array.from(fromBase64Url(signature, true), (char) => char.charCodeAt(0));
    return crypto.subtle.verify("HMAC", await stateKey(config), bytes, new TextEncoder().encode(payload));
  };
  const valid = state.startsWith(ACCOUNT_STATE_PREFIX) && Boolean(payload && signature) && (await signed().catch(() => false));
  if (!valid) throw new ConvexError(errors.ACCOUNT_LINK_INVALID);
  const parsed = record(JSON.parse(fromBase64Url(payload)) as unknown);
  const link = { userId: str(parsed.userId), organizationId: str(parsed.organizationId), returnTo: str(parsed.returnTo), expiresAt: num(parsed.expiresAt) };
  if (link.expiresAt <= Date.now()) throw new ConvexError(errors.ACCOUNT_LINK_EXPIRED);
  return link;
}

/** An app path only, so the callback can never send the browser to another site. */
function isAppPath(path: string): boolean {
  return path.length <= 2048 && /^\/(?![/\\])/.test(path);
}

/** Starts GitHub's App authorization for the caller in one organization; GitHub returns to the callback, then `returnTo`. */
export const beginLink = mutation({
  args: { organizationId: v.id("organizations"), returnTo: v.string() },
  returns: v.object({ authorizeUrl: v.string() }),
  handler: async (ctx, args) => {
    const config = readGithubAppConfig();
    if (!config) throw new ConvexError(errors.NOT_CONFIGURED);
    const { user } = await requireMember(ctx, args.organizationId);
    const link: LinkState = {
      userId: user._id,
      organizationId: args.organizationId,
      returnTo: isAppPath(args.returnTo) ? args.returnTo : "/",
      expiresAt: Date.now() + LINK_TTL_MS,
    };
    const payload = base64Url(JSON.stringify(link));
    const state = `${ACCOUNT_STATE_PREFIX}${payload}.${await stateSignature(config, payload)}`;
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: githubCallbackUrl(), state });
    return { authorizeUrl: `${GITHUB_WEB_URL}/login/oauth/authorize?${query}` };
  },
});

const encryptedTokensValidator = v.object({
  encryptedAccessToken: v.string(),
  accessTokenExpiresAt: v.optional(v.number()),
  encryptedRefreshToken: v.optional(v.string()),
});

export const saveLink = internalMutation({
  args: {
    /** Both from the signed state. */
    userId: v.string(),
    organizationId: v.string(),
    githubUser: v.object({ id: v.number(), login: v.string(), avatarUrl: v.optional(v.string()) }),
    tokens: encryptedTokensValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organizationId = normalizeOrganizationId(ctx, args.organizationId);
    if (!organizationId) throw new ConvexError(errors.ACCOUNT_LINK_INVALID);
    const { user } = await requireMember(ctx, organizationId);
    // The state names the member who started it; anyone else finishing it is refused.
    if (user._id !== args.userId) throw new ConvexError(errors.ACCOUNT_LINK_INVALID);
    const holder = await findLinkedAccountForGithubUser(ctx, organizationId, args.githubUser.id);
    if (holder && holder.userId !== user._id) throw new ConvexError(errors.ACCOUNT_LINKED_TO_ANOTHER_MEMBER);
    await upsertLinkedAccount(
      ctx,
      { organizationId, userId: user._id },
      { userId: args.githubUser.id, login: args.githubUser.login, avatarUrl: args.githubUser.avatarUrl, ...args.tokens }
    );
    return null;
  },
});

async function encryptTokens(config: GithubAppConfig, tokens: { accessToken: string; expiresAt?: number; refreshToken?: string }) {
  return {
    encryptedAccessToken: await encryptToken(config, tokens.accessToken),
    ...(tokens.expiresAt === undefined ? {} : { accessTokenExpiresAt: tokens.expiresAt }),
    ...(tokens.refreshToken === undefined ? {} : { encryptedRefreshToken: await encryptToken(config, tokens.refreshToken) }),
  };
}

/** The OAuth callback for Connect GitHub: exchange the code, read who authorized, link them. */
export const completeLink = action({
  args: { state: v.string(), code: v.string() },
  returns: v.object({ returnTo: v.string() }),
  handler: async (ctx, args): Promise<{ returnTo: string }> => {
    const config = requireConfig();
    const link = await verifyState(config, args.state);
    const tokens = await exchangeCode(config, args.code);
    const githubUser = record(
      await githubFetch("/user", { token: tokens.accessToken }).catch((error: unknown) => {
        throw toUserError(error);
      })
    );
    const avatarUrl = typeof githubUser.avatar_url === "string" ? githubUser.avatar_url : undefined;
    await ctx.runMutation(internal.integrations.github.accounts.saveLink, {
      userId: link.userId,
      organizationId: link.organizationId,
      githubUser: { id: num(githubUser.id), login: str(githubUser.login), ...(avatarUrl ? { avatarUrl } : {}) },
      tokens: await encryptTokens(config, tokens),
    });
    return { returnTo: link.returnTo };
  },
});

export const removeLink = internalMutation({
  args: { organizationId: v.id("organizations") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx);
    const account = await findLinkedAccount(ctx, args.organizationId, user._id);
    if (!account) return null;
    await deleteLinkedAccount(ctx, account._id);
    return account.github.encryptedAccessToken;
  },
});

/** Unlinks the caller's account in one organization and revokes that token on GitHub. The project's installation is untouched. */
export const disconnect = action({
  args: { organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const encrypted = await ctx.runMutation(internal.integrations.github.accounts.removeLink, args);
    const config = readGithubAppConfig();
    if (encrypted && config) {
      await revokeUserToken(config, await decryptToken(config, encrypted).catch(() => ""));
    }
    return null;
  },
});

/** GitHub's `github_app_authorization` revoked event: every organization's link to that person waits for Reconnect. */
export const markRevoked = internalMutation({
  args: { githubUserId: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const account of await listLinkedAccountsForGithubUser(ctx, args.githubUserId)) {
      await patchLinkedAccount(ctx, account, { status: "reconnect", github: { refreshLeaseUntil: undefined } });
    }
    return null;
  },
});

// --- Tokens on use: refreshed lazily, one refresh per account at a time ---

const callerAccountValidator = v.object({
  accountId: v.id("integrationLinkedAccounts"),
  status: linkedAccountStatusValidator,
  encryptedAccessToken: v.string(),
  accessTokenExpiresAt: v.optional(v.number()),
  encryptedRefreshToken: v.optional(v.string()),
  refreshLeaseUntil: v.optional(v.number()),
  githubUserId: v.number(),
});

export const getCallerAccount = internalQuery({
  args: { organizationId: v.id("organizations") },
  returns: v.union(callerAccountValidator, v.null()),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.organizationId);
    const account = await findLinkedAccount(ctx, args.organizationId, user._id);
    if (!account) return null;
    const { encryptedAccessToken, accessTokenExpiresAt, encryptedRefreshToken, refreshLeaseUntil } = account.github;
    return {
      accountId: account._id,
      status: account.status,
      encryptedAccessToken,
      accessTokenExpiresAt,
      encryptedRefreshToken,
      refreshLeaseUntil,
      githubUserId: account.github.userId,
    };
  },
});

/** `rotated`: another refresh already replaced the token the caller read. `busy`: one is in flight. */
export const claimRefresh = internalMutation({
  args: { accountId: v.id("integrationLinkedAccounts"), encryptedAccessToken: v.string() },
  returns: v.union(v.literal("claimed"), v.literal("rotated"), v.literal("busy")),
  handler: async (ctx, args) => {
    const account = await getLinkedAccountById(ctx, args.accountId);
    if (!account || account.github.encryptedAccessToken !== args.encryptedAccessToken) return "rotated";
    if ((account.github.refreshLeaseUntil ?? 0) > Date.now()) return "busy";
    await patchLinkedAccount(ctx, account, { github: { refreshLeaseUntil: Date.now() + REFRESH_LEASE_MS } });
    return "claimed";
  },
});

/** Ends a refresh: stores the new pair, or with `reconnect` marks the account, or with neither just releases the lease. */
export const finishRefresh = internalMutation({
  args: {
    accountId: v.id("integrationLinkedAccounts"),
    encryptedAccessToken: v.string(),
    tokens: v.optional(encryptedTokensValidator),
    reconnect: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await getLinkedAccountById(ctx, args.accountId);
    // A relink in the meantime brought newer tokens; leave them.
    if (!account || account.github.encryptedAccessToken !== args.encryptedAccessToken) return null;
    await patchLinkedAccount(ctx, account, {
      ...(args.reconnect ? { status: "reconnect" as const } : {}),
      github: { refreshLeaseUntil: undefined, ...(args.tokens ?? {}) },
    });
    return null;
  },
});

type UsableToken = { accountId: Id<"integrationLinkedAccounts">; encryptedAccessToken: string; token: string; githubUserId: number };

const wait = () => new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));

async function readCallerAccount(ctx: ActionCtx, organizationId: Id<"organizations">) {
  const account = await ctx.runQuery(internal.integrations.github.accounts.getCallerAccount, { organizationId });
  if (!account) throw new ConvexError(errors.GITHUB_ACCOUNT_REQUIRED);
  if (account.status === "reconnect") throw new ConvexError(errors.GITHUB_RECONNECT_REQUIRED);
  return account;
}

/** The caller's token, refreshed first when it is about to expire. */
async function freshToken(ctx: ActionCtx, config: GithubAppConfig, organizationId: Id<"organizations">): Promise<UsableToken> {
  for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
    const account = await readCallerAccount(ctx, organizationId);
    const { accountId, encryptedAccessToken, accessTokenExpiresAt: expiresAt, encryptedRefreshToken, githubUserId } = account;
    const current = async () => ({ accountId, encryptedAccessToken, githubUserId, token: await decryptToken(config, encryptedAccessToken) });
    if (expiresAt === undefined || !encryptedRefreshToken || expiresAt - Date.now() > REFRESH_EARLY_MS) return current();
    const claim = await ctx.runMutation(internal.integrations.github.accounts.claimRefresh, { accountId, encryptedAccessToken });
    if (claim === "rotated") continue;
    if (claim === "busy") {
      // GitHub invalidates the current token the moment that refresh succeeds, so wait for the new one.
      await wait();
      continue;
    }
    const finish = (rest: { tokens?: Awaited<ReturnType<typeof encryptTokens>>; reconnect?: boolean }) =>
      ctx.runMutation(internal.integrations.github.accounts.finishRefresh, { accountId, encryptedAccessToken, ...rest });
    let tokens;
    try {
      tokens = await refreshUserTokens(config, await decryptToken(config, encryptedRefreshToken));
    } catch (error) {
      // An outage is not a revocation: release the lease and keep the account.
      await finish({});
      throw toUserError(error);
    }
    if (!tokens) {
      await finish({ reconnect: true });
      throw new ConvexError(errors.GITHUB_RECONNECT_REQUIRED);
    }
    const encrypted = await encryptTokens(config, tokens);
    await finish({ tokens: encrypted });
    return { accountId, encryptedAccessToken: encrypted.encryptedAccessToken, token: tokens.accessToken, githubUserId };
  }
  throw new ConvexError(errors.GITHUB_REFRESH_BUSY);
}

/** After a 401: true once another refresh stored a new token, false when none is in flight to explain it. */
async function rotatedSince(ctx: ActionCtx, organizationId: Id<"organizations">, encryptedAccessToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
    const latest = await readCallerAccount(ctx, organizationId);
    if (latest.encryptedAccessToken !== encryptedAccessToken) return true;
    if ((latest.refreshLeaseUntil ?? 0) <= Date.now()) return false;
    await wait();
  }
  throw new ConvexError(errors.GITHUB_REFRESH_BUSY);
}

/**
 * Runs `write` with the caller's user-to-server token in `organizationId`. A
 * 401 retries once when a concurrent refresh rotated the token; otherwise
 * the account is marked for Reconnect GitHub.
 */
export async function withUserToken<T>(
  ctx: ActionCtx,
  organizationId: Id<"organizations">,
  write: (token: string, githubUserId: number) => Promise<T>
): Promise<T> {
  const config = requireConfig();
  for (let retried = false; ; retried = true) {
    const usable = await freshToken(ctx, config, organizationId);
    try {
      return await write(usable.token, usable.githubUserId);
    } catch (error) {
      if (!(error instanceof GithubError && error.status === 401)) throw error;
      if (!retried && (await rotatedSince(ctx, organizationId, usable.encryptedAccessToken))) continue;
      await ctx.runMutation(internal.integrations.github.accounts.finishRefresh, {
        accountId: usable.accountId,
        encryptedAccessToken: usable.encryptedAccessToken,
        reconnect: true,
      });
      throw new ConvexError(errors.GITHUB_RECONNECT_REQUIRED);
    }
  }
}

/**
 * Runs `write` as the caller on a PR in the project's connected repository.
 * GitHub refusing it reads as `refused`; `refresh` resyncs the stored PR afterwards.
 */
export async function writeAs<T>(
  ctx: ActionCtx,
  args: { projectId: Id<"projects">; repositoryId: string; number: number },
  write: (token: string, repository: string, githubUserId: number, names: { owner: string; name: string }) => Promise<T>,
  { refused, refresh = false }: { refused: string; refresh?: boolean }
): Promise<T> {
  const live = await ctx.runQuery(internal.integrations.github.pullRequests.getReadableContext, args);
  if (!live) throw new ConvexError(errors.NOT_CONNECTED);
  const repository = `/repositories/${live.context.providerRepositoryId}`;
  const result = await withUserToken(ctx, live.organizationId, (token, githubUserId) => write(token, repository, githubUserId, live)).catch(
    (error: unknown) => {
      if (error instanceof GithubError && !error.rateLimited && [403, 404, 410, 422].includes(error.status ?? 0)) {
        throw new ConvexError(refused);
      }
      throw toUserError(error);
    }
  );
  if (refresh) {
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
      repositoryId: live.repositoryId,
      repositoryLinkId: live.repositoryLinkId,
      generation: live.generation,
      target: { kind: "pullRequest", number: args.number },
    });
  }
  return result;
}

const repositoryPermissionValidator = v.union(
  v.literal("none"),
  v.literal("read"),
  v.literal("triage"),
  v.literal("write"),
  v.literal("maintain"),
  v.literal("admin")
);

/** GitHub's `permissions` object, highest grant first. */
function repositoryPermission(permissions: Record<string, unknown>) {
  if (permissions.admin === true) return "admin" as const;
  if (permissions.maintain === true) return "maintain" as const;
  if (permissions.push === true) return "write" as const;
  if (permissions.triage === true) return "triage" as const;
  return permissions.pull === true ? ("read" as const) : ("none" as const);
}

/**
 * The caller's Linked GitHub account's role on a connected repository, read
 * once per reader open. Null when unknown: no active account, or GitHub didn't answer.
 */
export const readRepositoryPermission = action({
  args: { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() },
  returns: v.union(repositoryPermissionValidator, v.null()),
  handler: async (ctx, args): Promise<Infer<typeof repositoryPermissionValidator> | null> => {
    const live = await ctx.runQuery(internal.integrations.github.pullRequests.getReadableContext, args);
    if (!live) throw new ConvexError(errors.NOT_CONNECTED);
    const account = await ctx.runQuery(internal.integrations.github.accounts.getCallerAccount, { organizationId: live.organizationId });
    if (account?.status !== "active") return null;
    try {
      return await withUserToken(ctx, live.organizationId, async (token) => {
        const repo = record(await githubFetch(`/repositories/${live.context.providerRepositoryId}`, { token }));
        return repositoryPermission(record(repo.permissions ?? {}));
      });
    } catch (error) {
      if (error instanceof GithubError && !error.rateLimited && (error.status === 403 || error.status === 404)) return "none";
      if (error instanceof ConvexError) return null;
      throw toUserError(error);
    }
  },
});
