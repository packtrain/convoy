import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { InvitationStatus } from "../../../lib/authz/roles";

type Ctx = QueryCtx | MutationCtx;

export async function getInvitationById(
  ctx: Ctx,
  invitationId: Id<"organizationInvitations">
): Promise<Doc<"organizationInvitations"> | null> {
  return ctx.db.get("organizationInvitations", invitationId);
}

export async function getInvitationByToken(
  ctx: Ctx,
  token: string
): Promise<Doc<"organizationInvitations"> | null> {
  return ctx.db
    .query("organizationInvitations")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function findPendingInvitation(
  ctx: Ctx,
  organizationId: Id<"organizations">,
  email: string
): Promise<Doc<"organizationInvitations"> | null> {
  return ctx.db
    .query("organizationInvitations")
    .withIndex("by_org_and_status_and_email", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("status", InvitationStatus.PENDING)
        .eq("email", email)
    )
    .first();
}

export async function listPendingInvitations(
  ctx: Ctx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationInvitations">[]> {
  return ctx.db
    .query("organizationInvitations")
    .withIndex("by_org_and_status_and_email", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("status", InvitationStatus.PENDING)
    )
    .collect();
}

export async function insertInvitation(
  ctx: MutationCtx,
  invitation: {
    organizationId: Id<"organizations">;
    email: string;
    role: Doc<"organizationInvitations">["role"];
    token: string;
    expiresAt: number;
    invitedBy: Id<"users">;
  }
): Promise<Id<"organizationInvitations">> {
  return ctx.db.insert("organizationInvitations", {
    ...invitation,
    createdAt: Date.now(),
    status: InvitationStatus.PENDING,
  });
}

export async function setInvitationStatus(
  ctx: MutationCtx,
  invitationId: Id<"organizationInvitations">,
  status: Doc<"organizationInvitations">["status"]
): Promise<void> {
  await ctx.db.patch("organizationInvitations", invitationId, { status });
}

export async function extendInvitationExpiration(
  ctx: MutationCtx,
  invitationId: Id<"organizationInvitations">,
  expiresAt: number
): Promise<void> {
  await ctx.db.patch("organizationInvitations", invitationId, { expiresAt });
}
