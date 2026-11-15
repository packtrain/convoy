import { v } from "convex/values";
import { query, mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { authorizeProjectAccess, getAccessibleProjectsById, requireAuthorizedProject } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { getAuthenticatedAccess, getAuthenticatedUser } from "../lib/access/auth";
import {
  availableCliValidator,
  cliProfilePathEntryValidator,
  cliRuntimeSummaryValidator,
  toRuntimeSummaries,
} from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { ONLINE_THRESHOLD_MS, STREAM_PROFILE_DELETED_REASON } from "./lib/constants";
import { errors } from "./errors";
import { cliRuntimeCatalogValidator, toRuntimeCatalog } from "./lib/validators";
import { deleteRuntimeCatalogsByProfile, listRuntimeCatalogsByProjectAndUser } from "./lib/cliRuntimeCatalogsRepo";
import {
  findOrCreateProfile,
  getCliProfileById,
  listActiveProfilesByUser,
  listActiveProfilesByUserAndProject,
  mergeProfilePaths,
  setProfileName,
  setProfilePathsIfChanged,
  softDeleteCliProfile,
} from "./lib/cliProfilesRepo";
import {
  getLatestActiveSessionForProfile,
  listActiveSessionsByProfile,
  listRecentSessionsByProject,
  listRecentSessionsByUser,
  paginateSessionsByProfile,
} from "./lib/cliSessionsRepo";
import { disconnectSession } from "./lib/disconnectSession";
import { getActiveOrganizationsByIds } from "../organizations/lib/organizationsRepo";

const PROFILE_SESSION_CLEANUP_BATCH_SIZE = 100;

// Validator for a single path entry (shared contract includes worktree fields)
const pathEntryValidator = cliProfilePathEntryValidator;

// Return validator for a single profile with online status
const cliProfileItemValidator = v.object({
  _id: v.id("cliProfiles"),
  name: v.string(),
  profileKey: v.optional(v.string()),
  hostname: v.optional(v.string()),
  paths: v.array(pathEntryValidator),
  createdAt: v.number(),
  lastConnectedAt: v.optional(v.number()),
  isOnline: v.boolean(),
  sessionStartedAt: v.optional(v.number()),
  availableClis: v.array(availableCliValidator),
  // @useconvoy/cli version reported by the online session, if any.
  appVersion: v.optional(v.string()),
});

const userProfileItemValidator = v.object({
  _id: v.id("cliProfiles"),
  name: v.string(),
  profileKey: v.optional(v.string()),
  hostname: v.optional(v.string()),
  paths: v.array(pathEntryValidator),
  createdAt: v.number(),
  lastConnectedAt: v.optional(v.number()),
  isOnline: v.boolean(),
  sessionStartedAt: v.optional(v.number()),
  appVersion: v.optional(v.string()),
  runtimes: v.array(cliRuntimeSummaryValidator),
  project: v.optional(
    v.object({
      _id: v.id("projects"),
      name: v.string(),
      alias: v.string(),
      isArchived: v.boolean(),
    })
  ),
  organization: v.optional(
    v.object({
      _id: v.id("organizations"),
      name: v.string(),
      slug: v.string(),
      avatarUrl: v.optional(v.string()),
      color: v.optional(v.string()),
    })
  ),
});

// Return validator for syncPaths
const syncPathsResultValidator = v.array(
  v.object({
    id: v.string(),
    path: v.string(),
  })
);

/** A profile the caller owns and that is still active, else a thrown guard. */
async function requireOwnedActiveProfile(ctx: MutationCtx, profileId: Id<"cliProfiles">, userId: Id<"users">): Promise<Doc<"cliProfiles">> {
  const profile = await ensure(getCliProfileById(ctx, profileId)).notDeleted(errors.PROFILE_NOT_FOUND);
  ensure(profile.userId).eq(userId, errors.PROFILE_NOT_AUTHORIZED);
  return profile;
}

/**
 * Disconnect every session for a profile in the provided page: reconcile any
 * thread claims, then delete the session row.
 */
async function disconnectSessions(ctx: MutationCtx, sessions: Doc<"cliSessions">[]): Promise<void> {
  for (const session of sessions) {
    await disconnectSession(ctx, session._id, STREAM_PROFILE_DELETED_REASON);
  }
}

/**
 * Find an existing profile or create a new one.
 * Called from registration when CLI connects.
 * Profile identity is: userId + projectId + profileKey (one profile per combination)
 * Hostname and lastConnectedAt are updated on each connection.
 * Paths are managed separately via syncPaths.
 */
export const findOrCreate = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    hostname: v.optional(v.string()),
    name: v.optional(v.string()),
    profileKey: v.optional(v.string()),
  },
  returns: v.id("cliProfiles"),
  handler: async (ctx, args) => {
    await requireAuthorizedProject(ctx, args.userId, args.projectId, ProjectPermission.TASK_VIEW);

    const profileId = await findOrCreateProfile(ctx, {
      userId: args.userId,
      projectId: args.projectId,
      profileKey: args.profileKey,
      hostname: args.hostname,
      name: args.name,
    });
    return profileId;
  },
});

/**
 * Bulk-sync paths from CLI.
 * Upserts new paths (matched by path string), updates existing ones,
 * and removes paths not in the incoming list.
 * Returns the full list of { id, path } so CLI can store the mapping.
 */
export const syncPaths = internalMutation({
  args: {
    profileId: v.id("cliProfiles"),
    paths: v.array(
      v.object({
        path: v.string(),
        label: v.optional(v.string()),
        gitRemoteUrl: v.optional(v.string()),
      })
    ),
  },
  returns: syncPathsResultValidator,
  handler: async (ctx, args) => {
    const profile = await ensure(getCliProfileById(ctx, args.profileId)).notDeleted(errors.PROFILE_NOT_FOUND);

    const newPaths = mergeProfilePaths(profile.paths, args.paths);
    await setProfilePathsIfChanged(ctx, profile, newPaths);

    return newPaths.map((p) => ({ id: p.id, path: p.path }));
  },
});

/**
 * Get a single profile by ID.
 */
export const get = query({
  args: {
    profileId: v.id("cliProfiles"),
  },
  returns: v.union(cliProfileItemValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const profile = await getCliProfileById(ctx, args.profileId);
    if (!profile) {
      return null;
    }

    // Out of reach reads as missing, so a stale subscription is not an error.
    const access = await authorizeProjectAccess(ctx, user._id, profile.projectId, ProjectPermission.TASK_VIEW);
    if (!access || profile.isDeleted) {
      return null;
    }

    // Get online status from the freshest active session.
    const session = await getLatestActiveSessionForProfile(ctx, profile._id, Date.now() - ONLINE_THRESHOLD_MS);

    return {
      _id: profile._id,
      name: profile.name,
      profileKey: profile.profileKey,
      hostname: profile.hostname,
      paths: profile.paths,
      createdAt: profile.createdAt,
      lastConnectedAt: profile.lastConnectedAt,
      isOnline: session !== null,
      sessionStartedAt: session?.startedAt,
      availableClis: session?.availableClis ?? profile.lastKnownClis ?? [],
      appVersion: session?.appVersion,
    };
  },
});

/**
 * List profiles for a project with online status.
 *
 * `apiKey` opens this to MCP/CLI callers (OS-1162); the MCP handler summarizes the
 * runtimes it returns rather than handing an agent every model catalog.
 */
export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliProfileItemValidator),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);

    // Check project access
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.TASK_VIEW);

    const profiles = await listActiveProfilesByUserAndProject(ctx, user._id, args.projectId);

    // Fetch all online sessions for this project once, then map by profileId.
    const onlineSessions = await listRecentSessionsByProject(ctx, args.projectId, Date.now() - ONLINE_THRESHOLD_MS);
    const bestSessionByProfileId = new Map<Id<"cliProfiles">, Doc<"cliSessions">>();
    for (const session of onlineSessions) {
      // First one wins because the query ordered desc by lastHeartbeatAt.
      if (!bestSessionByProfileId.has(session.profileId)) {
        bestSessionByProfileId.set(session.profileId, session);
      }
    }

    return profiles.map((profile) => {
      const session = bestSessionByProfileId.get(profile._id);
      return {
        _id: profile._id,
        name: profile.name,
        profileKey: profile.profileKey,
        hostname: profile.hostname,
        paths: profile.paths,
        createdAt: profile.createdAt,
        lastConnectedAt: profile.lastConnectedAt,
        isOnline: Boolean(session),
        sessionStartedAt: session?.startedAt,
        availableClis: session?.availableClis ?? profile.lastKnownClis ?? [],
        appVersion: session?.appVersion,
      };
    });
  },
});

/**
 * Advertised model catalogs for the caller's profiles in a project — its own
 * subscription so the profile lists stop carrying them (OS-1721). Project-scoped
 * rather than by profile id: the ids are denormalized onto the row, so this reads
 * one index range and no profile document.
 */
export const listRuntimeCatalogs = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(cliRuntimeCatalogValidator),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.TASK_VIEW);

    const catalogs = await listRuntimeCatalogsByProjectAndUser(ctx, {
      projectId: args.projectId,
      userId: user._id,
    });
    return catalogs.map(toRuntimeCatalog);
  },
});

/** List every active profile owned by the current user across projects. */
export const listForUser = query({
  args: {},
  returns: v.array(userProfileItemValidator),
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    const profiles = await listActiveProfilesByUser(ctx, user._id);
    const onlineSessions = await listRecentSessionsByUser(ctx, user._id, Date.now() - ONLINE_THRESHOLD_MS);

    const bestSessionByProfileId = new Map<Id<"cliProfiles">, Doc<"cliSessions">>();
    for (const session of onlineSessions) {
      if (!bestSessionByProfileId.has(session.profileId)) {
        bestSessionByProfileId.set(session.profileId, session);
      }
    }

    const uniqueProjectIds = [...new Set(profiles.map((profile) => profile.projectId))];
    const projectsById = await getAccessibleProjectsById(ctx, user._id, uniqueProjectIds, ProjectPermission.PROJECT_VIEW);
    const uniqueOrganizationIds = [...new Set([...projectsById.values()].map((project) => project.organizationId))];
    const organizations = await getActiveOrganizationsByIds(ctx, uniqueOrganizationIds);
    const organizationsById = new Map(
      organizations.filter((organization) => organization !== null).map((organization) => [organization._id, organization])
    );

    return profiles.map((profile) => {
      const session = bestSessionByProfileId.get(profile._id);
      const runtimes = session?.availableClis ?? profile.lastKnownClis ?? [];
      const project = projectsById.get(profile.projectId);
      const organization = project ? organizationsById.get(project.organizationId) : undefined;
      const hasLocation = project !== undefined && organization !== undefined;

      return {
        _id: profile._id,
        name: profile.name,
        profileKey: profile.profileKey,
        hostname: profile.hostname,
        paths: profile.paths,
        createdAt: profile.createdAt,
        lastConnectedAt: profile.lastConnectedAt,
        isOnline: Boolean(session),
        sessionStartedAt: session?.startedAt,
        appVersion: session?.appVersion,
        runtimes: toRuntimeSummaries(runtimes),
        project: hasLocation
          ? {
              _id: project._id,
              name: project.name,
              alias: project.alias,
              isArchived: project.isArchived,
            }
          : undefined,
        organization: hasLocation
          ? {
              _id: organization._id,
              name: organization.name,
              slug: organization.slug,
              avatarUrl: organization.avatarUrl,
              color: organization.color,
            }
          : undefined,
      };
    });
  },
});

/**
 * Rename a profile.
 * User can rename their own profiles.
 */
export const rename = mutation({
  args: {
    profileId: v.id("cliProfiles"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const profile = await requireOwnedActiveProfile(ctx, args.profileId, user._id);

    const normalizedName = args.name.trim();
    if (normalizedName.length > 0) {
      await setProfileName(ctx, profile._id, normalizedName);
      return null;
    }

    const fallbackName = profile.hostname?.trim() || profile.profileKey?.trim();
    const resolvedName = await ensure(fallbackName).notNull(errors.PROFILE_RENAME_NO_FALLBACK);

    await setProfileName(ctx, profile._id, resolvedName);
    return null;
  },
});

export const cleanupDeletedProfileSessions = internalMutation({
  args: {
    profileId: v.id("cliProfiles"),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Delete historical sessions in small batches so profile removal stays bounded.
    const page = await paginateSessionsByProfile(ctx, args.profileId, {
      cursor: args.cursor ?? null,
      numItems: PROFILE_SESSION_CLEANUP_BATCH_SIZE,
    });

    await disconnectSessions(ctx, page.page);

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.cli.profiles.cleanupDeletedProfileSessions, {
        profileId: args.profileId,
        cursor: page.continueCursor,
      });
    }

    return null;
  },
});

/**
 * Soft-delete a profile and disconnect any live sessions for it.
 */
export const remove = mutation({
  args: {
    profileId: v.id("cliProfiles"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const profile = await requireOwnedActiveProfile(ctx, args.profileId, user._id);

    const sessions = await listActiveSessionsByProfile(ctx, profile._id, Date.now() - ONLINE_THRESHOLD_MS);
    await disconnectSessions(ctx, sessions);

    await deleteRuntimeCatalogsByProfile(ctx, profile._id);
    await softDeleteCliProfile(ctx, profile._id, user._id);

    await ctx.scheduler.runAfter(0, internal.cli.profiles.cleanupDeletedProfileSessions, {
      profileId: profile._id,
    });

    return null;
  },
});
