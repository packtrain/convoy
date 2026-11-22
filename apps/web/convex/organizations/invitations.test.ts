import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { sendTransactionalEmailMock } = vi.hoisted(() => ({
  sendTransactionalEmailMock: vi.fn(async () => null),
}));

vi.mock("../lib/notifications/email", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/notifications/email")>();

  return {
    ...actual,
    sendTransactionalEmail: sendTransactionalEmailMock,
  };
});

import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import { OrgRole, InvitationStatus } from "../../lib/authz/roles";

type TestConvex = ReturnType<typeof createTestContext>["t"];

/** Signs up through Convex Auth with verification off and calls as that session. */
async function signUpConvexAuth(t: TestConvex, email: string) {
  const result = await t
    .withRequestMetadata({ ip: "203.0.113.7" })
    .mutation(api.auth.signUpWithoutEmailVerification, { email, password: "correct horse battery staple" });
  if (result.status !== "complete") throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  const { sub, iss } = JSON.parse(atob(result.tokens.accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string; iss: string };
  return { userId: result.tokens.userId as Id<"users">, asSession: t.withIdentity({ subject: sub, issuer: iss }) };
}

describe("organizations.invitations", () => {
  afterEach(() => {
    sendTransactionalEmailMock.mockClear();
  });

  describe("create", () => {
    test("should fail if user lacks permission", async () => {
      const ctx = createTestContext();
      const { org } = await ctx.setupOrg();

      // Create a member (not admin/owner)
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(memberUser);

      await expect(
        asMember.mutation(api.organizations.invitations.create, {
          organizationId: org._id,
          email: "newuser@test.com",
          role: "member",
        })
      ).rejects.toThrow();
    });

    test("should fail if user is already a member", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();

      const existingUser = await ctx.user({ email: "existing@test.com" });
      await ctx.orgMember(org._id, existingUser._id, OrgRole.MEMBER);

      await expect(
        asUser.mutation(api.organizations.invitations.create, {
          organizationId: org._id,
          email: "existing@test.com",
          role: "member",
        })
      ).rejects.toThrow("already a member");
    });

    test("should create when two users share the invited address", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();
      await ctx.user({ email: "shared@test.com" });
      await ctx.user({ email: "shared@test.com" });

      await expect(
        asUser.mutation(api.organizations.invitations.create, {
          organizationId: org._id,
          email: "shared@test.com",
          role: "member",
        })
      ).resolves.toBeDefined();
    });

    test("should find a member however many users share the invited address", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();
      for (let i = 0; i < 25; i++) await ctx.user({ email: "shared@test.com" });
      const member = await ctx.user({ email: "shared@test.com" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await expect(
        asUser.mutation(api.organizations.invitations.create, {
          organizationId: org._id,
          email: "shared@test.com",
          role: "member",
        })
      ).rejects.toThrow("already a member");
    });

    test("should fail if any user with the invited address is already a member", async () => {
      const ctx = createTestContext();
      const { org, asUser } = await ctx.setupOrg();
      await ctx.user({ email: "shared@test.com" });
      const member = await ctx.user({ email: "shared@test.com" });
      await ctx.orgMember(org._id, member._id, OrgRole.MEMBER);

      await expect(
        asUser.mutation(api.organizations.invitations.create, {
          organizationId: org._id,
          email: "shared@test.com",
          role: "member",
        })
      ).rejects.toThrow("already a member");
    });
  });

  describe("Convex Auth session", () => {
    beforeEach(() => {
      vi.stubEnv("AUTH_MODE", "convex");
      vi.stubEnv("AUTH_EMAIL_VERIFICATION", "off");
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    test("getByToken authorizes the invited address from the user row", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();
      const invitation = await ctx.organizationInvitation(org._id, user._id, { email: "robin@example.com" });
      const { asSession } = await signUpConvexAuth(t, "Robin@Example.com");

      const result = await asSession.query(api.organizations.invitations.getByToken, { token: invitation.token });

      expect(result?.access).toBe("authorized");
    });

    test("accept adds the signed-up user to the organization", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();
      const invitation = await ctx.organizationInvitation(org._id, user._id, { email: "robin@example.com" });
      const { userId, asSession } = await signUpConvexAuth(t, "robin@example.com");

      await asSession.mutation(api.organizations.invitations.accept, { token: invitation.token });

      const membership = await t.run((runCtx) =>
        runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) => q.eq("organizationId", org._id).eq("userId", userId))
          .unique()
      );
      expect(membership?.role).toBe("member");
    });

    test("another address is the wrong account", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();
      const invitation = await ctx.organizationInvitation(org._id, user._id, { email: "robin@example.com" });
      const { asSession } = await signUpConvexAuth(t, "sam@example.com");

      expect(await asSession.query(api.organizations.invitations.getByToken, { token: invitation.token })).toEqual({
        access: "unauthorized",
      });
      await expect(
        asSession.mutation(api.organizations.invitations.accept, { token: invitation.token })
      ).rejects.toThrow("not available for this account");
    });
  });

  describe("accept", () => {
    test("should add user to organization", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      // Create invitation directly (bypasses email)
      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        role: "member",
      });

      // Create new user and accept
      const newUser = await ctx.user({ email: "newuser@test.com" });
      const asNewUser = ctx.asUser(newUser);

      const result = await asNewUser.mutation(api.organizations.invitations.accept, {
        token: invitation.token,
      });

      expect(result.organizationId).toBe(org._id);
      expect(result.organizationSlug).toBe(org.slug);

      // Verify membership was created
      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", newUser._id)
          )
          .unique();
      });

      expect(membership).not.toBeNull();
      expect(membership?.role).toBe("member");
      expect(sendTransactionalEmailMock).toHaveBeenCalledTimes(1);
      expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          to: "newuser@test.com",
          template: expect.objectContaining({
            id: "welcome-onboarding",
            action: expect.objectContaining({
              url: `https://app.convoy.build/o/${org.slug}/`,
            }),
          }),
        }),
      );
    });

    test("should accept with admin role", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "admin@test.com",
        role: "admin",
      });

      const newUser = await ctx.user({ email: "admin@test.com" });
      const asNewUser = ctx.asUser(newUser);

      await asNewUser.mutation(api.organizations.invitations.accept, {
        token: invitation.token,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", newUser._id)
          )
          .unique();
      });

      expect(membership?.role).toBe("admin");
    });

    test("should fail with expired token", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        expiresAt: Date.now() - 1000, // Already expired
      });

      const newUser = await ctx.user({ email: "newuser@test.com" });
      const asNewUser = ctx.asUser(newUser);

      await expect(
        asNewUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("expired");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("should fail with a generic unauthorized error for wrong email", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
      });

      // Try to accept with different email
      const wrongUser = await ctx.user({ email: "wrong@test.com" });
      const asWrongUser = ctx.asUser(wrongUser);

      await expect(
        asWrongUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("not available for this account");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("should not reveal accepted status to a wrong email", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
        status: InvitationStatus.ACCEPTED,
      });

      const wrongUser = await ctx.user({ email: "wrong@test.com" });
      const asWrongUser = ctx.asUser(wrongUser);

      await expect(
        asWrongUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("not available for this account");

      await expect(
        asWrongUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.not.toThrow("already been accepted");
    });

    test("should accept when DB email is tampered but identity email matches invitation", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
      });

      const invitedUser = await ctx.user({ email: "invited@test.com" });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("users", invitedUser._id, {
          email: "tampered@test.com",
        });
      });

      const asInvitedUser = t.withIdentity({
        tokenIdentifier: invitedUser.tokenIdentifier,
        email: "invited@test.com",
      });

      await asInvitedUser.mutation(api.organizations.invitations.accept, {
        token: invitation.token,
      });

      const membership = await t.run(async (runCtx) => {
        return await runCtx.db
          .query("organizationMembers")
          .withIndex("by_organization_and_user", (q) =>
            q.eq("organizationId", org._id).eq("userId", invitedUser._id)
          )
          .unique();
      });

      expect(membership).not.toBeNull();
    });

    test("should fail when DB email matches but identity email differs", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
      });

      const invitedUser = await ctx.user({ email: "invited@test.com" });
      const asSpoofedIdentity = ctx.t.withIdentity({
        tokenIdentifier: invitedUser.tokenIdentifier,
        email: "different@test.com",
      });

      await expect(
        asSpoofedIdentity.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("not available for this account");
    });

    test("should fail when identity has no email", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
      });

      const invitedUser = await ctx.user({ email: "invited@test.com" });
      const asNoEmailIdentity = ctx.t.withIdentity({
        tokenIdentifier: invitedUser.tokenIdentifier,
      });

      await expect(
        asNoEmailIdentity.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("Unable to verify your account email");
    });

    test("should fail with revoked invitation", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        status: InvitationStatus.REVOKED,
      });

      const newUser = await ctx.user({ email: "newuser@test.com" });
      const asNewUser = ctx.asUser(newUser);

      await expect(
        asNewUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("revoked");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("should fail with invalid token", async () => {
      const ctx = createTestContext();
      const newUser = await ctx.user({ email: "newuser@test.com" });
      const asNewUser = ctx.asUser(newUser);

      await expect(
        asNewUser.mutation(api.organizations.invitations.accept, {
          token: "invalid-token-12345",
        })
      ).rejects.toThrow("Invalid invitation link");
    });

    test("should handle already-accepted invitation", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        status: InvitationStatus.ACCEPTED,
      });

      const newUser = await ctx.user({ email: "newuser@test.com" });
      const asNewUser = ctx.asUser(newUser);

      await expect(
        asNewUser.mutation(api.organizations.invitations.accept, {
          token: invitation.token,
        })
      ).rejects.toThrow("already been accepted");

      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });

    test("should handle user already a member gracefully", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      // Create a user who is already a member
      const existingUser = await ctx.user({ email: "existing@test.com" });
      await ctx.orgMember(org._id, existingUser._id, OrgRole.MEMBER);

      // Create invitation for this user
      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "existing@test.com",
      });

      const asExisting = ctx.asUser(existingUser);

      // Should succeed and mark invitation as accepted
      const result = await asExisting.mutation(api.organizations.invitations.accept, {
        token: invitation.token,
      });

      expect(result.organizationId).toBe(org._id);

      // Verify invitation was marked accepted
      const updatedInvitation = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizationInvitations", invitation._id);
      });
      expect(updatedInvitation?.status).toBe("accepted");
      expect(sendTransactionalEmailMock).not.toHaveBeenCalled();
    });
  });

  describe("revoke", () => {
    test("should revoke pending invitation", async () => {
      const ctx = createTestContext();
      const { org, user, asUser, t } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
      });

      await asUser.mutation(api.organizations.invitations.revoke, {
        organizationInvitationId: invitation._id,
      });

      const updatedInvitation = await t.run(async (runCtx) => {
        return await runCtx.db.get("organizationInvitations", invitation._id);
      });

      expect(updatedInvitation?.status).toBe("revoked");
    });

    test("should fail to revoke non-pending invitation", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        status: InvitationStatus.REVOKED,
      });

      await expect(
        asUser.mutation(api.organizations.invitations.revoke, {
          organizationInvitationId: invitation._id,
        })
      ).rejects.toThrow("only revoke pending");
    });

    test("should fail if user lacks permission", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
      });

      // Create a member without permission
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(memberUser);

      await expect(
        asMember.mutation(api.organizations.invitations.revoke, {
          organizationInvitationId: invitation._id,
        })
      ).rejects.toThrow();
    });
  });

  describe("resend", () => {
    test("should fail for non-pending invitation", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        status: InvitationStatus.REVOKED,
      });

      await expect(
        asUser.mutation(api.organizations.invitations.resend, {
          organizationInvitationId: invitation._id,
        })
      ).rejects.toThrow("only resend pending");
    });

    test("should fail if user lacks permission", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
      });

      // Create a member without permission
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(memberUser);

      await expect(
        asMember.mutation(api.organizations.invitations.resend, {
          organizationInvitationId: invitation._id,
        })
      ).rejects.toThrow();
    });
  });

  describe("listPending", () => {
    test("should list pending invitations", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user1@test.com",
        role: "member",
      });

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user2@test.com",
        role: "admin",
      });

      const pending = await asUser.query(api.organizations.invitations.listPending, {
        organizationId: org._id,
      });

      expect(pending).toHaveLength(2);
      expect(pending.map((p) => p.email).sort()).toEqual([
        "user1@test.com",
        "user2@test.com",
      ]);
    });

    test("gives the invite link only while the deployment sends no email", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();
      const invitation = await ctx.organizationInvitation(org._id, user._id, { email: "robin@example.com" });
      const list = () => asUser.query(api.organizations.invitations.listPending, { organizationId: org._id });

      vi.stubEnv("RESEND_API_KEY", "");
      expect((await list())[0].inviteUrl).toMatch(new RegExp(`/auth/invite/${invitation.token}$`));

      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      expect((await list())[0].inviteUrl).toBeNull();
      vi.unstubAllEnvs();
    });

    test("should not include revoked invitations", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user1@test.com",
        status: InvitationStatus.REVOKED,
      });

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user2@test.com",
        status: InvitationStatus.PENDING,
      });

      const pending = await asUser.query(api.organizations.invitations.listPending, {
        organizationId: org._id,
      });

      expect(pending).toHaveLength(1);
      expect(pending[0].email).toBe("user2@test.com");
    });

    test("should return empty for user without permission", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user1@test.com",
      });

      // Create a member without permission
      const memberUser = await ctx.user();
      await ctx.orgMember(org._id, memberUser._id, OrgRole.MEMBER);
      const asMember = ctx.asUser(memberUser);

      const pending = await asMember.query(api.organizations.invitations.listPending, {
        organizationId: org._id,
      });

      expect(pending).toHaveLength(0);
    });

    test("should include inviter info", async () => {
      const ctx = createTestContext();
      const { org, user, asUser } = await ctx.setupOrg();

      await ctx.organizationInvitation(org._id, user._id, {
        email: "user1@test.com",
      });

      const pending = await asUser.query(api.organizations.invitations.listPending, {
        organizationId: org._id,
      });

      expect(pending[0].invitedBy._id).toBe(user._id);
      expect(pending[0].invitedBy.name).toBe(user.name);
      expect(pending[0].invitedBy.email).toBe(user.email);
    });
  });

  describe("getByToken", () => {
    test("should require authentication before returning invitation details", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        role: "member",
      });

      const result = await t.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result).toEqual({ access: "requires-authentication" });
    });

    test("should return null for invalid token", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupOrg();

      const result = await t.query(api.organizations.invitations.getByToken, {
        token: "invalid-token",
      });

      expect(result).toBeNull();
    });

    test("should not return invitation details when authenticated user email does not match", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "invited@test.com",
        role: "admin",
      });

      const differentUser = await ctx.user({ email: "different@test.com" });
      const asDifferentUser = ctx.asUser(differentUser);

      const result = await asDifferentUser.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result).toEqual({ access: "unauthorized" });
    });

    test("should return invitation details with masked email for the invited user", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        role: "member",
      });

      const invitedUser = await ctx.user({ email: "newuser@test.com" });
      const asInvitedUser = ctx.asUser(invitedUser);

      const result = await asInvitedUser.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result).toEqual({
        access: "authorized",
        _id: invitation._id,
        email: "n***r@t***t.com",
        role: "member",
        status: "pending",
        expiresAt: invitation.expiresAt,
        organizationName: org.name,
        inviterName: user.name,
        isExpired: false,
      });
    });

    test("should mark as expired for the invited user if past expiration", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "newuser@test.com",
        expiresAt: Date.now() - 1000, // Already expired
      });

      const invitedUser = await ctx.user({ email: "newuser@test.com" });
      const asInvitedUser = ctx.asUser(invitedUser);

      const result = await asInvitedUser.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result?.isExpired).toBe(true);
    });

    test("should authorize when authenticated user email matches with different casing", async () => {
      const ctx = createTestContext();
      const { org, user } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "matching@test.com",
      });

      const matchingUser = await ctx.user({ email: "Matching@Test.COM" });
      const asMatchingUser = ctx.asUser(matchingUser);

      const result = await asMatchingUser.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result?.access).toBe("authorized");
    });

    test("should authorize from identity email, not persisted DB email", async () => {
      const ctx = createTestContext();
      const { org, user, t } = await ctx.setupOrg();

      const invitation = await ctx.organizationInvitation(org._id, user._id, {
        email: "identity-match@test.com",
      });

      const invitedUser = await ctx.user({ email: "identity-match@test.com" });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("users", invitedUser._id, {
          email: "tampered@test.com",
        });
      });

      const asInvitedUser = t.withIdentity({
        tokenIdentifier: invitedUser.tokenIdentifier,
        email: "identity-match@test.com",
      });

      const result = await asInvitedUser.query(api.organizations.invitations.getByToken, {
        token: invitation.token,
      });

      expect(result?.access).toBe("authorized");
    });
  });
});
