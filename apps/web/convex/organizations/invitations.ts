import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { isEmailSendingConfigured, sendTransactionalEmail } from "../lib/notifications/email";
import { getAuthenticatedUser, getIdentityEmail, getOptionalAuthenticatedUser } from "../lib/access/auth";
import { hasOrgPermission, requireOrgPermission } from "../lib/access/permissions";
import { OrgPermission } from "../../lib/authz/permissions";
import { InvitationStatus } from "../../lib/authz/roles";
import { buildOrganizationInvitationEmail, buildWelcomeOnboardingEmail } from "../../lib/emails/catalog";
import { buildInvitationUrl, buildOrganizationUrl } from "../../lib/emails/links";
import { invitationRoleValidator, invitationStatusValidator } from "../lib/contracts/validators";
import { invitationSummaryValidator } from "./lib/validators";
import { getActiveOrganizationById, getOrganizationById, requireActiveOrganization } from "./lib/organizationsRepo";
import { getMembership, insertMembership } from "./lib/membersRepo";
import { getUserById, getUsersByIds, listUsersByEmail } from "../users/lib/usersRepo";
import {
  extendInvitationExpiration,
  findPendingInvitation,
  getInvitationById,
  getInvitationByToken,
  insertInvitation,
  listPendingInvitations,
  setInvitationStatus,
} from "./lib/invitationsRepo";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { errors } from "./errors";
import { normalizeEmail } from "../lib/shared/strings";

const invitationTokenAccessValidator = v.union(
  v.object({
    access: v.literal("requires-authentication"),
  }),
  v.object({
    access: v.literal("unauthorized"),
  }),
  v.object({
    access: v.literal("authorized"),
    _id: v.id("organizationInvitations"),
    email: v.string(),
    role: invitationRoleValidator,
    status: invitationStatusValidator,
    expiresAt: v.number(),
    organizationName: v.string(),
    inviterName: v.union(v.string(), v.null()),
    isExpired: v.boolean(),
  }),
  v.null()
);

/**
 * Masks an email address for privacy (e.g., "john.doe@gmail.com" -> "j***e@g***l.com")
 */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***@***.***";

  const maskPart = (str: string): string => {
    if (str.length <= 2) return str[0] + "***";
    return str[0] + "***" + str[str.length - 1];
  };

  const domainParts = domain.split(".");
  const maskedDomainName = maskPart(domainParts[0] || "");
  const tld = domainParts.slice(1).join(".");

  return `${maskPart(localPart)}@${maskedDomainName}.${tld}`;
}

/**
 * Create a new invitation and send email
 */
export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: invitationRoleValidator,
  },
  returns: v.id("organizationInvitations"),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Permission check
    await requireOrgPermission(ctx, user._id, args.organizationId, OrgPermission.MEMBERS_INVITE);

    const org = await requireActiveOrganization(ctx, args.organizationId);

    // Normalize email
    const email = normalizeEmail(args.email);

    // Two users can share an address after an auth-mode switch; none may already be a member.
    for (const existingUser of await listUsersByEmail(ctx, email)) {
      await ensure(getMembership(ctx, args.organizationId, existingUser._id)).isNull(errors.USER_ALREADY_MEMBER);
    }

    // Check for existing pending invitation using index
    await ensure(findPendingInvitation(ctx, args.organizationId, email)).isNull(errors.INVITATION_ALREADY_PENDING);

    // Generate token and expiration
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    const invitationId = await insertInvitation(ctx, {
      organizationId: args.organizationId,
      email,
      role: args.role,
      token,
      expiresAt,
      invitedBy: user._id,
    });

    await sendTransactionalEmail(ctx, {
      to: email,
      template: buildOrganizationInvitationEmail({
        organizationName: org.name,
        inviterName: user.name || user.email || "Someone",
        inviteUrl: buildInvitationUrl(token),
        role: args.role,
      }),
    });

    return invitationId;
  },
});

/**
 * Resend invitation email for a pending invitation
 */
export const resend = mutation({
  args: {
    organizationInvitationId: v.id("organizationInvitations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const invitation = await ensure(getInvitationById(ctx, args.organizationInvitationId)).notNull(errors.INVITATION_NOT_FOUND);
    ensure(invitation.status).eq(InvitationStatus.PENDING, errors.INVITATION_RESEND_REQUIRES_PENDING);

    // Permission check
    await requireOrgPermission(ctx, user._id, invitation.organizationId, OrgPermission.MEMBERS_INVITE);

    const org = await requireActiveOrganization(ctx, invitation.organizationId);

    // Update expiration
    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await extendInvitationExpiration(ctx, args.organizationInvitationId, newExpiresAt);

    const inviter = await getUserById(ctx, invitation.invitedBy);
    await sendTransactionalEmail(ctx, {
      to: invitation.email,
      template: buildOrganizationInvitationEmail({
        organizationName: org.name,
        inviterName: inviter?.name || inviter?.email || "Someone",
        inviteUrl: buildInvitationUrl(invitation.token),
        role: invitation.role,
      }),
    });

    return null;
  },
});

/**
 * Revoke a pending invitation
 */
export const revoke = mutation({
  args: {
    organizationInvitationId: v.id("organizationInvitations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const invitation = await ensure(getInvitationById(ctx, args.organizationInvitationId)).notNull(errors.INVITATION_NOT_FOUND);
    ensure(invitation.status).eq(InvitationStatus.PENDING, errors.INVITATION_REVOKE_REQUIRES_PENDING);

    await requireOrgPermission(ctx, user._id, invitation.organizationId, OrgPermission.MEMBERS_INVITE);
    await setInvitationStatus(ctx, args.organizationInvitationId, InvitationStatus.REVOKED);

    return null;
  },
});

/**
 * Accept an invitation via token
 */
export const accept = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    organizationId: v.id("organizations"),
    organizationSlug: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const identityEmail = await getIdentityEmail(ctx);

    ensure(identityEmail).notNull(errors.INVITATION_ACCOUNT_EMAIL_REQUIRED);

    const invitation = await ensure(getInvitationByToken(ctx, args.token)).notNull(errors.INVITATION_LINK_INVALID);

    ensure(identityEmail).eq(normalizeEmail(invitation.email), errors.INVITATION_UNAUTHORIZED);

    // Check status
    ensure(invitation.status).notEq(InvitationStatus.ACCEPTED, errors.INVITATION_ALREADY_ACCEPTED);
    ensure(invitation.status).notEq(InvitationStatus.REVOKED, errors.INVITATION_REVOKED);
    const invitationIsExpired = invitation.status === InvitationStatus.EXPIRED || invitation.expiresAt < Date.now();
    if (invitationIsExpired) {
      // Mark as expired if not already
      if (invitation.status !== InvitationStatus.EXPIRED) {
        await setInvitationStatus(ctx, invitation._id, InvitationStatus.EXPIRED);
      }
    }
    ensure(invitationIsExpired).isFalse(errors.INVITATION_EXPIRED);

    const existingMembership = await getMembership(ctx, invitation.organizationId, user._id);

    if (existingMembership) {
      // Mark invitation as accepted anyway
      await setInvitationStatus(ctx, invitation._id, InvitationStatus.ACCEPTED);
      const org = await getOrganizationById(ctx, invitation.organizationId);
      return {
        organizationId: invitation.organizationId,
        organizationSlug: org?.slug || "",
      };
    }

    const org = await ensure(getActiveOrganizationById(ctx, invitation.organizationId)).notNull(errors.ORG_NO_LONGER_EXISTS);

    await insertMembership(ctx, invitation.organizationId, user._id, invitation.role);
    await setInvitationStatus(ctx, invitation._id, InvitationStatus.ACCEPTED);

    await sendTransactionalEmail(ctx, {
      to: invitation.email,
      template: buildWelcomeOnboardingEmail({
        organizationName: org.name,
        workspaceUrl: buildOrganizationUrl(org.slug),
        role: invitation.role,
        inviterName: user.name,
      }),
    });

    return {
      organizationId: invitation.organizationId,
      organizationSlug: org.slug,
    };
  },
});

/**
 * List pending invitations for an organization
 */
export const listPending = query({
  args: {
    organizationId: v.id("organizations"),
  },
  returns: v.array(invitationSummaryValidator),
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return [];
    }

    // Only those who can invite can see pending invitations.
    const canInvite = await hasOrgPermission(ctx, user._id, args.organizationId, OrgPermission.MEMBERS_INVITE);
    if (!canInvite) {
      return [];
    }

    const invitations = await listPendingInvitations(ctx, args.organizationId);

    const shareLinks = !isEmailSendingConfigured();
    return join(invitations)
      .on((inv) => inv.invitedBy)
      .with((ids) => getUsersByIds(ctx, ids))
      .selectAll((inv, inviter) => ({
        _id: inv._id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        invitedBy: {
          _id: inv.invitedBy,
          name: inviter?.name || null,
          email: inviter?.email || null,
        },
        inviteUrl: shareLinks ? buildInvitationUrl(inv.token) : null,
      }));
  },
});

/**
 * Get invitation by token (for accept page)
 */
export const getByToken = query({
  args: {
    token: v.string(),
  },
  returns: invitationTokenAccessValidator,
  handler: async (ctx, args) => {
    const invitation = await getInvitationByToken(ctx, args.token);
    if (!invitation) {
      return null;
    }

    const identityEmail = await getIdentityEmail(ctx);
    if (!identityEmail) {
      return { access: "requires-authentication" as const };
    }

    const isEmailMatch = identityEmail === normalizeEmail(invitation.email);
    if (!isEmailMatch) {
      return { access: "unauthorized" as const };
    }

    const [org, inviter] = await Promise.all([
      getOrganizationById(ctx, invitation.organizationId),
      getUserById(ctx, invitation.invitedBy),
    ]);
    const isExpired = invitation.expiresAt < Date.now();

    return {
      access: "authorized" as const,
      _id: invitation._id,
      email: maskEmail(invitation.email),
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationName: org?.name || "Unknown Organization",
      inviterName: inviter?.name || inviter?.email || null,
      isExpired,
    };
  },
});
