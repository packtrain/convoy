import { internalMutation, mutation, query, type MutationCtx } from "../_generated/server";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  getAuthenticatedUser,
  getOptionalAuthenticatedUser,
  isConvexAuthDeployment,
  isConvexAuthIdentity,
  isEmailVerificationOff,
  resolveIdentityUser,
} from "../lib/access/auth";
import { normalizeEmail } from "../lib/shared/strings";
import { authMethodValidator, emailPasswordMethodValidator } from "./lib/validators";
import { getLocalDemoUser, isLocalDemoDeployment, LOCAL_DEMO_TOKEN_IDENTIFIER, LOCAL_DEMO_USER_EMAIL, LOCAL_DEMO_USER_NAME } from "../lib/access/localDemo";
import { OrgRole, ProjectRole } from "../../lib/authz/roles";
import { getOrganizationById, getOrganizationBySlug, insertOrganization } from "../organizations/lib/organizationsRepo";
import {
  insertMembership as insertOrgMembership,
  listMembershipsForUser as listOrgMembershipsForUser,
} from "../organizations/lib/membersRepo";
import { insertProject, initializeProjectLists } from "../projects/lib/projectsRepo";
import { insertMembership as insertProjectMembership } from "../projects/lib/membersRepo";
import { createInboxList } from "../tasks/lib/taskListsRepo";
import {
  getUserById,
  getUserByTokenIdentifier,
  insertUser,
  listUsersByEmail,
  updateUserProfile,
  upsertUserFromIdentity,
} from "./lib/usersRepo";
import { notAuthenticatedError } from "./errors";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateRandomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * The caller's user row. Clerk identities are upserted from their claims; a Convex
 * Auth user already exists, created by `createAuthUser` at sign-up.
 */
async function ensureIdentityUser(
  ctx: MutationCtx,
  identity: UserIdentity
): Promise<{ user: Doc<"users">; isNewUser: boolean }> {
  if (!isConvexAuthIdentity(identity)) {
    return upsertUserFromIdentity(ctx, identity);
  }
  const user = await resolveIdentityUser(ctx, identity);
  if (!user) {
    throw notAuthenticatedError();
  }
  return { user, isNewUser: false };
}

export const store = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw notAuthenticatedError();
    }

    const { user } = await ensureIdentityUser(ctx, identity);
    return user._id;
  },
});

const onboardResultValidator = v.object({
  organizationId: v.id("organizations"),
  organizationSlug: v.string(),
  isNewUser: v.boolean(),
});

/**
 * Land the user in their first organization, creating a default workspace
 * with a starter project on first onboarding. Shared by Clerk onboarding
 * and local-demo bootstrap.
 */
async function onboardUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  userName: string,
  isNewUser: boolean
): Promise<{ organizationId: Id<"organizations">; organizationSlug: string; isNewUser: boolean }> {
  // Returning users land in their first organization
  const memberships = await listOrgMembershipsForUser(ctx, userId);
  if (memberships.length > 0) {
    const firstOrg = await getOrganizationById(ctx, memberships[0].organizationId);
    if (!firstOrg) {
      throw new Error("Organization not found for existing membership");
    }
    return { organizationId: firstOrg._id, organizationSlug: firstOrg.slug, isNewUser };
  }

  const baseSlug = generateSlug(userName);

  let orgSlug: string;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    orgSlug = `${baseSlug}-${generateRandomSuffix()}`;
    const existingOrg = await getOrganizationBySlug(ctx, orgSlug);
    if (!existingOrg) break;
    attempts++;
  } while (attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    throw new Error("Failed to generate unique organization slug");
  }

  const orgId = await insertOrganization(ctx, { name: `${userName}'s Workspace`, slug: orgSlug }, userId);
  await insertOrgMembership(ctx, orgId, userId, OrgRole.OWNER);

  const projectId = await insertProject(ctx, { organizationId: orgId, name: "My First Project", alias: "MFP" }, userId);

  // Every project owns a persisted default "Inbox" List (OS-842).
  const inboxListId = await createInboxList(ctx, { projectId, userId });
  await initializeProjectLists(ctx, projectId, inboxListId, userId);

  await insertProjectMembership(ctx, projectId, userId, ProjectRole.PROJECT_ADMIN);

  return { organizationId: orgId, organizationSlug: orgSlug, isNewUser: true };
}

export const onboard = mutation({
  args: {},
  returns: onboardResultValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      // Local-demo has no JWT, and /auth/callback runs onboard in every mode.
      const demoUser = await getLocalDemoUser(ctx);
      if (!demoUser) {
        throw notAuthenticatedError();
      }
      return onboardUser(ctx, demoUser._id, demoUser.name, false);
    }

    const { user, isNewUser } = await ensureIdentityUser(ctx, identity);
    return onboardUser(ctx, user._id, user.name || "User", isNewUser);
  },
});

/**
 * Convex Auth `createUser`. Email sign-up runs before the address is known, so `onAuthSignIn`
 * fills it in. Google reuses a user by verified address (docs/specs/auth-adapters.md#google).
 */
export const createAuthUser = internalMutation({
  args: { method: authMethodValidator },
  returns: v.id("users"),
  handler: async (ctx, { method }) => {
    if (!isConvexAuthDeployment()) {
      throw new ConvexError("Convex Auth sign-up is not enabled on this deployment");
    }
    if (method.name === "emailPassword") {
      return (await insertUser(ctx, { email: "", name: "" }))._id;
    }
    const { profile } = method;
    const email = profile.emailVerified && profile.email ? normalizeEmail(profile.email) : "";
    if (email) {
      // Only a proven address: one registered with verification off may belong to someone else.
      const users = await listUsersByEmail(ctx, email);
      const existing = users.find((user) => user.tokenIdentifier === undefined && user.emailVerifiedAt !== undefined);
      if (existing) return existing._id;
    }
    const name = profile.name || email.split("@")[0] || "User";
    const emailVerifiedAt = email ? Date.now() : undefined;
    return (await insertUser(ctx, { email, name, avatarUrl: profile.picture, emailVerifiedAt }))._id;
  },
});

/**
 * Convex Auth `onSignIn`: copies the verified address into `users.email`, which member
 * lists and `by_email` read. The name defaults to the address's local part.
 */
export const onAuthSignIn = internalMutation({
  args: { method: emailPasswordMethodValidator, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await getUserById(ctx, userId);
    const verified = await ctx.runQuery(components.authEmail.verifiedEmails.getPrimaryEmail, { userId });
    const email = verified === null ? null : normalizeEmail(verified);
    if (!user || email === null || (email === user.email && user.name)) {
      return null;
    }
    const name = user.name || email.split("@")[0];
    if (email === user.email) {
      await updateUserProfile(ctx, userId, { name });
      return null;
    }
    // Proven only when written with verification on; turning it on later doesn't vouch for an older address.
    const emailVerifiedAt = isEmailVerificationOff() ? undefined : Date.now();
    await updateUserProfile(ctx, userId, { email, name, emailVerifiedAt });
    return null;
  },
});

/**
 * Local-demo bootstrap (OS-1230): idempotently create the synthetic demo
 * user and its starter workspace. Callable anonymously, but only on
 * deployments that explicitly set AUTH_MODE=local-demo.
 */
export const onboardLocalDemo = mutation({
  args: {},
  returns: onboardResultValidator,
  handler: async (ctx) => {
    if (!isLocalDemoDeployment()) {
      throw new ConvexError("Local demo mode is not enabled on this deployment");
    }

    let user = await getUserByTokenIdentifier(ctx, LOCAL_DEMO_TOKEN_IDENTIFIER);
    let isNewUser = false;
    if (!user) {
      user = await insertUser(ctx, {
        tokenIdentifier: LOCAL_DEMO_TOKEN_IDENTIFIER,
        email: LOCAL_DEMO_USER_EMAIL,
        name: LOCAL_DEMO_USER_NAME,
      });
      isNewUser = true;
    }

    return onboardUser(ctx, user._id, user.name, isNewUser);
  },
});

export const current = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      tokenIdentifier: v.optional(v.string()),
      email: v.string(),
      name: v.string(),
      avatarUrl: v.optional(v.string()),
      emailVerifiedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    return await getOptionalAuthenticatedUser(ctx);
  },
});

/**
 * Sync user profile from Clerk identity to Convex.
 * Call this after updating user profile in Clerk to ensure Convex stays in sync.
 * Identity-owned fields (email/avatarUrl) are always sourced from Clerk identity.
 */
export const syncProfile = mutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Resolves the Clerk identity's user, or the demo user in local-demo mode.
    const user = await getAuthenticatedUser(ctx);
    const identity = await ctx.auth.getUserIdentity();

    await updateUserProfile(ctx, user._id, {
      // Name may come from explicit input, but identity-owned fields never do.
      name: args.name ?? identity?.name ?? user.name,
      email: identity?.email ?? user.email,
      avatarUrl: identity?.pictureUrl ?? user.avatarUrl,
    });

    return null;
  },
});
