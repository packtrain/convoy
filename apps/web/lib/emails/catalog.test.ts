import { describe, expect, test } from "vitest";
import {
  buildOrganizationInvitationEmail,
  buildProjectInvitationEmail,
  buildVerifyEmailEmail,
  buildResetPasswordEmail,
  buildPasswordChangedEmail,
  buildWelcomeOnboardingEmail,
  getEmailPreviewEntries,
} from "./catalog";

describe("email catalog", () => {
  test("builds the organization invitation subject and simplified content", () => {
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme Workspace",
      inviterName: "Jordan Lee",
      inviteUrl: "https://example.com/invite",
      role: "admin",
      expiresInDays: 10,
    });

    expect(template.id).toBe("org-invitation");
    expect(template.subject).toBe("You're invited to join Acme Workspace");
    expect(template.details).toEqual([
      { label: "Organization", value: "Acme Workspace" },
      { label: "Invited by", value: "Jordan Lee" },
      { label: "Role", value: "Admin" },
    ]);
    expect(template.footer[0]).toContain("10 days");
    expect(template.action?.url).toBe("https://example.com/invite");
  });

  test("builds the welcome email as a Convoy welcome", () => {
    const template = buildWelcomeOnboardingEmail({
      organizationName: "Acme Workspace",
      workspaceUrl: "https://example.com/o/acme",
      role: "member",
      inviterName: "Jordan Lee",
    });

    expect(template.id).toBe("welcome-onboarding");
    expect(template.subject).toBe("Welcome to Convoy");
    expect(template.title).toBe("Welcome to Convoy");
    expect(template.body[0]).toBe("You now have access to Acme Workspace.");
  });

  test("builds the project invitation with project metadata", () => {
    const template = buildProjectInvitationEmail({
      organizationName: "Acme Workspace",
      projectName: "Website Refresh",
      projectUrl: "https://example.com/o/acme/WEB",
      addedByName: "Jordan Lee",
      role: "member",
    });

    expect(template.id).toBe("project-invitation");
    expect(template.subject).toBe("You've been added to Website Refresh");
    expect(template.details).toEqual([
      { label: "Project", value: "Website Refresh" },
      { label: "Organization", value: "Acme Workspace" },
      { label: "Added by", value: "Jordan Lee" },
      { label: "Role", value: "Member" },
    ]);
  });

  test("builds the sign-up verification email around the link", () => {
    const template = buildVerifyEmailEmail({
      verifyUrl: "https://example.com/auth/verify-email?code=abc",
      expiresIn: "1 hour",
    });

    expect(template.id).toBe("verify-email");
    expect(template.subject).toBe("Verify your email address");
    expect(template.action?.url).toBe("https://example.com/auth/verify-email?code=abc");
    expect(template.body.join(" ")).toContain("1 hour");
  });

  test("builds the password reset email around the link", () => {
    const template = buildResetPasswordEmail({
      resetUrl: "https://example.com/auth/reset-password?code=abc",
      expiresIn: "10 minutes",
    });

    expect(template.id).toBe("reset-password");
    expect(template.subject).toBe("Reset your password");
    expect(template.action?.url).toBe("https://example.com/auth/reset-password?code=abc");
    expect(template.body.join(" ")).toContain("10 minutes");
  });

  test("the password changed notice links to a new reset", () => {
    const template = buildPasswordChangedEmail({ resetUrl: "https://example.com/auth/forgot-password" });

    expect(template.id).toBe("password-changed");
    expect(template.subject).toBe("Your password was changed");
    expect(template.action?.url).toBe("https://example.com/auth/forgot-password");
  });

  test("returns preview entries for every supported template", () => {
    const entries = getEmailPreviewEntries();

    expect(entries.map((entry) => entry.template.id)).toEqual([
      "org-invitation",
      "welcome-onboarding",
      "project-invitation",
      "verify-email",
      "reset-password",
      "password-changed",
    ]);
    expect(entries.map((entry) => entry.key)).toContain("project-invitation");
  });
});
