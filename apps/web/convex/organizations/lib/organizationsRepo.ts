import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";

type Ctx = QueryCtx | MutationCtx;

export function normalizeOrganizationId(
  ctx: Ctx,
  id: string
): Id<"organizations"> | null {
  return ctx.db.normalizeId("organizations", id);
}

export async function getOrganizationById(
  ctx: Ctx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizations"> | null> {
  return ctx.db.get("organizations", organizationId);
}

export async function getActiveOrganizationById(
  ctx: Ctx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizations"> | null> {
  const organization = await ctx.db.get("organizations", organizationId);
  if (!organization || organization.isDeleted) {
    return null;
  }
  return organization;
}

export async function getOrganizationBySlug(
  ctx: Ctx,
  slug: string
): Promise<Doc<"organizations"> | null> {
  return ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export async function getActiveOrganizationBySlug(
  ctx: Ctx,
  slug: string
): Promise<Doc<"organizations"> | null> {
  const organization = await getOrganizationBySlug(ctx, slug);
  if (!organization || organization.isDeleted) {
    return null;
  }
  return organization;
}

export async function getActiveOrganizationsByIds(
  ctx: Ctx,
  organizationIds: Id<"organizations">[]
): Promise<(Doc<"organizations"> | null)[]> {
  return Promise.all(
    organizationIds.map((organizationId) =>
      getActiveOrganizationById(ctx, organizationId)
    )
  );
}

/**
 * Insert an organization, stamping `createdBy`, `createdAt`, `updatedAt`, and
 * `isDeleted: false`. Callers pass only the user-supplied props.
 */
export async function insertOrganization(
  ctx: MutationCtx,
  props: { name: string; slug: string; color?: string },
  createdBy: Id<"users">
): Promise<Id<"organizations">> {
  const now = Date.now();
  return ctx.db.insert("organizations", {
    ...props,
    createdBy,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  });
}

export type OrganizationUpdatePatch = {
  name?: string;
  slug?: string;
  avatarUrl?: string;
  color?: string | null;
};

/**
 * Patch organization settings, stamping `updatedAt`. A `color` of `null`
 * clears the field (Convex removes fields by patching them to `undefined`,
 * which requires a separate patch).
 */
export async function updateOrganization(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  updates: OrganizationUpdatePatch
): Promise<void> {
  const { color, ...fields } = updates;

  await ctx.db.patch("organizations", organizationId, {
    ...fields,
    ...(typeof color === "string" ? { color } : {}),
    updatedAt: Date.now(),
  });

  if (color === null) {
    await ctx.db.patch("organizations", organizationId, { color: undefined });
  }
}

export async function requireActiveOrganization(
  ctx: Ctx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizations">> {
  return ensure(getActiveOrganizationById(ctx, organizationId)).notNull(
    errors.ORG_NOT_FOUND
  );
}
