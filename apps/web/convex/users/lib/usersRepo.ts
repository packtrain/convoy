import type { UserIdentity } from "convex/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function getUserById(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"users"> | null> {
  return ctx.db.get("users", userId);
}

export async function getUsersByIds(
  ctx: Ctx,
  userIds: Id<"users">[]
): Promise<(Doc<"users"> | null)[]> {
  return Promise.all(userIds.map((userId) => getUserById(ctx, userId)));
}

/** Every user with this address: two can share one after an auth-mode switch (auth-adapters.md). Unbounded so a membership check misses none. */
export async function listUsersByEmail(
  ctx: Ctx,
  email: string
): Promise<Doc<"users">[]> {
  return ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
}

export async function getUserByTokenIdentifier(
  ctx: Ctx,
  tokenIdentifier: string
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

/** Patch profile fields, stamping `updatedAt`. */
export async function updateUserProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  patch: { name?: string; email?: string; avatarUrl?: string; emailVerifiedAt?: number }
): Promise<void> {
  await ctx.db.patch("users", userId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

/** Row of the removed demo mode, and its marker while `auth.claimDemoUser` runs (docs/specs/auth-adapters.md#former-demo-installs). */
export const DEMO_USER_TOKEN_IDENTIFIER = "local-demo|user";
export const CLAIMING_DEMO_USER_TOKEN_IDENTIFIER = "local-demo|claiming";

/** Set or, with `undefined`, drop the row's `tokenIdentifier`. */
export async function setUserTokenIdentifier(
  ctx: MutationCtx,
  userId: Id<"users">,
  tokenIdentifier: string | undefined
): Promise<void> {
  await ctx.db.patch("users", userId, { tokenIdentifier, updatedAt: Date.now() });
}

/** Insert a Convex Auth user row, which has no JWT `tokenIdentifier`. */
export async function insertUser(
  ctx: MutationCtx,
  fields: { email: string; name: string; avatarUrl?: string; emailVerifiedAt?: number }
): Promise<Doc<"users">> {
  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    ...fields,
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get("users", userId);
  if (!user) {
    throw new Error("Failed to load user after insert");
  }
  return user;
}

/**
 * Upsert the user row for an authenticated identity: creates it on first
 * sign-in (with identity fallbacks), refreshes name/email/avatar when the
 * identity's values changed, and leaves it untouched otherwise.
 */
export async function upsertUserFromIdentity(
  ctx: MutationCtx,
  identity: UserIdentity
): Promise<{ user: Doc<"users">; isNewUser: boolean }> {
  const existingUser = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier);

  if (existingUser) {
    if (
      existingUser.name !== identity.name ||
      existingUser.email !== identity.email ||
      existingUser.avatarUrl !== identity.pictureUrl
    ) {
      await ctx.db.patch("users", existingUser._id, {
        name: identity.name ?? existingUser.name,
        email: identity.email ?? existingUser.email,
        avatarUrl: identity.pictureUrl,
        updatedAt: Date.now(),
      });
      const refreshed = await ctx.db.get("users", existingUser._id);
      return { user: refreshed ?? existingUser, isNewUser: false };
    }
    return { user: existingUser, isNewUser: false };
  }

  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email ?? "",
    name: identity.name ?? "Anonymous",
    avatarUrl: identity.pictureUrl,
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get("users", userId);
  if (!user) {
    throw new Error("Failed to load user after insert");
  }
  return { user, isNewUser: true };
}
