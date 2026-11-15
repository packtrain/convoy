import { ConvexError, v, type Infer } from "convex/values";
import { action, internalMutation, internalQuery, mutation } from "../../_generated/server";
import type { ActionCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../../lib/access/auth";
import { requireAuthorizedProject } from "../../lib/access/permissions";
import { getActiveOrganizationById } from "../../organizations/lib/organizationsRepo";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "./errors";
import { GITHUB_HOST, PAGE_SIZE, githubAuthorizeUrl, readGithubAppConfig, type GithubAppConfig } from "./lib/constants";
import { verifiedRepositoryValidator } from "./lib/validators";
import { disconnectLink, startReconcile } from "./lib/lifecycle";
import {
  MAX_PROJECT_REPOSITORIES,
  findRepositoryLinkForProjectAndRepository,
  getActiveRepositoryLinkForRepository,
  getRepositoryLinkById,
  insertRepositoryLink,
  listActiveRepositoryLinksForProject,
  reactivateRepositoryLink,
} from "./lib/integrationRepositoryLinksRepo";
import { getRepositoryById, updateRepositorySync, upsertRepository } from "./lib/integrationRepositoriesRepo";
import { SETUP_TTL_MS, deleteSetup, getSetupById, getSetupByStateHash, replaceSetup, updateSetup } from "./lib/integrationSetupsRepo";
import {
  GithubError,
  createAppJwt,
  decryptToken,
  encryptToken,
  exchangeCode,
  githubFetch,
  mintRepositoryToken,
  requireConfig,
  toUserError,
} from "./lib/github";
import { list, num, record, str } from "./lib/parsers";

// The connect flow: authorize with GitHub, pick repositories, connect them (docs/specs/github-integration.md).

async function hashState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}


export const beginSetup = mutation({
  args: { projectId: v.id("projects") },
  returns: v.object({ setupId: v.id("integrationSetups"), authorizeUrl: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const config = await ensure(readGithubAppConfig()).notNull(errors.NOT_CONFIGURED);
    const state = randomState();
    const { setupId, expiresAt } = await replaceSetup(ctx, {
      userId: user._id,
      projectId: args.projectId,
      provider: "github",
      stateHash: await hashState(state),
    });
    await ctx.scheduler.runAfter(SETUP_TTL_MS, internal.integrations.github.setup.expireSetup, { setupId });
    return { setupId, authorizeUrl: githubAuthorizeUrl(config, state), expiresAt };
  },
});

export const cancelSetup = mutation({
  args: { setupId: v.id("integrationSetups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await getAuthenticatedAccess(ctx);
    const setup = await getSetupById(ctx, args.setupId);
    if (setup && setup.userId === user._id) {
      await deleteSetup(ctx, setup._id);
    }
    return null;
  },
});

/** The caller's live setup with project-admin authority, or a thrown reason. */
async function requireOwnedSetup(ctx: MutationCtx, setup: Doc<"integrationSetups"> | null) {
  const { user, principal } = await getAuthenticatedAccess(ctx);
  const owned = await ensure(setup).notNull(errors.SETUP_NOT_FOUND);
  ensure(owned.userId).eq(user._id, errors.SETUP_NOT_FOUND);
  ensure(owned.expiresAt > Date.now()).isTrue(errors.SETUP_EXPIRED);
  const access = await requireAuthorizedProject(ctx, principal, owned.projectId, ProjectPermission.PROJECT_UPDATE);
  return { setup: owned, user, access };
}

/** Single-use: the callback claims the setup before exchanging GitHub's code. */
export const claimSetup = internalMutation({
  args: { state: v.string() },
  returns: v.object({ setupId: v.id("integrationSetups"), organizationSlug: v.string(), projectAlias: v.string() }),
  handler: async (ctx, args) => {
    const stateHash = await hashState(args.state);
    const { setup, access } = await requireOwnedSetup(ctx, await getSetupByStateHash(ctx, "github", stateHash));
    ensure(setup.status).eq("pending", errors.SETUP_ALREADY_USED);
    await updateSetup(ctx, setup._id, { status: "claimed" });
    const organization = await ensure(getActiveOrganizationById(ctx, access.project.organizationId)).notNull(errors.SETUP_NOT_FOUND);
    return { setupId: setup._id, organizationSlug: organization.slug, projectAlias: access.project.alias };
  },
});

export const authorizeSetup = internalMutation({
  args: { setupId: v.id("integrationSetups"), encryptedToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { setup } = await requireOwnedSetup(ctx, await getSetupById(ctx, args.setupId));
    ensure(setup.status).eq("claimed", errors.SETUP_ALREADY_USED);
    await updateSetup(ctx, setup._id, { status: "authorized", github: { encryptedToken: args.encryptedToken } });
    return null;
  },
});

/** Read side of the setup for selection actions; same ownership checks as the writes. */
export const getAuthorizedSetup = internalQuery({
  args: { setupId: v.id("integrationSetups") },
  returns: v.object({ projectId: v.id("projects"), encryptedToken: v.string() }),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx);
    const setup = await ensure(getSetupById(ctx, args.setupId)).notNull(errors.SETUP_NOT_FOUND);
    ensure(setup.userId).eq(user._id, errors.SETUP_NOT_FOUND);
    ensure(setup.expiresAt > Date.now()).isTrue(errors.SETUP_EXPIRED);
    await requireAuthorizedProject(ctx, principal, setup.projectId, ProjectPermission.PROJECT_UPDATE);
    const encryptedToken = await ensure(setup.github.encryptedToken).notNull(errors.SETUP_NOT_AUTHORIZED);
    return { projectId: setup.projectId, encryptedToken };
  },
});

/** Final authority check, then apply the selection: disconnect the removed links and link the GitHub-verified repositories. */
export const applyRepositories = internalMutation({
  args: {
    setupId: v.id("integrationSetups"),
    repositories: v.array(verifiedRepositoryValidator),
    removeRepositoryLinkIds: v.array(v.id("integrationRepositoryLinks")),
  },
  returns: v.array(v.id("integrationRepositoryLinks")),
  handler: async (ctx, args) => {
    const { setup, user, access } = await requireOwnedSetup(ctx, await getSetupById(ctx, args.setupId));
    ensure(setup.status).eq("authorized", errors.SETUP_NOT_AUTHORIZED);
    for (const repositoryLinkId of args.removeRepositoryLinkIds) {
      const link = await ensure(getRepositoryLinkById(ctx, repositoryLinkId)).notNull(errors.CONNECTION_NOT_FOUND);
      ensure(link.projectId).eq(setup.projectId, errors.CONNECTION_NOT_FOUND);
      if (link.status === "active") {
        await disconnectLink(ctx, link);
      }
    }
    const active = await listActiveRepositoryLinksForProject(ctx, setup.projectId);
    const linkIds: Id<"integrationRepositoryLinks">[] = [];
    for (const repository of args.repositories) {
      linkIds.push(await connectOne(ctx, { projectId: setup.projectId, organizationId: access.project.organizationId, userId: user._id }, repository));
    }
    const added = linkIds.filter((id) => !active.some((link) => link._id === id)).length;
    ensure(active.length + added <= MAX_PROJECT_REPOSITORIES).isTrue(errors.TOO_MANY_REPOSITORIES);
    await deleteSetup(ctx, setup._id);
    return linkIds;
  },
});

/** Link one repository, reactivating a retained link; starts the sync unless another project's link keeps it current. */
async function connectOne(
  ctx: MutationCtx,
  owner: { projectId: Id<"projects">; organizationId: Id<"organizations">; userId: Id<"users"> },
  verified: Infer<typeof verifiedRepositoryValidator>
): Promise<Id<"integrationRepositoryLinks">> {
  const { installationId, accountLogin, providerRepositoryId, ...details } = verified;
  const repositoryId = await upsertRepository(
    ctx,
    { organizationId: owner.organizationId, provider: "github", host: GITHUB_HOST, providerRepositoryId },
    details
  );
  const existing = await findRepositoryLinkForProjectAndRepository(ctx, owner.projectId, repositoryId);
  if (existing?.status === "active") {
    return existing._id;
  }
  const github = { installationId, accountLogin };
  // Another project's live link already keeps the shared rows current.
  const liveElsewhere = await getActiveRepositoryLinkForRepository(ctx, repositoryId);
  let repositoryLinkId: Id<"integrationRepositoryLinks">;
  if (existing) {
    repositoryLinkId = existing._id;
    await reactivateRepositoryLink(ctx, existing, { github, connectedBy: owner.userId });
  } else {
    repositoryLinkId = await insertRepositoryLink(ctx, {
      organizationId: owner.organizationId,
      projectId: owner.projectId,
      repositoryId,
      provider: "github",
      github,
      connectedBy: owner.userId,
    });
  }
  if (liveElsewhere) {
    return repositoryLinkId;
  }
  const link = await ensure(getRepositoryLinkById(ctx, repositoryLinkId)).notNull(errors.CONNECTION_NOT_FOUND);
  const repository = await ensure(getRepositoryById(ctx, repositoryId)).notNull(errors.CONNECTION_NOT_FOUND);
  if (repository.lastSuccessAt !== undefined) {
    // Stored rows missed every event since the last pass: reconcile them, open PRs included.
    await startReconcile(ctx, repository, link);
  }
  if (repository.lastSuccessAt === undefined || repository.importPage !== undefined) {
    const page = repository.importPage ?? 1;
    // A first import's pass later reads the PRs changed while it ran.
    const reconciledAt = repository.reconciledAt ?? Date.now();
    await updateRepositorySync(ctx, repositoryId, {
      syncStatus: "importing",
      importPage: page,
      error: undefined,
      reconciledAt,
      ...(page === 1 ? { importedCount: 0 } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
      repositoryId,
      repositoryLinkId,
      generation: link.generation,
      target: { kind: "import", page },
    });
  }
  return repositoryLinkId;
}

export const expireSetup = internalMutation({
  args: { setupId: v.id("integrationSetups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const setup = await getSetupById(ctx, args.setupId);
    if (setup && setup.expiresAt <= Date.now()) {
      await deleteSetup(ctx, setup._id);
    }
    return null;
  },
});



export const completeSetup = action({
  args: { state: v.string(), code: v.string() },
  returns: v.object({ setupId: v.id("integrationSetups"), organizationSlug: v.string(), projectAlias: v.string() }),
  handler: async (ctx, args): Promise<{ setupId: Id<"integrationSetups">; organizationSlug: string; projectAlias: string }> => {
    const config = requireConfig();
    const claimed = await ctx.runMutation(internal.integrations.github.setup.claimSetup, { state: args.state });
    const accessToken = await exchangeCode(config, args.code);
    await ctx.runMutation(internal.integrations.github.setup.authorizeSetup, {
      setupId: claimed.setupId,
      encryptedToken: await encryptToken(config, accessToken),
    });
    return claimed;
  },
});

async function userToken(ctx: ActionCtx, config: GithubAppConfig, setupId: Id<"integrationSetups">): Promise<string> {
  const setup = await ctx.runQuery(internal.integrations.github.setup.getAuthorizedSetup, { setupId });
  return decryptToken(config, setup.encryptedToken);
}

const candidateValidator = v.object({
  providerRepositoryId: v.number(),
  fullName: v.string(),
  isPrivate: v.boolean(),
  isAdmin: v.boolean(),
});

const candidatePageValidator = v.object({ repositories: v.array(candidateValidator), nextCursor: v.union(v.string(), v.null()) });

/** Repositories the admin's GitHub account reaches through App installations, one page at a time. */
export const listSetupRepositories = action({
  args: { setupId: v.id("integrationSetups"), cursor: v.optional(v.string()) },
  returns: candidatePageValidator,
  handler: async (ctx, args): Promise<Infer<typeof candidatePageValidator>> => {
    const config = requireConfig();
    const token = await userToken(ctx, config, args.setupId);
    return listInstallationRepositories(token, args.cursor).catch((error: unknown) => {
      throw toUserError(error);
    });
  },
});

async function listInstallationRepositories(token: string, cursor: string | undefined) {
  const match = /^(\d+):(\d+)$/.exec(cursor ?? "0:1");
  if (!match) throw new ConvexError(errors.CURSOR_INVALID);
  const [index, page] = [Number(match[1]), Number(match[2])];
  const installations = await listUserInstallationIds(token);
  const installationId = installations[index];
  if (installationId === undefined) {
    return { repositories: [], nextCursor: null };
  }
  const body = record(
    await githubFetch(`/user/installations/${installationId}/repositories?per_page=${PAGE_SIZE}&page=${page}`, { token })
  );
  const repositories = list(body.repositories).map((raw) => {
    const repo = record(raw);
    return {
      providerRepositoryId: num(repo.id),
      fullName: str(repo.full_name),
      isPrivate: repo.private === true,
      isAdmin: record(repo.permissions ?? {}).admin === true,
    };
  });
  const nextCursor =
    page * PAGE_SIZE < num(body.total_count) ? `${index}:${page + 1}` : index + 1 < installations.length ? `${index + 1}:1` : null;
  return { repositories, nextCursor };
}

async function listUserInstallationIds(token: string): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; ; page++) {
    const body = record(await githubFetch(`/user/installations?per_page=100&page=${page}`, { token }));
    const installations = list(body.installations).map((raw) => num(record(raw).id));
    ids.push(...installations);
    if (installations.length < 100) return ids;
  }
}

/**
 * Save the project's repository selection: re-verify GitHub admin permission
 * and App coverage of each repository to connect, then connect them and
 * disconnect `removeRepositoryLinkIds` in one transaction, all or none.
 */
export const saveRepositories = action({
  args: {
    setupId: v.id("integrationSetups"),
    providerRepositoryIds: v.array(v.number()),
    removeRepositoryLinkIds: v.array(v.id("integrationRepositoryLinks")),
  },
  returns: v.array(v.id("integrationRepositoryLinks")),
  handler: async (ctx, args): Promise<Id<"integrationRepositoryLinks">[]> => {
    const config = requireConfig();
    if (args.providerRepositoryIds.length > MAX_PROJECT_REPOSITORIES) throw new ConvexError(errors.TOO_MANY_REPOSITORIES);
    const token = await userToken(ctx, config, args.setupId);
    const repositories = [];
    for (const providerRepositoryId of new Set(args.providerRepositoryIds)) {
      repositories.push(
        await verifyRepository(config, token, providerRepositoryId).catch((error: unknown) => {
          throw toUserError(error);
        })
      );
    }
    return ctx.runMutation(internal.integrations.github.setup.applyRepositories, {
      setupId: args.setupId,
      repositories,
      removeRepositoryLinkIds: args.removeRepositoryLinkIds,
    });
  },
});

async function verifyRepository(config: GithubAppConfig, token: string, providerRepositoryId: number) {
  const repo = record(
    await githubFetch(`/repositories/${providerRepositoryId}`, { token }).catch((error: unknown) => {
      throw error instanceof GithubError && error.status === 404 ? new ConvexError(errors.REPOSITORY_NOT_INSTALLED) : error;
    })
  );
  if (record(repo.permissions ?? {}).admin !== true) {
    throw new ConvexError(errors.REPOSITORY_ADMIN_REQUIRED);
  }
  const owner = str(record(repo.owner).login);
  const name = str(repo.name);
  const installation = record(
    await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`, {
      appJwt: await createAppJwt(config),
    }).catch((error: unknown) => {
      throw error instanceof GithubError && error.status === 404 ? new ConvexError(errors.REPOSITORY_NOT_INSTALLED) : error;
    })
  );
  const installationId = num(installation.id);
  await mintRepositoryToken(config, installationId, providerRepositoryId).catch((error: unknown) => {
    throw error instanceof GithubError && (error.status === 404 || error.status === 422)
      ? new ConvexError(errors.REPOSITORY_NOT_INSTALLED)
      : error;
  });
  return {
    providerRepositoryId,
    owner,
    name,
    isPrivate: repo.private === true,
    htmlUrl: str(repo.html_url),
    installationId,
    accountLogin: str(record(installation.account).login),
  };
}

