import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../../lib/access/auth";
import { hasAuthorizedProjectPermission, requireAuthorizedProject } from "../../lib/access/permissions";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "./errors";
import { PAGE_SIZE, githubInstallUrl, readGithubAppConfig } from "./lib/constants";
import { integrationSetupStatusValidator } from "../../lib/contracts/integrations";
import { authorizeIntegrationProject } from "./lib/permissions";
import { connectionValidator, toConnection } from "./lib/validators";
import { disconnectLink } from "./lib/lifecycle";
import {
  deleteRepositoryLink,
  expireRepositoryLink,
  getRepositoryLinkById,
  hasOtherRepositoryLink,
  listActiveRepositoryLinksForOrganization,
  listActiveRepositoryLinksForProject,
  listRetainedRepositoryLinksForProject,
  paginateRepositoryLinksByProject,
} from "./lib/integrationRepositoryLinksRepo";
import { deleteRepository, getRepositoryById, updateRepositorySync } from "./lib/integrationRepositoriesRepo";
import { deletePullRequestsBatch } from "./lib/integrationPullRequestsRepo";
import { findSetupByIdString } from "./lib/integrationSetupsRepo";

// Project connection lifecycle (docs/specs/github-integration.md).

/** Retained links shown in settings, beside the active ones. */
const RETAINED_LINKS_SHOWN = 30;

export const get = query({
  // setupId comes from the URL, so it is any string until normalized.
  args: { projectId: v.id("projects"), setupId: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      configured: v.boolean(),
      installUrl: v.union(v.string(), v.null()),
      canManage: v.boolean(),
      /** Active links first, then retained ones, most recently disconnected first. */
      connections: v.array(connectionValidator),
      setup: v.union(
        v.object({ setupId: v.id("integrationSetups"), status: integrationSetupStatusValidator, expiresAt: v.number() }),
        v.null()
      ),
    })
  ),
  handler: async (ctx, args) => {
    const access = await authorizeIntegrationProject(ctx, args.projectId, ProjectPermission.PROJECT_VIEW);
    if (!access) {
      return null;
    }
    const config = readGithubAppConfig();
    const canManage = hasAuthorizedProjectPermission(access, ProjectPermission.PROJECT_UPDATE);
    const links = [
      ...(await listActiveRepositoryLinksForProject(ctx, args.projectId)),
      ...(await listRetainedRepositoryLinksForProject(ctx, args.projectId, RETAINED_LINKS_SHOWN)),
    ];
    const connections = [];
    for (const link of links) {
      const repository = await getRepositoryById(ctx, link.repositoryId);
      if (repository) connections.push(toConnection(link, repository));
    }
    const setup = args.setupId ? await findSetupByIdString(ctx, args.setupId) : null;
    const ownSetup = setup && setup.userId === access.userId && setup.projectId === args.projectId ? setup : null;
    return {
      configured: Boolean(config),
      installUrl: config ? githubInstallUrl(config) : null,
      canManage,
      connections,
      setup: ownSetup ? { setupId: ownSetup._id, status: ownSetup.status, expiresAt: ownSetup.expiresAt } : null,
    };
  },
});

/** Bounds the organization-wide PR link lookup; links past it fall back to GitHub. */
const LINK_TARGETS_LIMIT = 500;

/** Connected repositories in the caller's readable projects, so task and thread PR links can open Convoy's reader. */
export const listLinkTargets = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({ projectAlias: v.string(), repositoryId: v.id("integrationRepositories"), owner: v.string(), name: v.string() })
  ),
  handler: async (ctx, args) => {
    const links = await listActiveRepositoryLinksForOrganization(ctx, args.organizationId, LINK_TARGETS_LIMIT);
    const aliases = new Map<Id<"projects">, string | null>();
    const targets = [];
    for (const link of links) {
      if (!aliases.has(link.projectId)) {
        const access = await authorizeIntegrationProject(ctx, link.projectId, ProjectPermission.PROJECT_VIEW);
        aliases.set(link.projectId, access?.project.alias ?? null);
      }
      const projectAlias = aliases.get(link.projectId);
      const repository = projectAlias ? await getRepositoryById(ctx, link.repositoryId) : null;
      if (projectAlias && repository) {
        targets.push({ projectAlias, repositoryId: repository._id, owner: repository.owner, name: repository.name });
      }
    }
    return targets;
  },
});

export const disconnect = mutation({
  args: { projectId: v.id("projects"), repositoryLinkId: v.id("integrationRepositoryLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const link = await ensure(getRepositoryLinkById(ctx, args.repositoryLinkId)).notNull(errors.CONNECTION_NOT_FOUND);
    ensure(link.projectId).eq(args.projectId, errors.CONNECTION_NOT_FOUND);
    if (link.status === "active") {
      await disconnectLink(ctx, link);
    }
    return null;
  },
});

/** Delete now: purge a disconnected link's retained PRs instead of waiting out retention. */
export const deleteRetained = mutation({
  args: { projectId: v.id("projects"), repositoryLinkId: v.id("integrationRepositoryLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const link = await ensure(getRepositoryLinkById(ctx, args.repositoryLinkId)).notNull(errors.CONNECTION_NOT_FOUND);
    ensure(link.projectId).eq(args.projectId, errors.CONNECTION_NOT_FOUND);
    ensure(link.status).eq("disconnected", errors.STILL_CONNECTED);
    // A second click while the purge runs starts no second chain.
    if (link.deleteAfter !== undefined && link.deleteAfter <= Date.now()) {
      return null;
    }
    await expireRepositoryLink(ctx, link._id);
    await ctx.scheduler.runAfter(0, internal.integrations.github.core.purge, { repositoryLinkId: link._id, generation: link.generation });
    return null;
  },
});

/** Restart the import from its last page; an import already on its way is left alone. */
export const retrySync = mutation({
  args: { projectId: v.id("projects"), repositoryLinkId: v.id("integrationRepositoryLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    const link = await ensure(getRepositoryLinkById(ctx, args.repositoryLinkId)).notNull(errors.CONNECTION_NOT_FOUND);
    ensure(link.projectId).eq(args.projectId, errors.CONNECTION_NOT_FOUND);
    ensure(link.status).eq("active", errors.NOT_CONNECTED);
    const repository = await ensure(getRepositoryById(ctx, link.repositoryId)).notNull(errors.CONNECTION_NOT_FOUND);
    if (repository.syncStatus === "importing") {
      return null;
    }
    // A busy lease only queues this job; claimSync runs it once the lease frees.
    const page = repository.importPage ?? 1;
    await updateRepositorySync(ctx, repository._id, { syncStatus: "importing", importPage: page, error: undefined });
    await ctx.scheduler.runAfter(0, internal.integrations.github.sync.syncRepository, {
      repositoryId: repository._id,
      repositoryLinkId: link._id,
      generation: link.generation,
      target: { kind: "import", page },
    });
    return null;
  },
});

/** Project deletion: disconnect every link in batches. */
export const disconnectProject = internalMutation({
  args: { projectId: v.id("projects"), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await paginateRepositoryLinksByProject(ctx, args.projectId, {
      numItems: PAGE_SIZE,
      cursor: args.cursor ?? null,
    });
    for (const link of result.page) {
      if (link.status === "active") {
        await disconnectLink(ctx, link);
      }
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.integrations.github.core.disconnectProject, {
        projectId: args.projectId,
        cursor: result.continueCursor,
      });
    }
    return null;
  },
});

/** Called only after GitHub confirmed the access loss for this exact generation. */
export const revoke = internalMutation({
  args: { repositoryLinkId: v.id("integrationRepositoryLinks"), expectedGeneration: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await getRepositoryLinkById(ctx, args.repositoryLinkId);
    if (link && link.status === "active" && link.generation === args.expectedGeneration) {
      await disconnectLink(ctx, link, errors.ACCESS_REMOVED);
    }
    return null;
  },
});

/** Retention cleanup. A reconnect (new generation) or another project's link wins. */
export const purge = internalMutation({
  args: { repositoryLinkId: v.id("integrationRepositoryLinks"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await getRepositoryLinkById(ctx, args.repositoryLinkId);
    if (
      !link ||
      link.status !== "disconnected" ||
      link.generation !== args.generation ||
      link.deleteAfter === undefined ||
      link.deleteAfter > Date.now()
    ) {
      return null;
    }
    if (!(await hasOtherRepositoryLink(ctx, link.repositoryId, link._id))) {
      if ((await deletePullRequestsBatch(ctx, link.repositoryId, PAGE_SIZE)) === PAGE_SIZE) {
        // A reconnect between batches reuses the repository, so its next commit recounts the rows left,
        // and closed history starts over since the deleted rows no longer cover it.
        await updateRepositorySync(ctx, link.repositoryId, {
          openCount: undefined,
          closedCount: undefined,
          countedThroughNumber: undefined,
          history: undefined,
          historyRequest: undefined,
        });
        await ctx.scheduler.runAfter(0, internal.integrations.github.core.purge, args);
        return null;
      }
      await deleteRepository(ctx, link.repositoryId);
    }
    await deleteRepositoryLink(ctx, link._id);
    return null;
  },
});
