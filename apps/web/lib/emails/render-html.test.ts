import { describe, expect, test } from "vitest";
import { buildOrganizationInvitationEmail } from "./catalog";
import { EMAIL_LOGO_URL, renderEmailHtml } from "./render-html";

describe("renderEmailHtml", () => {
  const template = buildOrganizationInvitationEmail({
    organizationName: "Acme <Workspace>",
    inviterName: "Jordan & Lee",
    inviteUrl: "https://example.com/invite?token=abc&x=1",
    role: "member",
  });
  const html = renderEmailHtml(template);

  test("escapes the content", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Jordan &amp; Lee");
    expect(html).toContain("Acme &lt;Workspace&gt;");
  });

  test("has the logo, the button with a plain-link fallback, and the footer", () => {
    expect(EMAIL_LOGO_URL.startsWith("https://")).toBe(true);
    expect(html).toContain(`src="${EMAIL_LOGO_URL}"`);
    const url = 'href="https://example.com/invite?token=abc&amp;x=1"';
    expect(html.split(url)).toHaveLength(3);
    expect(html).toContain("Accept invitation</a>");
    expect(html).toContain("click here</a>");
    expect(html).toContain(`&copy; ${new Date().getFullYear()} Convoy`);
  });

  test("adds the help line only for a given support address", () => {
    expect(html).not.toContain("need any help");
    const withSupport = renderEmailHtml(template, "help@example.com");
    expect(withSupport).toContain('reach out to <a href="mailto:help@example.com"');
  });

  test("puts the details in a box of label and value rows", () => {
    expect(html).toContain("Invited by:");
    expect(html).toMatch(/<td[^>]*font-weight:600[^>]*>Jordan &amp; Lee<\/td>/);
  });
});
