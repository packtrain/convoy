import { describe, expect, test, vi, afterEach } from "vitest";
import { buildOrganizationInvitationEmail } from "../../../lib/emails/catalog";
import { buildProjectUrl } from "../../../lib/emails/links";
import { buildResendEmail, getEmailFrom } from "./email";

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
    expect(email.html).toContain("CONVOY</span><span style=\"color:#999999;\"> / ORG INVITE");
  });

  test("builds absolute project URLs from the configured app base", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    expect(buildProjectUrl("acme", "WEB")).toBe("https://app.example.com/o/acme/WEB");
  });
});
