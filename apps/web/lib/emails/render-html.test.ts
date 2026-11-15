import { describe, expect, test } from "vitest";
import { buildOrganizationInvitationEmail } from "./catalog";
import { renderEmailHtml } from "./render-html";

describe("renderEmailHtml", () => {
  test("renders the shared email shell with escaped content", () => {
    const template = buildOrganizationInvitationEmail({
      organizationName: "Acme <Workspace>",
      inviterName: "Jordan & Lee",
      inviteUrl: "https://example.com/invite?token=abc",
      role: "member",
    });

    const html = renderEmailHtml(template);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Jordan &amp; Lee");
    expect(html).toContain("Acme &lt;Workspace&gt;");
    expect(html).toContain("Accept invitation");
    expect(html).toContain("https://example.com/invite?token=abc");
  });
});
