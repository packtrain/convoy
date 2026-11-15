import { internalQuery, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser, getOptionalAuthenticatedAccess, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { apiKeyScopeAllowsOrganization, requireOrgPermission } from "../lib/access/permissions";
import { OrgRole } from "../../lib/authz/roles";
import { OrgPermission } from "../../lib/authz/permissions";
import { organizationValidator, organizationWithRoleValidator } from "./lib/validators";
import {
  getActiveOrganizationById,
  getActiveOrganizationsByIds,
  getOrganizationById,
  getOrganizationBySlug,
  insertOrganization,
  normalizeOrganizationId,
  updateOrganization,
  type OrganizationUpdatePatch,
} from "./lib/organizationsRepo";
import { getMembership, insertMembership, listMembershipsForUser } from "./lib/membersRepo";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { buildPatch, mapDefined } from "../lib/shared/patch";
import { errors } from "./errors";

/**
 * The caller's organizations. API-key callers see the same memberships,
 * narrowed by key scope, so an organization owning no accessible project is
 * still discoverable (`convoy orgs list`) and not only nameable
 * (`getByRef`).
 */
export const listForUser = query({
  args: { apiKey: v.optional(v.string()) },
  returns: v.array(organizationWithRoleValidator),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return [];
    }
    const { user, principal } = auth;

    const memberships = await listMembershipsForUser(ctx, user._id);
    const allowed = memberships.filter((membership) =>
      apiKeyScopeAllowsOrganization(principal.apiKeyScope, membership.organizationId)
    );

    return join(allowed)
      .on((membership) => membership.organizationId)
      .with((ids) => getActiveOrganizationsByIds(ctx, ids))
      .select((membership, org) => ({
        ...org,
        role: membership.role,
      }));
  },
});

export const getById = query({
  args: { id: v.string() },
  returns: v.union(organizationValidator, v.null()),
  handler: async (ctx, args) => {
    // Validate and normalize the ID - returns null if invalid
    const orgId = normalizeOrganizationId(ctx, args.id);
    if (!orgId) {
      return null;
    }

    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return null;
    }

    const membership = await getMembership(ctx, orgId, user._id);
    if (!membership) {
      return null;
    }

    return getActiveOrganizationById(ctx, orgId);
  },
});

/**
 * Internal variant without an authenticated-member requirement; used by
 * server-side callers (e.g. MCP handlers) that authorize separately.
 */
export const getByIdInternal = internalQuery({
  args: { id: v.string() },
  returns: v.union(organizationValidator, v.null()),
  handler: async (ctx, args) => {
    const organizationId = normalizeOrganizationId(ctx, args.id);
    if (!organizationId) {
      return null;
    }

    return getActiveOrganizationById(ctx, organizationId);
  },
});

export const getBySlug = query({
  args: { slug: v.string(), apiKey: v.optional(v.string()) },
  returns: v.union(organizationValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }
    const { user, principal } = auth;

    const org = await getOrganizationBySlug(ctx, args.slug);
    if (!org || org.isDeleted) {
      return null;
    }

    if (!apiKeyScopeAllowsOrganization(principal.apiKeyScope, org._id)) {
      return null;
    }

    const membership = await getMembership(ctx, org._id, user._id);
    if (!membership) {
      return null;
    }

    return org;
  },
});

/**
 * Slug-or-ID lookup for API-key callers (MCP's `organization`, the CLI's `--org`).
 * Neither form is distinguishable by shape — a slug like `acme` looks exactly like a
 * Convex ID — so one query tries both. It is also the only key-aware way to name an
 * organization owning no accessible project. Visibility matches `getBySlug`.
 */
export const getByRef = query({
  args: { ref: v.string(), apiKey: v.optional(v.string()) },
  returns: v.union(organizationValidator, v.null()),
  handler: async (ctx, args) => {
    const auth = await getOptionalAuthenticatedAccess(ctx, args.apiKey);
    if (!auth) {
      return null;
    }
    const { user, principal } = auth;

    const bySlug = await getOrganizationBySlug(ctx, args.ref);
    const organizationId = bySlug && !bySlug.isDeleted ? bySlug._id : normalizeOrganizationId(ctx, args.ref);
    if (!organizationId) {
      return null;
    }

    const org = await getActiveOrganizationById(ctx, organizationId);
    if (!org || !apiKeyScopeAllowsOrganization(principal.apiKeyScope, org._id)) {
      return null;
    }

    const membership = await getMembership(ctx, org._id, user._id);
    if (!membership) {
      return null;
    }

    return org;
  },
});

export const checkSlugAvailability = query({
  args: { slug: v.string() },
  returns: v.object({ available: v.boolean() }),
  handler: async (ctx, args) => {
    // Availability is blocked by any existing slug, including soft-deleted
    // organizations (matching create's uniqueness behavior).
    const existingOrg = await getOrganizationBySlug(ctx, args.slug);
    return { available: !existingOrg };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    color: v.optional(v.string()),
  },
  returns: v.id("organizations"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    await ensure(getOrganizationBySlug(ctx, args.slug)).isNull(errors.ORG_SLUG_TAKEN);

    const orgId = await insertOrganization(
      ctx,
      { name: args.name, slug: args.slug, color: args.color },
      user._id
    );

    // Add creator as owner
    await insertMembership(ctx, orgId, user._id, OrgRole.OWNER);

    return orgId;
  },
});

/**
 * Update organization settings
 */
export const update = mutation({
  args: {
    id: v.id("organizations"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    color: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const org = await ensure(getOrganizationById(ctx, args.id)).active(errors.ORG_NOT_FOUND, errors.ORG_DELETED);

    // Permission check
    await requireOrgPermission(ctx, user._id, args.id, OrgPermission.ORG_UPDATE);

    // Only provided fields end up in the patch (updatedAt is stamped by the repo)
    const updates = buildPatch<OrganizationUpdatePatch>({
      name: mapDefined(args.name, (name) => {
        const trimmedName = name.trim();
        ensure(trimmedName.length).gte(2, errors.ORG_NAME_TOO_SHORT);
        return trimmedName;
      }),
      // A null avatarUrl currently leaves the field unchanged (clearing it
      // would need an explicit-undefined patch, which the repo doesn't do).
      avatarUrl: args.avatarUrl ?? undefined,
      // Color keeps null in the patch: the repo clears the field for null.
      color: args.color,
    });

    // Slug validation needs an async uniqueness check, so it stays outside
    // the patch literal
    if (args.slug !== undefined) {
      const trimmedSlug = args.slug.trim().toLowerCase();

      // Slug format validation
      ensure(trimmedSlug).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, errors.ORG_SLUG_INVALID);
      ensure(trimmedSlug.length).between(2, 50, errors.ORG_SLUG_LENGTH);

      // Check uniqueness (only if slug is changing). Unlike create, a slug
      // held only by a soft-deleted organization does not block updates.
      if (trimmedSlug !== org.slug) {
        await ensure(getOrganizationBySlug(ctx, trimmedSlug)).isNullOrDeleted(errors.ORG_URL_TAKEN);
      }

      updates.slug = trimmedSlug;
    }

    await updateOrganization(ctx, args.id, updates);

    return null;
  },
});
