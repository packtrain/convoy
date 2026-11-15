import { describe, expect, test } from "vitest";
import {
  buildOrganizationInvitationEmail,
  buildProjectInvitationEmail,
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
    expect(template.headerTag).toBe("Org invite");
    expect(template.details).toEqual([]);
    expect(template.bullets).toBeUndefined();
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
    expect(template.details).toEqual([]);
    expect(template.bullets).toBeUndefined();
  });

  test("returns preview entries for every supported template", () => {
    const entries = getEmailPreviewEntries();

    expect(entries.map((entry) => entry.template.id)).toEqual([
      "org-invitation",
      "welcome-onboarding",
      "project-invitation",
    ]);
    expect(entries.map((entry) => entry.key)).toContain("project-invitation");
  });
});
