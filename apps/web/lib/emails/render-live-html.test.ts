import { describe, expect, test } from "vitest";
import { buildOrganizationInvitationEmail } from "./catalog";
import { getLiveEmailLayout, renderLiveEmailHtml } from "./render-live-html";

describe("renderLiveEmailHtml", () => {
  test("renders the minimal live email layout", () => {
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme <Workspace>",
      inviterName: "Jordan & Lee",
      inviteUrl: "https://example.com/invite?token=abc",
      role: "member",
    });

    expect(getLiveEmailLayout(template)).toBe("minimal");

    const html = renderLiveEmailHtml(template);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Jordan &amp; Lee");
    expect(html).toContain("Acme &lt;Workspace&gt;");
    expect(html).toContain("Accept invitation");
    expect(html).toContain("https://example.com/invite?token=abc");
    expect(html).toContain("CONVOY</span><span style=\"color:#999999;\"> / ORG INVITE");
  });
});
