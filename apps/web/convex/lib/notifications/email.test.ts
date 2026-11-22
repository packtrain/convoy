import { describe, expect, test, vi, afterEach } from "vitest";
import { buildOrganizationInvitationEmail } from "../../../lib/emails/catalog";
import { buildProjectUrl } from "../../../lib/emails/links";
import { EMAIL_LOGO_URL } from "../../../lib/emails/render-html";
import { createTestContext } from "../../../convex-testing";
import { buildResendEmail, getEmailFrom, sendTransactionalEmail } from "./email";

describe("notification email helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses EMAIL_FROM when configured", () => {
    vi.stubEnv("EMAIL_FROM", "Team <team@example.com>");

    expect(getEmailFrom()).toBe("Team <team@example.com>");
  });

  test("builds resend payloads from shared templates", () => {
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme Workspace",
      inviterName: "Jordan Lee",
      inviteUrl: "https://example.com/invite",
      role: "member",
    });

    const email = buildResendEmail(template);

    expect(email.from).toContain("convoy.build");
    expect(email.subject).toBe("You're invited to join Acme Workspace");
    expect(email.html).toContain("Accept invitation");
    expect(email.html).toContain("Jordan Lee");
    expect(email.html).toContain(`src="${EMAIL_LOGO_URL}"`);
  });

  test("the help line names SUPPORT_EMAIL, and is left out without it", () => {
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme Workspace",
      inviterName: "Jordan Lee",
      inviteUrl: "https://example.com/invite",
      role: "member",
    });
    expect(buildResendEmail(template).html).not.toContain("need any help");

    vi.stubEnv("SUPPORT_EMAIL", "help@example.com");
    expect(buildResendEmail(template).html).toContain("mailto:help@example.com");
  });

  test("sends nothing without RESEND_API_KEY, so the calling mutation still commits", async () => {
    const { t } = createTestContext();
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme Workspace",
      inviterName: "Jordan Lee",
      inviteUrl: "https://example.com/invite",
      role: "member",
    });

    await expect(
      t.run((ctx) => sendTransactionalEmail(ctx, { to: "robin@example.com", template }))
    ).resolves.toBeNull();
  });

  test("builds absolute project URLs from the configured app base", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    expect(buildProjectUrl("acme", "WEB")).toBe("https://app.example.com/o/acme/WEB");
  });
});
